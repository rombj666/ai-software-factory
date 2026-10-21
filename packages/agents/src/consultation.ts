import { and, asc, eq, sql } from "drizzle-orm";
import type { DbClient } from "@asf/db";
import {
  agentRuns,
  consultationMessages,
  lifecycleEvents,
  projectAssets,
  projects,
  usageLogs,
  workflowJobs,
} from "@asf/db/schema";
import { WorkflowStateMachine } from "@asf/core";
import {
  ConsultationError,
  consultationState,
  projectIdSchema,
  requestSchema,
  requirementsSchema,
  type ConsultationState,
} from "./schema";

type Tx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type Project = typeof projects.$inferSelect;
export async function lockProject(tx: Tx, projectId: string): Promise<Project> {
  const [project] = await tx
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .for("update");
  if (!project) throw new ConsultationError("Project not found.");
  return project;
}
export async function ownedProject(
  tx: Tx,
  projectId: string,
  ownerId: string,
): Promise<Project> {
  projectIdSchema.parse(projectId);
  const project = await lockProject(tx, projectId);
  if (project.ownerId !== ownerId)
    throw new ConsultationError("Project not found.");
  return project;
}
export async function saveState(
  tx: Tx,
  project: Project,
  state: ConsultationState,
  status = project.status,
) {
  await tx
    .update(projects)
    .set({
      status,
      currentState: { ...project.currentState, consultation: state },
      updatedAt: new Date(),
    })
    .where(eq(projects.id, project.id));
}
export async function budgetUsage(tx: Tx, projectId: string) {
  const [spent] = await tx
    .select({
      amount: sql<string>`coalesce(sum(${usageLogs.amount}), 0)::text`,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.projectId, projectId),
        eq(usageLogs.unit, "USD"),
        eq(usageLogs.currency, "USD"),
      ),
    );
  const runs = await tx
    .select({ input: agentRuns.input })
    .from(agentRuns)
    .where(
      and(eq(agentRuns.projectId, projectId), eq(agentRuns.status, "running")),
    );
  const reserved = runs.reduce(
    (sum, run) => sum + Number(run.input?.reservationUsd ?? 0),
    0,
  );
  return { spentUsd: Number(spent?.amount ?? 0), reservedUsd: reserved };
}

export async function enqueueConsultation(
  db: DbClient,
  ownerId: string,
  projectId: string,
  input: {
    mode: "start" | "message" | "retry";
    requestId: string;
    expectedRevision: number;
    content?: string;
  },
) {
  requestSchema.parse({
    ...input,
    content: input.mode === "message" ? input.content : input.mode,
  });
  return db.transaction(async (tx) => {
    const project = await ownedProject(tx, projectId, ownerId);
    const state = consultationState(project.currentState);
    const [duplicate] = await tx
      .select({ payload: workflowJobs.payload })
      .from(workflowJobs)
      .where(
        and(
          eq(workflowJobs.projectId, projectId),
          eq(workflowJobs.type, "consultation_turn"),
          sql`${workflowJobs.payload}->>'requestId' = ${input.requestId}`,
        ),
      );
    if (duplicate) {
      if (
        duplicate.payload?.content !== (input.content?.trim() ?? null) ||
        duplicate.payload?.mode !== input.mode
      )
        throw new ConsultationError(
          "This request identifier was already used for different content.",
        );
      return;
    }
    if (!["idea_submitted", "consultation"].includes(project.status))
      throw new ConsultationError("Consultation is closed for this project.");
    if (state.revision !== input.expectedRevision)
      throw new ConsultationError(
        "The conversation changed. Refresh before sending again.",
      );
    if (state.activeJobId) {
      const [active] = await tx
        .select()
        .from(workflowJobs)
        .where(eq(workflowJobs.id, state.activeJobId));
      if (active && ["queued", "claimed", "running"].includes(active.status))
        throw new ConsultationError(
          "The Planner is already processing this conversation.",
        );
    }
    if (input.mode === "start" && state.revision > 0)
      throw new ConsultationError(
        "Consultation has already started. Use Retry for a failed response.",
      );
    if (input.mode === "retry" && state.status !== "failed") {
      const [lastJob] = state.activeJobId
        ? await tx
            .select()
            .from(workflowJobs)
            .where(eq(workflowJobs.id, state.activeJobId))
        : [];
      if (lastJob?.status !== "failed")
        throw new ConsultationError(
          "Only a failed consultation response can be retried.",
        );
    }
    const history = await tx
      .select({ id: consultationMessages.id })
      .from(consultationMessages)
      .where(eq(consultationMessages.projectId, projectId));
    if (!history.length)
      await tx
        .insert(consultationMessages)
        .values({
          projectId,
          role: "user",
          createdAt: sql`clock_timestamp()`,
          content: project.idea,
          metadata: { kind: "original_idea" },
        });
    if (input.mode === "message")
      await tx
        .insert(consultationMessages)
        .values({
          projectId,
          role: "user",
          createdAt: sql`clock_timestamp()`,
          content: input.content!.trim(),
          metadata: { requestId: input.requestId },
        });
    const revision = state.revision + 1;
    const [job] = await tx
      .insert(workflowJobs)
      .values({
        projectId,
        type: "consultation_turn",
        payload: {
          revision,
          requestId: input.requestId,
          mode: input.mode,
          content: input.content?.trim() ?? null,
        },
        maxAttempts: 3,
      })
      .returning();
    if (!job) throw new Error("Consultation job insert failed");
    if (project.status === "idea_submitted") {
      const transition = WorkflowStateMachine.transition(
        project.status,
        "consultation",
        { projectId, actor: ownerId },
      );
      if (!transition.ok)
        throw new ConsultationError("Project cannot enter consultation.");
      await tx
        .insert(lifecycleEvents)
        .values({
          projectId,
          eventType: transition.event.eventType,
          payload: { from: project.status, to: "consultation", actor: ownerId },
        });
    }
    await saveState(
      tx,
      project,
      {
        ...state,
        revision,
        activeJobId: job.id,
        status: "queued",
        readyToComplete: false,
        error: null,
      },
      "consultation",
    );
  });
}

/** Project creation, initial message, transition and durable job are atomic. */
export async function createConsultationProject(
  db: DbClient,
  ownerId: string,
  title: string,
  idea: string,
) {
  if (
    !ownerId ||
    !title.trim() ||
    title.trim().length > 200 ||
    !idea.trim() ||
    idea.trim().length > 4000
  )
    throw new ConsultationError(
      "Enter a title (up to 200 characters) and idea (up to 4,000 characters).",
    );
  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({ ownerId, title: title.trim(), idea: idea.trim() })
      .returning();
    if (!project) throw new Error("Project insert failed");
    const transition = WorkflowStateMachine.transition(
      project.status,
      "consultation",
      { projectId: project.id, actor: ownerId },
    );
    if (!transition.ok) throw new Error("Invalid consultation transition");
    await tx
      .insert(consultationMessages)
      .values({
        projectId: project.id,
        role: "user",
        createdAt: sql`clock_timestamp()`,
        content: project.idea,
        metadata: { kind: "original_idea" },
      });
    const [job] = await tx
      .insert(workflowJobs)
      .values({
        projectId: project.id,
        type: "consultation_turn",
        payload: {
          revision: 1,
          requestId: project.id,
          mode: "start",
          content: null,
        },
      })
      .returning();
    if (!job) throw new Error("Consultation job insert failed");
    await saveState(
      tx,
      project,
      {
        ...consultationState(null),
        revision: 1,
        status: "queued",
        activeJobId: job.id,
      },
      "consultation",
    );
    await tx
      .insert(lifecycleEvents)
      .values({
        projectId: project.id,
        eventType: "project.status_changed",
        payload: { from: "idea_submitted", to: "consultation", actor: ownerId },
      });
    return project.id;
  });
}

export async function editRequirements(
  db: DbClient,
  ownerId: string,
  projectId: string,
  expectedRevision: number,
  value: unknown,
) {
  const summary = requirementsSchema.parse(value);
  return db.transaction(async (tx) => {
    const project = await ownedProject(tx, projectId, ownerId);
    const state = consultationState(project.currentState);
    if (
      project.status !== "consultation" ||
      state.activeJobId ||
      !state.summary ||
      state.revision !== expectedRevision
    )
      throw new ConsultationError(
        "Wait for the current response and refresh before editing the summary.",
      );
    const readyToComplete =
      state.readyToComplete && summary.openQuestions.length === 0;
    await tx
      .insert(consultationMessages)
      .values({
        projectId,
        role: "user",
        createdAt: sql`clock_timestamp()`,
        content: `I corrected the requirements summary:\n${JSON.stringify(summary, null, 2)}`,
        metadata: { kind: "summary_correction" },
      });
    await saveState(tx, project, {
      ...state,
      revision: state.revision + 1,
      summary,
      readyToComplete,
      status: readyToComplete ? "ready" : "collecting",
    });
  });
}
export async function finishConsultation(
  db: DbClient,
  ownerId: string,
  projectId: string,
  expectedRevision: number,
) {
  return db.transaction(async (tx) => {
    const project = await ownedProject(tx, projectId, ownerId);
    const state = consultationState(project.currentState);
    if (project.status === "prototype_pending" && state.status === "completed")
      return;
    if (
      state.revision !== expectedRevision ||
      state.activeJobId ||
      state.status !== "ready" ||
      !state.readyToComplete ||
      !state.summary
    )
      throw new ConsultationError(
        "Review the latest complete summary before finishing consultation.",
      );
    const summary = requirementsSchema.parse(state.summary);
    if (summary.openQuestions.length)
      throw new ConsultationError(
        "Resolve the open questions before finishing consultation.",
      );
    const transition = WorkflowStateMachine.transition(
      project.status,
      "prototype_pending",
      { projectId, actor: ownerId },
    );
    if (!transition.ok)
      throw new ConsultationError(
        "Project cannot complete consultation in its current state.",
      );
    await saveState(
      tx,
      project,
      {
        ...state,
        status: "completed",
        revision: state.revision + 1,
        completedAt: new Date().toISOString(),
      },
      "prototype_pending",
    );
    await tx
      .insert(lifecycleEvents)
      .values({
        projectId,
        eventType: "consultation.completed",
        payload: {
          actor: ownerId,
          from: "consultation",
          to: "prototype_pending",
          summaryRevision: state.revision,
        },
      });
    // M2 deliberately enqueues no prototype or PRD generation.
  });
}

export async function readConsultation(
  db: DbClient,
  ownerId: string,
  projectId: string,
) {
  return db.transaction(async (tx) => {
    const project = await ownedProject(tx, projectId, ownerId);
    const state = consultationState(project.currentState);
    const messages = await tx
      .select()
      .from(consultationMessages)
      .where(eq(consultationMessages.projectId, projectId))
      .orderBy(
        asc(consultationMessages.createdAt),
        asc(consultationMessages.id),
      );
    const [job] = state.activeJobId
      ? await tx
          .select()
          .from(workflowJobs)
          .where(eq(workflowJobs.id, state.activeJobId))
      : [];
    if (job && ["claimed", "running"].includes(job.status))
      state.status = "processing";
    if (job?.status === "failed") {
      state.status = "failed";
      state.error =
        state.error ??
        "The Planner job failed. Your messages are saved; you can retry.";
    }
    const assets = await tx
      .select({ id: projectAssets.id, filename: projectAssets.filename })
      .from(projectAssets)
      .where(eq(projectAssets.projectId, projectId));
    return {
      projectId,
      projectStatus: project.status,
      state,
      messages: messages.map(({ id, role, content, createdAt }) => ({
        id,
        role,
        content,
        createdAt: createdAt.toISOString(),
      })),
      budget: {
        ...(await budgetUsage(tx, projectId)),
        limitUsd: project.budgetLimitCents / 100,
      },
      assets,
    };
  });
}
export type ConsultationView = Awaited<ReturnType<typeof readConsultation>>;
