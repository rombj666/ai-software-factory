import type { DbClient } from "@asf/db";
import { loadWorkerConfig } from "./config";
import { getDb } from "./db";
import { handleConsultationTurn } from "./consultation";
import { handlePrototypeTask, cleanupPrototypeOrphans } from "./prototype";
import { isDatabaseError, safeError } from "./errors";
import { runPollingLoop } from "./polling";
import {
  claimNextJob,
  completeJob,
  failJob,
  handleProjectInitialization,
  recoverStaleJobs,
  recordLifecycleEvent,
  type ClaimedJob,
} from "./jobQueue";

/**
 * Operational Worker process for M1.
 *
 * Loop: recover stale leases → claim next job → dispatch by type → complete
 * or fail. Graceful shutdown on SIGINT/SIGTERM. Requires DATABASE_URL.
 */
const config = loadWorkerConfig();
const db: DbClient = getDb(config.databaseUrl);

let running = true;
let loopPromise: Promise<void> | null = null;
const recoveryIntervalMs = Math.max(30_000, config.leaseSeconds * 500);
let nextRecoveryAt = config.recoverStaleOnStart
  ? 0
  : Date.now() + recoveryIntervalMs;

async function dispatch(job: ClaimedJob): Promise<void> {
  let result: Record<string, unknown>;
  switch (job.type) {
    case "prototype_task":
      await handlePrototypeTask(db, job, config.workerId, config.leaseSeconds);
      return;
    case "consultation_turn":
      await handleConsultationTurn(
        db,
        job,
        config.workerId,
        config.leaseSeconds,
      );
      return;
    case "project_initialization":
      result = await handleProjectInitialization(db, job);
      break;
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
  await completeJob(db, job.id, result);
  await recordLifecycleEvent(db, {
    projectId: job.projectId,
    eventType: "job.succeeded",
    payload: { jobId: job.id, type: job.type },
  });
  console.log(
    `[worker:${config.workerId}] job ${job.id} (${job.type}) succeeded`,
  );
}

async function loop(): Promise<void> {
  const healthy = await runPollingLoop({
    isRunning: () => running,
    pollIntervalMs: config.pollIntervalMs,
    sleep,
    onError: (error, fatal, retryInMs) => {
      console.error(`[worker:${config.workerId}] loop error`, {
        ...safeError(error, config.databaseUrl),
        fatal,
        retryInMs,
      });
    },
    tick: async () => {
      if (Date.now() >= nextRecoveryAt) {
        const recovered = await recoverStaleJobs(db);
        if (recovered > 0) {
          console.log(
            `[worker:${config.workerId}] recovered ${recovered} stale job(s)`,
          );
        }
        nextRecoveryAt = Date.now() + recoveryIntervalMs;
        if (process.env.BLOB_READ_WRITE_TOKEN) await cleanupPrototypeOrphans(db);
      }

      const job = await claimNextJob(db, config.workerId, config.leaseSeconds);
      if (!job) {
        await sleep(config.pollIntervalMs);
        return;
      }

      console.log(
        `[worker:${config.workerId}] claimed job ${job.id} (${job.type})`,
      );
      try {
        await dispatch(job);
      } catch (err) {
        // Infrastructure failures must reach the loop's circuit breaker, rather
        // than consuming a job attempt or writing SQL/parameters to its error.
        if (isDatabaseError(err)) throw err;
        const diagnostic = safeError(err, config.databaseUrl);
        const message = String(diagnostic.message);
        console.error(
          `[worker:${config.workerId}] job ${job.id} failed`,
          diagnostic,
        );
        const outcome = await failJob(db, job, message, config.maxAttempts);
        await recordLifecycleEvent(db, {
          projectId: job.projectId,
          eventType: outcome.status === "retry" ? "job.queued" : "job.failed",
          payload: {
            jobId: job.id,
            type: job.type,
            error: message,
            attempts: job.attempts + 1,
          },
        });
      }
    },
  });
  if (!healthy) {
    running = false;
    console.error(
      `[worker:${config.workerId}] stopped after database/loop failure; operator intervention required`,
    );
    await db.$client.end({ timeout: 5 });
    process.exitCode = 1;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shutdown(signal: string): Promise<void> {
  console.log(
    `[worker:${config.workerId}] ${signal} received, shutting down...`,
  );
  running = false;
  if (loopPromise) {
    await Promise.race([loopPromise, sleep(5000)]);
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.log(
  `[worker:${config.workerId}] starting (poll=${config.pollIntervalMs}ms, lease=${config.leaseSeconds}s, maxAttempts=${config.maxAttempts})`,
);
loopPromise = loop();
