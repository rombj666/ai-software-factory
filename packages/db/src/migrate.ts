import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Apply version-controlled migrations to the configured database.
 *
 * Usage: DATABASE_URL=postgres://... npm run db:migrate -w @asf/db
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("FATAL: DATABASE_URL is not set. Refusing to run migrations.");
    process.exit(1);
  }

  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "drizzle",
  );

  const client = postgres(connectionString, { max: 1, prepare: false });
  const db = drizzle(client);

  console.log(`Applying migrations from ${migrationsFolder} ...`);
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied successfully.");

  await client.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});