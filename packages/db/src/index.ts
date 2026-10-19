import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DbClient = ReturnType<typeof createDb>;

export const schemaRef = schema;

/**
 * Create a Drizzle client bound to a PostgreSQL connection URL
 * (Neon-compatible via postgres.js driver).
 *
 * Production callers must pass a real DATABASE_URL; tests may inject a local
 * or ephemeral Postgres URL.
 */
export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    max: 1,
    prepare: false,
    ssl: connectionString.includes("neon.tech") ? { rejectUnauthorized: false } : undefined,
  });
  return drizzle(client, { schema, casing: "snake_case" });
}