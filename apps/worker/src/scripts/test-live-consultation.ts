import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb } from "@asf/db";
import { projects, agentRuns, usageLogs } from "@asf/db/schema";
import {
  createConsultationProject,
  enqueueConsultation,
  finishConsultation,
  readConsultation,
} from "@asf/agents/consultation";
import { handleConsultationTurn } from "../consultation";
import { claimNextJob } from "../jobQueue";

/** Explicit opt-in live test. Never connects to DATABASE_URL or starts Railway. */
async function main() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.includes("..."))
    throw new Error("A valid OPENAI_API_KEY is required for the live test.");
  const connection = process.env.CONSULTATION_LIVE_DATABASE_URL;
  if (!connection)
    throw new Error(
      "Set CONSULTATION_LIVE_DATABASE_URL to a disposable local asf_m2_live_test database.",
    );
  const url = new URL(connection);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/asf_m2_live_test"
  )
    throw new Error(
      "The live API test only permits a disposable local asf_m2_live_test database.",
    );
  const db = createDb(connection);
  try {
    const existing = await db.execute(
      sql`SELECT to_regclass('public.projects') AS table_name`,
    );
    if (!existing[0]?.table_name) {
      const migration = await readFile(
        new URL(
          "../../../../packages/db/drizzle/0000_magical_karnak.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await db.transaction(async (tx) => {
        for (const statement of migration.split("--> statement-breakpoint"))
          if (statement.trim()) await tx.execute(sql.raw(statement));
      });
    }
    const ownerId = `live-test-${randomUUID()}`;
    const projectId = await createConsultationProject(
      db,
      ownerId,
      `Library live test ${randomUUID()}`,
      "I want software to organize a volunteer lending library.",
    );
    await db
      .update(projects)
      .set({ budgetLimitCents: 5 })
      .where(eq(projects.id, projectId));
    const workerId = `live-planner-${randomUUID()}`;
    async function turn() {
      const job = await claimNextJob(db, workerId, 120);
      assert(
        job && job.projectId === projectId,
        "Use an empty test queue; this test will not process unrelated jobs.",
      );
      await handleConsultationTurn(db, job, workerId, 120);
      const view = await readConsultation(db, ownerId, projectId);
      console.log(
        JSON.stringify({
          projectId,
          status: view.state.status,
          messages: view.messages.length,
          estimatedUsd: view.budget.spentUsd,
          error: view.state.error,
        }),
      );
      assert(
        view.state.status !== "failed",
        view.state.error ?? "Live AI request failed",
      );
      assert(
        view.state.status !== "queued",
        "Live API retry was queued; inspect the test project before attempting another paid call.",
      );
      assert(view.budget.spentUsd <= 0.05, "Live test budget exceeded");
      return view;
    }
    let view = await turn();
    const detail =
      "The users are two volunteer librarians and about 100 members. The goal is tracking which books are available, on loan, and overdue. Required features: searchable catalog, member records, check-out/return, due dates and an overdue list. Optional: email reminders later. Librarians sign in and manage records; members can browse without signing in. Store book titles, authors, identifiers, member names/emails and loan history privately in PostgreSQL; no payments or sensitive documents. Prefer a simple accessible light UI with clear search and large buttons. We want an online live-ready web app; Next.js is acceptable and there are no other technology preferences. A single library and English are sufficient. Please record these assumptions, resolve any previously asked questions with these answers and prepare the requirements summary when sufficient.";
    if (view.state.status !== "ready") {
      await enqueueConsultation(db, ownerId, projectId, {
        mode: "message",
        requestId: randomUUID(),
        expectedRevision: view.state.revision,
        content: detail,
      });
      view = await turn();
    }
    if (view.state.status !== "ready") {
      await enqueueConsultation(db, ownerId, projectId, {
        mode: "message",
        requestId: randomUUID(),
        expectedRevision: view.state.revision,
        content:
          "Use the reasonable defaults from my previous answer for any remaining nonessential choices and document them as assumptions. There are no additional requirements. Please prepare the review summary now.",
      });
      view = await turn();
    }
    assert(
      view.state.status === "ready" && view.state.summary,
      "Live consultation did not produce a complete summary within three paid calls.",
    );
    await finishConsultation(db, ownerId, projectId, view.state.revision);
    const done = await readConsultation(db, ownerId, projectId);
    assert.equal(done.projectStatus, "prototype_pending");
    const usage = await db
      .select()
      .from(usageLogs)
      .where(eq(usageLogs.projectId, projectId));
    const runs = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.projectId, projectId));
    console.log(
      JSON.stringify(
        {
          liveSuccess: true,
          projectId,
          projectStatus: done.projectStatus,
          estimatedUsd: done.budget.spentUsd,
          runs: runs.length,
          usage: usage.map((row) => ({
            amount: row.amount,
            metadata: row.metadata,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await db.$client.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Live consultation test failed",
  );
  process.exitCode = 1;
});
