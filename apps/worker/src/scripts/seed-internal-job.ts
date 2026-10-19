import { createDb } from "@asf/db";
import { projects, workflowJobs } from "@asf/db/schema";
import { eq } from "drizzle-orm";

/**
 * M1 verification helper: seed ONE internal `project_initialization` job for
 * a real project row, so the database → worker pipeline can be exercised.
 *
 * Usage: DATABASE_URL=... npm run seed:internal-job -w @asf/worker
 *
 * Outputs the created project id and job id; a running Worker will claim the
 * job and advance the project from `idea_submitted` to `consultation`.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("FATAL: DATABASE_URL is not set.");
    process.exit(1);
  }

  const db = createDb(connectionString);

  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.title, "Internal M1 Pipeline Verification"));

  const projectId = existing?.id;
  if (projectId) {
    console.log(`Reusing existing verification project: ${projectId}`);
  } else {
    const inserted = await db
      .insert(projects)
      .values({
        ownerId: "internal-m1-verification",
        title: "Internal M1 Pipeline Verification",
        idea: "Internal job used to verify the database-to-worker processing pipeline in Milestone 1.",
        status: "idea_submitted",
      })
      .returning({ id: projects.id });
    const insertedRow = inserted[0];
    if (!insertedRow) {
      throw new Error("Failed to insert verification project");
    }
    console.log(`Created verification project: ${insertedRow.id}`);
  }

  const insertedJobs = await db
    .insert(workflowJobs)
    .values({
      projectId: projectId ?? null,
      type: "project_initialization",
      payload: { projectId, trigger: "internal", note: "M1 pipeline verification" },
      status: "queued",
    })
    .returning({ id: workflowJobs.id });

  const job = insertedJobs[0];
  if (!job) {
    throw new Error("Failed to insert internal job");
  }
  console.log(`Queued internal job: ${job.id}`);
  console.log("Start the worker (npm run start:worker) to observe processing.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
