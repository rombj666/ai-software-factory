import type { DbClient } from "@asf/db";
import {
  computeLeaseExpiry,
  canRetry,
  nextAvailableAt,
  WorkflowStateMachine,
} from "@asf/core";
import { workflowJobs, lifecycleEvents, projects } from "@asf/db/schema";
import { sql, eq } from "drizzle-orm";

/**
 * Safe job queue operations.
 *
 * Claiming uses a single atomic UPDATE ... RETURNING so two workers can never
 * claim the same job (FOR UPDATE SKIP LOCKED + status guard). Stale leases
 * are recovered on startup and periodically.
 */
export interface ClaimedJob {
  id: string;
  projectId: string | null;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export async function claimNextJob(
  db: DbClient,
  workerId: string,
  leaseSeconds: number,
): Promise<ClaimedJob | null> {
  const now = new Date();
  const leaseExpiry = computeLeaseExpiry({ now, leaseSeconds });

  const rows = (await db.execute(sql`
    UPDATE workflow_jobs
    SET status = 'claimed',
        claimed_by = ${workerId},
        lease_expires_at = ${sql.param(leaseExpiry, workflowJobs.leaseExpiresAt)},
        started_at = ${sql.param(now, workflowJobs.startedAt)},
        updated_at = ${sql.param(now, workflowJobs.updatedAt)}
    WHERE id = (
      SELECT id FROM workflow_jobs
      WHERE status = 'queued' AND available_at <= ${sql.param(now, workflowJobs.availableAt)}
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, project_id, type, payload, attempts
  `)) as unknown as Array<{
    id: string;
    project_id: string | null;
    type: string;
    payload: Record<string, unknown>;
    attempts: number;
  }>;

  if (rows.length === 0) return null;

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    payload: row.payload ?? {},
    attempts: row.attempts,
  };
}

/** Reset expired claimed/running leases back to queued (crash recovery). */
export async function recoverStaleJobs(db: DbClient): Promise<number> {
  const now = new Date();
  // Raw sql interpolation has no column encoder. Drizzle's postgres.js adapter
  // disables the driver's Date serializer, so bind timestamps with the column.
  const rows = (await db.execute(sql`
    UPDATE workflow_jobs
    SET status = 'queued',
        claimed_by = NULL,
        lease_expires_at = NULL,
        available_at = ${sql.param(now, workflowJobs.availableAt)},
        updated_at = ${sql.param(now, workflowJobs.updatedAt)}
    WHERE status IN ('claimed', 'running')
      AND (lease_expires_at IS NULL OR lease_expires_at < ${sql.param(now, workflowJobs.leaseExpiresAt)})
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return rows.length;
}

export async function completeJob(
  db: DbClient,
  jobId: string,
  result: Record<string, unknown>,
): Promise<void> {
  const now = new Date();
  await db
    .update(workflowJobs)
    .set({
      status: "succeeded",
      result,
      finishedAt: now,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(workflowJobs.id, jobId));
}

/**
 * Mark a job failed. If attempts remain, requeue it with backoff instead of
 * leaving a permanent failure (retry semantics).
 */
export async function failJob(
  db: DbClient,
  job: ClaimedJob,
  error: string,
  maxAttempts: number,
): Promise<{ status: "failed" | "retry" }> {
  const now = new Date();
  const nextAttempt = job.attempts + 1;

  if (canRetry(nextAttempt, maxAttempts)) {
    await db
      .update(workflowJobs)
      .set({
        status: "queued",
        attempts: nextAttempt,
        error,
        claimedBy: null,
        leaseExpiresAt: null,
        availableAt: nextAvailableAt(now, nextAttempt),
        updatedAt: now,
      })
      .where(eq(workflowJobs.id, job.id));
    return { status: "retry" };
  }

  await db
    .update(workflowJobs)
    .set({
      status: "failed",
      attempts: nextAttempt,
      error,
      finishedAt: now,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(workflowJobs.id, job.id));
  return { status: "failed" };
}

export async function recordLifecycleEvent(
  db: DbClient,
  input: {
    projectId: string | null;
    eventType: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(lifecycleEvents).values({
    projectId: input.projectId,
    eventType: input.eventType,
    payload: input.payload ?? {},
  });
}

/**
 * Internal project-initialization job handler (M1 verification of the
 * database → worker pipeline). It is NOT an AI agent execution: it simply
 * advances the project from `idea_submitted` to `consultation` through the
 * typed state machine and records the lifecycle event.
 */
export async function handleProjectInitialization(
  db: DbClient,
  job: ClaimedJob,
): Promise<Record<string, unknown>> {
  const projectId = String(job.payload.projectId ?? "");
  if (!projectId) {
    throw new Error("project_initialization job payload missing projectId");
  }

  const [project] = await db
    .select({ id: projects.id, status: projects.status })
    .from(projects)
    .where(eq(projects.id, projectId));

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const transition = WorkflowStateMachine.transition(
    project.status as never,
    "consultation",
    { projectId, reason: "project_initialization (internal M1 job)" },
  );

  if (!transition.ok) {
    throw new Error(
      `Cannot initialize project ${projectId}: ${transition.error ?? "unknown"}`,
    );
  }

  await db
    .update(projects)
    .set({ status: "consultation", updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  await db.insert(lifecycleEvents).values({
    projectId,
    eventType: "project.status_changed",
    payload: {
      from: transition.from,
      to: transition.to,
      reason: "project_initialization (internal M1 job)",
    },
  });

  return {
    projectId,
    from: transition.from,
    to: transition.to,
    verified: "database-to-worker pipeline OK",
  };
}
