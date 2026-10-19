import type { DbClient } from "@asf/db";
import { loadWorkerConfig } from "./config";
import { getDb } from "./db";
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

async function dispatch(job: ClaimedJob): Promise<void> {
  let result: Record<string, unknown>;
  switch (job.type) {
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
  while (running) {
    try {
      if (config.recoverStaleOnStart) {
        const recovered = await recoverStaleJobs(db);
        if (recovered > 0) {
          console.log(`[worker:${config.workerId}] recovered ${recovered} stale job(s)`);
        }
        config.recoverStaleOnStart = false;
      }

      const job = await claimNextJob(db, config.workerId, config.leaseSeconds);
      if (!job) {
        await sleep(config.pollIntervalMs);
        continue;
      }

      console.log(`[worker:${config.workerId}] claimed job ${job.id} (${job.type})`);
      try {
        await dispatch(job);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[worker:${config.workerId}] job ${job.id} failed: ${message}`);
        const outcome = await failJob(db, job, message, config.maxAttempts);
        await recordLifecycleEvent(db, {
          projectId: job.projectId,
          eventType: outcome.status === "retry" ? "job.queued" : "job.failed",
          payload: { jobId: job.id, type: job.type, error: message, attempts: job.attempts + 1 },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[worker:${config.workerId}] loop error: ${message}`);
      await sleep(Math.max(config.pollIntervalMs, 5000));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker:${config.workerId}] ${signal} received, shutting down...`);
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
