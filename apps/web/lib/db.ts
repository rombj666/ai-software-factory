import { createDb } from "@asf/db";

let cached: ReturnType<typeof createDb> | null = null;

/**
 * Lazily create the Web database client. Never executed during `next build`
 * (server actions only run at request time), so a missing DATABASE_URL does
 * not break compilation; requests fail loudly instead.
 */
export function db(): ReturnType<typeof createDb> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Configure the Neon Postgres connection (see .env.example).",
    );
  }
  if (!cached) {
    cached = createDb(connectionString);
  }
  return cached;
}
