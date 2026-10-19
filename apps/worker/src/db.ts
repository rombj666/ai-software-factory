import { createDb } from "@asf/db";

let cached: ReturnType<typeof createDb> | null = null;

/**
 * Lazily create the Worker database client. Callers must provide DATABASE_URL
 * (enforced by loadWorkerConfig before this runs).
 */
export function getDb(databaseUrl: string) {
  if (!cached) {
    cached = createDb(databaseUrl);
  }
  return cached;
}
