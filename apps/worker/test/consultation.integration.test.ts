import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDb, type DbClient } from "@asf/db";
import {
  agentRuns,
  consultationMessages,
  projects,
  usageLogs,
  workflowJobs,
} from "@asf/db/schema";
import {
  createConsultationProject,
  editRequirements,
  enqueueConsultation,
  finishConsultation,
  readConsultation,
} from "@asf/agents/consultation";
import { loadPricing } from "@asf/agents/pricing";
import { ProviderError, type AIProvider } from "@asf/agents/provider";
import {
  ready,
  question,
  summary,
} from "../../../packages/agents/test/fixtures";
import { handleConsultationTurn } from "../src/consultation";
import { recoverStaleJobs, type ClaimedJob } from "../src/jobQueue";

const testUrl = process.env.CONSULTATION_TEST_DATABASE_URL;
describe.skipIf(!testUrl)(
  "M2 PostgreSQL persistence and Worker integration",
  () => {
    let db: DbClient;
    let second: DbClient;
    const ownerId = `m2-test-${randomUUID()}`;
    const pricing = loadPricing("gpt-4.1-mini-2025-04-14", {});
    const workerId = "test-planner-worker";
    beforeAll(async () => {
      const url = new URL(testUrl!);
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/asf_m2_test"
      )
        throw new Error("Use only a disposable local asf_m2_test database.");
      db = createDb(testUrl!);
      second = createDb(testUrl!);
      const rows = await db.execute(
        sql`SELECT to_regclass('public.projects') AS table_name`,
      );
      if (!rows[0]?.table_name) {
        const migration = await readFile(
          new URL(
            "../../../packages/db/drizzle/0000_magical_karnak.sql",
            import.meta.url,
          ),
          "utf8",
        );
        await db.transaction(async (tx) => {
          for (const statement of migration.split("--> statement-breakpoint"))
            if (statement.trim()) await tx.execute(sql.raw(statement));
        });
      }
    });
    afterAll(async () => {
      if (db) await db.$client.end();
      if (second) await second.$client.end();
    });
    async function project() {
      return createConsultationProject(
        db,
        ownerId,
        `Club ${randomUUID()}`,
        "A Python desktop reading list for a private book club.",
      );
    }
    function provider(value: unknown = question) {
      return {
        model: pricing.model,
        maxOutputTokens: 2500,
        inputTokenBound: () => 5000,
        consult: vi
          .fn<AIProvider["consult"]>()
          .mockResolvedValue({
            id: `resp_${randomUUID()}`,
            model: pricing.model,
            value,
            usage: {
              inputTokens: 1000,
              outputTokens: 100,
              cachedInputTokens: 500,
            },
            durationMs: 123,
            outcome: "completed",
          }),
      };
    }
    async function claim(projectId: string): Promise<ClaimedJob> {
      const view = await readConsultation(db, ownerId, projectId);
      const [job] = await db
        .update(workflowJobs)
        .set({
          status: "claimed",
          claimedBy: workerId,
          leaseExpiresAt: new Date(Date.now() + 120_000),
          startedAt: new Date(),
        })
        .where(eq(workflowJobs.id, view.state.activeJobId!))
        .returning();
      if (!job) throw new Error("Test claim failed");
      return {
        id: job.id,
        projectId,
        type: job.type,
        payload: job.payload ?? {},
        attempts: job.attempts,
      };
    }
    async function respond(projectId: string, value: unknown = question) {
      const ai = provider(value);
      await handleConsultationTurn(db, await claim(projectId), workerId, 120, {
        provider: ai,
        pricing,
      });
      return ai;
    }
    async function rowsFor<
      T extends
        | typeof usageLogs
        | typeof agentRuns
        | typeof workflowJobs
        | typeof consultationMessages,
    >(table: T, projectId: string) {
      return db.select().from(table).where(eq(table.projectId, projectId));
    }

    it("creates a consultation and persistent initial message/job atomically", async () => {
      const id = await project();
      const view = await readConsultation(db, ownerId, id);
      expect(view.projectStatus).toBe("consultation");
      expect(view.state).toMatchObject({ revision: 1, status: "queued" });
      expect(view.messages).toHaveLength(1);
      expect(view.messages[0]?.content).toContain("Python desktop");
      expect(await rowsFor(workflowJobs, id)).toHaveLength(1);
      expect(await rowsFor(agentRuns, id)).toHaveLength(0);
    });
    it("rejects cross-owner reads, sends, edits, retries and completion", async () => {
      const id = await project();
      await expect(readConsultation(db, "other-owner", id)).rejects.toThrow(
        "not found",
      );
      for (const mode of ["start", "message", "retry"] as const)
        await expect(
          enqueueConsultation(db, "other-owner", id, {
            mode,
            requestId: randomUUID(),
            expectedRevision: 1,
            content: "Private",
          }),
        ).rejects.toThrow("not found");
      await expect(
        editRequirements(db, "other-owner", id, 1, summary),
      ).rejects.toThrow("not found");
      await expect(
        finishConsultation(db, "other-owner", id, 1),
      ).rejects.toThrow("not found");
      expect(await rowsFor(consultationMessages, id)).toHaveLength(1);
    });
    it("persists a real handler response, usage, duration, questions, answers, corrections and reviewed completion", async () => {
      const id = await project();
      await respond(id);
      const first = await readConsultation(second, ownerId, id); // independent client simulates refresh
      expect(first.messages).toHaveLength(2);
      expect(first.messages[1]?.content).toContain("Who should be able");
      expect(first.budget.spentUsd).toBe(0.00041);
      expect(first.budget.reservedUsd).toBe(0);
      const requestId = randomUUID();
      await enqueueConsultation(db, ownerId, id, {
        mode: "message",
        content: "Only the organizer. Correction: five members, not ten.",
        requestId,
        expectedRevision: first.state.revision,
      });
      const ai = await respond(id, ready);
      expect(
        ai.consult.mock.calls[0]![0].messages.some((message) =>
          message.content.includes("five members, not ten"),
        ),
      ).toBe(true);
      const reviewed = await readConsultation(db, ownerId, id);
      expect(reviewed.state.summary).toEqual(summary);
      expect(reviewed.state.status).toBe("ready");
      expect(reviewed.projectStatus).toBe("consultation"); // AI cannot complete the workflow
      await expect(finishConsultation(db, ownerId, id, 1)).rejects.toThrow(
        "latest",
      );
      await editRequirements(db, ownerId, id, reviewed.state.revision, {
        ...summary,
        productName: "Corrected book club",
      });
      const edited = await readConsultation(db, ownerId, id);
      expect(edited.messages.at(-1)?.role).toBe("user");
      expect(edited.state.summary?.productName).toBe("Corrected book club");
      await finishConsultation(db, ownerId, id, edited.state.revision);
      await finishConsultation(db, ownerId, id, edited.state.revision); // idempotent double click
      const done = await readConsultation(db, ownerId, id);
      expect(done.projectStatus).toBe("prototype_pending");
      expect(done.state.status).toBe("completed");
      expect(
        (await rowsFor(workflowJobs, id)).every(
          (job) => job.type === "consultation_turn",
        ),
      ).toBe(true);
      const runs = await rowsFor(agentRuns, id);
      expect(runs).toHaveLength(2);
      expect(runs[0]?.output).toMatchObject({
        durationMs: 123,
        usage: { inputTokens: 1000 },
      });
    });
    it("serializes concurrent requests across clients and rejects stale revisions", async () => {
      const id = await project();
      await respond(id);
      const input = {
        mode: "message" as const,
        requestId: randomUUID(),
        expectedRevision: 1,
        content: "Organizer only",
      };
      await Promise.all([
        enqueueConsultation(db, ownerId, id, input),
        enqueueConsultation(second, ownerId, id, input),
      ]);
      expect(await rowsFor(workflowJobs, id)).toHaveLength(2);
      expect(await rowsFor(consultationMessages, id)).toHaveLength(3);
      await expect(
        enqueueConsultation(db, ownerId, id, { ...input, content: "Changed" }),
      ).rejects.toThrow("different content");
      await expect(
        enqueueConsultation(db, ownerId, id, {
          ...input,
          requestId: randomUUID(),
        }),
      ).rejects.toThrow("changed");
      const current = await readConsultation(db, ownerId, id);
      await expect(
        enqueueConsultation(db, ownerId, id, {
          ...input,
          requestId: randomUUID(),
          expectedRevision: current.state.revision,
        }),
      ).rejects.toThrow("already processing");
    });
    it("never executes an already running or completed job twice", async () => {
      const id = await project();
      const job = await claim(id);
      const ai = provider();
      await Promise.all([
        handleConsultationTurn(db, job, workerId, 120, {
          provider: ai,
          pricing,
        }),
        handleConsultationTurn(second, job, workerId, 120, {
          provider: ai,
          pricing,
        }),
      ]);
      await handleConsultationTurn(db, job, workerId, 120, {
        provider: ai,
        pricing,
      });
      expect(ai.consult).toHaveBeenCalledOnce();
      expect(await rowsFor(usageLogs, id)).toHaveLength(1);
      expect((await readConsultation(db, ownerId, id)).messages).toHaveLength(
        2,
      );
    });
    it("refuses paid execution when the budget cannot cover its reservation", async () => {
      const id = await project();
      await db
        .update(projects)
        .set({ budgetLimitCents: 0 })
        .where(eq(projects.id, id));
      const ai = await respond(id);
      expect(ai.consult).not.toHaveBeenCalled();
      const view = await readConsultation(db, ownerId, id);
      expect(view.state.error).toContain("budget");
      expect(view.messages).toHaveLength(1);
      expect(await rowsFor(usageLogs, id)).toHaveLength(0);
    });
    it("includes existing spend and other outstanding reservations in the budget", async () => {
      const id = await project();
      await db
        .update(projects)
        .set({ budgetLimitCents: 1 })
        .where(eq(projects.id, id));
      await db
        .insert(usageLogs)
        .values({
          projectId: id,
          provider: "other",
          kind: "compute",
          unit: "USD",
          amount: "0.004",
        });
      await db
        .insert(agentRuns)
        .values({
          projectId: id,
          agentType: "other",
          status: "running",
          input: { reservationUsd: 0.004 },
        });
      const ai = await respond(id);
      expect(ai.consult).not.toHaveBeenCalled();
    });
    it("retains user messages on API failure and retries only explicit transient failures, bounded at three", async () => {
      const id = await project();
      const ai = provider();
      ai.consult.mockRejectedValue(
        new ProviderError("Rate limited", true, false),
      );
      for (let attempt = 0; attempt < 3; attempt++) {
        const job = await claim(id);
        await handleConsultationTurn(db, job, workerId, 120, {
          provider: ai,
          pricing,
        });
        const [stored] = await rowsFor(workflowJobs, id);
        expect(stored?.attempts).toBe(attempt + 1);
        if (attempt < 2) {
          expect(stored?.status).toBe("queued");
          expect(stored!.availableAt > new Date()).toBe(true);
        } else expect(stored?.status).toBe("failed");
      }
      const view = await readConsultation(db, ownerId, id);
      expect(view.messages).toHaveLength(1);
      expect(view.state.status).toBe("failed");
      expect(await rowsFor(agentRuns, id)).toHaveLength(3);
      expect(await rowsFor(usageLogs, id)).toHaveLength(0);
      await enqueueConsultation(db, ownerId, id, {
        mode: "retry",
        requestId: randomUUID(),
        expectedRevision: view.state.revision,
      });
      await respond(id);
      expect((await readConsultation(db, ownerId, id)).messages).toHaveLength(
        2,
      );
    });
    it("records billed invalid output without inventing an assistant answer or auto-retrying", async () => {
      const id = await project();
      const ai = await respond(id, { invalid: true });
      expect(ai.consult).toHaveBeenCalledOnce();
      const view = await readConsultation(db, ownerId, id);
      expect(view.state.status).toBe("failed");
      expect(view.messages).toHaveLength(1);
      expect(await rowsFor(usageLogs, id)).toHaveLength(1);
      expect(view.budget.spentUsd).toBeGreaterThan(0);
    });
    it("retains conservative cost for uncertain timeouts without automatic paid replays", async () => {
      const id = await project();
      const ai = provider();
      ai.consult.mockRejectedValue(
        new ProviderError("Outcome unknown", false, true),
      );
      await handleConsultationTurn(db, await claim(id), workerId, 120, {
        provider: ai,
        pricing,
      });
      const view = await readConsultation(db, ownerId, id);
      expect(view.state.status).toBe("failed");
      expect(view.budget.spentUsd).toBe(0.006);
      expect((await rowsFor(usageLogs, id))[0]?.metadata).toMatchObject({
        actualTokensKnown: false,
        costBasis: "uncertain_reserved_upper_bound",
      });
    });
    it("recovers a crashed paid attempt without duplicate AI calls or corrupting history", async () => {
      const id = await project();
      const job = await claim(id);
      await db
        .insert(agentRuns)
        .values({
          projectId: id,
          agentType: "planner_consultation",
          status: "running",
          input: { jobId: job.id, reservationUsd: 0.02 },
          startedAt: new Date(),
        });
      await db
        .update(workflowJobs)
        .set({ status: "running", leaseExpiresAt: new Date(Date.now() - 1000) })
        .where(eq(workflowJobs.id, job.id));
      expect(await recoverStaleJobs(db)).toBeGreaterThanOrEqual(1);
      const ai = provider();
      await handleConsultationTurn(db, await claim(id), workerId, 120, {
        provider: ai,
        pricing,
      });
      expect(ai.consult).not.toHaveBeenCalled();
      const view = await readConsultation(db, ownerId, id);
      expect(view.state.status).toBe("failed");
      expect(view.budget.spentUsd).toBe(0.02);
      expect(view.budget.reservedUsd).toBe(0);
      expect(view.messages).toHaveLength(1);
    });
    it("rejects premature completion and open summary questions", async () => {
      const id = await project();
      await expect(finishConsultation(db, ownerId, id, 1)).rejects.toThrow();
      await respond(id, ready);
      await editRequirements(db, ownerId, id, 1, {
        ...summary,
        openQuestions: ["Who are the administrators?"],
      });
      await expect(finishConsultation(db, ownerId, id, 2)).rejects.toThrow();
      expect((await readConsultation(db, ownerId, id)).projectStatus).toBe(
        "consultation",
      );
    });
    it("does not let a draft summary bypass Planner readiness", async () => {
      const id = await project();
      await respond(id, {
        ...ready,
        readyToComplete: false,
        questions: ["Who should administer the club?"],
      });
      await editRequirements(db, ownerId, id, 1, summary);
      const view = await readConsultation(db, ownerId, id);
      expect(view.state.readyToComplete).toBe(false);
      await expect(
        finishConsultation(db, ownerId, id, view.state.revision),
      ).rejects.toThrow();
    });
    it("fails oversized requests before paid execution", async () => {
      const id = await project();
      const ai = provider();
      await handleConsultationTurn(db, await claim(id), workerId, 120, {
        provider: ai,
        pricing,
        maxInputTokens: 1000,
      });
      expect(ai.consult).not.toHaveBeenCalled();
      expect((await readConsultation(db, ownerId, id)).state.error).toContain(
        "input limit",
      );
      expect(await rowsFor(usageLogs, id)).toHaveLength(0);
    });
    it("records missing Worker API configuration as a terminal failure with saved messages", async () => {
      const id = await project();
      vi.stubEnv("OPENAI_API_KEY", "");
      try {
        await handleConsultationTurn(db, await claim(id), workerId, 120);
      } finally {
        vi.unstubAllEnvs();
      }
      const view = await readConsultation(db, ownerId, id);
      expect(view.state.status).toBe("failed");
      expect(view.state.error).toContain("not configured");
      expect(view.messages).toHaveLength(1);
      expect(await rowsFor(usageLogs, id)).toHaveLength(0);
    });
    it("starts existing M1 projects and preserves other workflow state", async () => {
      const [legacy] = await db
        .insert(projects)
        .values({
          ownerId,
          title: `Legacy ${randomUUID()}`,
          idea: "A local tool",
          currentState: { anotherMilestone: { retained: true } },
        })
        .returning();
      const id = legacy!.id;
      await enqueueConsultation(db, ownerId, id, {
        mode: "start",
        requestId: randomUUID(),
        expectedRevision: 0,
      });
      await respond(id);
      const [stored] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, id));
      expect(stored?.status).toBe("consultation");
      expect(stored?.currentState?.anotherMilestone).toEqual({
        retained: true,
      });
      expect((await readConsultation(db, ownerId, id)).messages).toHaveLength(
        2,
      );
    });
    it("rejects stale job revisions without making a paid call", async () => {
      const id = await project();
      const job = await claim(id);
      const ai = provider();
      await handleConsultationTurn(
        db,
        { ...job, payload: { ...job.payload, revision: 0 } },
        workerId,
        120,
        { provider: ai, pricing },
      );
      expect(ai.consult).not.toHaveBeenCalled();
      const [stored] = await db
        .select()
        .from(workflowJobs)
        .where(
          and(
            eq(workflowJobs.id, job.id),
            eq(workflowJobs.status, "cancelled"),
          ),
        );
      expect(stored).toBeDefined();
    });
  },
);
