import { isPermanentError } from "./errors";

export const MAX_CONSECUTIVE_ERRORS = 5;

/** Returns false on a fatal error; callers close the connection and exit. */
export async function runPollingLoop(options: {
  isRunning: () => boolean;
  tick: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  onError: (error: unknown, fatal: boolean, retryInMs: number) => void;
  pollIntervalMs: number;
}): Promise<boolean> {
  let failures = 0;
  while (options.isRunning()) {
    try {
      await options.tick();
      failures = 0;
    } catch (error) {
      failures++;
      const fatal = isPermanentError(error) || failures >= MAX_CONSECUTIVE_ERRORS;
      const retryInMs = fatal ? 0 : Math.min(Math.max(options.pollIntervalMs, 5000) * 2 ** (failures - 1), 60_000);
      options.onError(error, fatal, retryInMs);
      if (fatal) return false;
      await options.sleep(retryInMs);
    }
  }
  return true;
}
