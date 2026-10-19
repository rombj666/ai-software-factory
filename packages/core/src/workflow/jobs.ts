/**
 * Database-backed background job semantics shared by the Worker and the Web
 * app. Claiming rules:
 *   - a job is claimable when it is `queued` and `available_at <= now`;
 *   - claiming atomically sets status=`claimed`, `claimed_by` and a lease;
 *   - stale leases (expired while still claimed/running) are recoverable.
 */
export const JOB_STATUSES = [
  "queued",
  "claimed",
  "running",
  "succeeded",
  "failed",
  "paused",
  "cancelled",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_JOB_STATUSES = ["succeeded", "failed", "cancelled"] as const;

export const DEFAULT_LEASE_SECONDS = 120;

export function isTerminalJobStatus(status: JobStatus): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

export interface JobClaimInput {
  status: JobStatus;
  availableAt: Date;
  now: Date;
}

export function isClaimable(input: JobClaimInput): boolean {
  return input.status === "queued" && input.availableAt <= input.now;
}

export interface LeaseInput {
  now: Date;
  leaseSeconds?: number;
}

export function computeLeaseExpiry(input: LeaseInput): Date {
  return new Date(input.now.getTime() + (input.leaseSeconds ?? DEFAULT_LEASE_SECONDS) * 1000);
}

export interface RecoveryInput {
  status: JobStatus;
  leaseExpiresAt: Date | null;
  now: Date;
}

/**
 * A claimed/running job whose lease has expired can be recovered (reset to
 * queued) by a worker after a crash or restart.
 */
export function isRecoverable(input: RecoveryInput): boolean {
  if (input.status !== "claimed" && input.status !== "running") return false;
  if (input.leaseExpiresAt === null) return true; // safety: no lease means stale
  return input.leaseExpiresAt < input.now;
}

export function canRetry(attempts: number, maxAttempts: number): boolean {
  return attempts < maxAttempts;
}

export function nextAvailableAt(
  base: Date,
  attempt: number,
  backoffSeconds = 30,
): Date {
  return new Date(base.getTime() + attempt * backoffSeconds * 1000);
}