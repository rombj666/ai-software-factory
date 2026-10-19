import os from "node:os";

function required(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string, env: NodeJS.ProcessEnv): string {
  return env[name] ?? fallback;
}

export interface WorkerConfig {
  databaseUrl: string;
  workerId: string;
  pollIntervalMs: number;
  leaseSeconds: number;
  recoverStaleOnStart: boolean;
  maxAttempts: number;
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    databaseUrl: required("DATABASE_URL", env),
    workerId: optional("WORKER_ID", `worker-${os.hostname()}-${process.pid}`, env),
    pollIntervalMs: Number(optional("WORKER_POLL_INTERVAL_MS", "2000", env)),
    leaseSeconds: Number(optional("WORKER_LEASE_SECONDS", "120", env)),
    recoverStaleOnStart: optional("WORKER_RECOVER_STALE_ON_START", "true", env) === "true",
    maxAttempts: Number(optional("WORKER_MAX_ATTEMPTS", "3", env)),
  };
}
