import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { createDb, type DbClient } from "@asf/db";
import { agentRuns, artifacts, cleanupJobs, projects, prototypeVersions, usageLogs, workflowJobs } from "@asf/db/schema";
import { approvePrototypeScreen, enqueuePrototype, finishPrototype, quotePrototype, readPrototype, readPrototypeHandoff, saveDesignPlan } from "@asf/agents/prototype";
import { prototypeState } from "@asf/agents/prototype-schema";
import { ProviderError } from "@asf/agents/provider";
import { design } from "../../../packages/agents/test/prototype-fixtures";
import { summary } from "../../../packages/agents/test/fixtures";
import { handlePrototypeTask, cleanupPrototypeOrphans } from "../src/prototype";
import { claimNextJob, recoverStaleJobs, type ClaimedJob } from "../src/jobQueue";

const testUrl = process.env.PROTOTYPE_TEST_DATABASE_URL;
describe.skipIf(!testUrl)("M3 real disposable PostgreSQL; mocked OpenAI and Blob", () => {
  let db: DbClient; let second: DbClient; let png: Buffer;
  const owner = `m3-test-${randomUUID()}`;
  const worker = "m3-test-worker";
  const model = "gpt-image-2.5-flare";
  const settings = { quality: "low" as const, size: "1536x1024" as const };
  const storage = { read: vi.fn(), write: vi.fn(), remove: vi.fn() };
  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/asf_m3_test") throw new Error("Use only disposable local asf_m3_test.");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-only-never-used-for-network");
    vi.stubEnv("OPENAI_IMAGE_EDIT_INPUT_TOKEN_BOUND", "10000");
    vi.stubEnv("OPENAI_IMAGE_EDIT_BOUND_SOURCE", "test fixture only; not a production bound");
    db = createDb(testUrl!); second = createDb(testUrl!);
    const existing = await db.execute(sql`select to_regclass('public.projects') as name`);
    if (!existing[0]?.name) {
      const migration = await readFile(new URL("../../../packages/db/drizzle/0000_magical_karnak.sql", import.meta.url), "utf8");
      await db.transaction(async tx => { for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) await tx.execute(sql.raw(statement)); });
    }
    png = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: "white" } }).png().toBuffer();
    storage.read.mockResolvedValue(png); storage.write.mockResolvedValue(undefined); storage.remove.mockResolvedValue(undefined);
  });
  afterAll(async () => { vi.unstubAllEnvs(); if (db) await db.$client.end(); if (second) await second.$client.end(); });
  async function project(withPlan = true, budget = 2000) {
    const [row] = await db.insert(projects).values({ ownerId: owner, title: `M3 ${randomUUID()}`, idea: "Private reading list", status: "prototype_pending", budgetLimitCents: budget,
      currentState: { consultation: { status: "completed", revision: 7, summary, activeJobId: null }, ...(withPlan ? { prototype: { ...prototypeState(null), design, planRevision: 1, acceptedPlanRevision: 1 } } : {}) } }).returning();
    return row!.id;
  }
  async function request(id: string, mode: "plan" | "generate" | "edit" | "regenerate" = "generate", extra: Record<string, unknown> = {}) {
    const view = await readPrototype(db, owner, id);
    const input = { mode, feedback: mode === "edit" ? "Use a green primary color" : "", expectedRevision: view.state.revision,
      ...(mode === "plan" ? {} : { screenId: "reading-list", settings }), ...extra };
    const quote = await quotePrototype(db, owner, id, input);
    return { ...input, confirmed: true, quoteHash: quote.quoteHash, requestId: randomUUID() };
  }
  async function claim(id: string): Promise<ClaimedJob> {
    const view = await readPrototype(db, owner, id);
    const [job] = await db.update(workflowJobs).set({ status: "claimed", claimedBy: worker, leaseExpiresAt: new Date(Date.now() + 120000) }).where(eq(workflowJobs.id, view.state.activeJobId!)).returning();
    return job as ClaimedJob;
  }
  function images() { return { model, create: vi.fn().mockResolvedValue({ model, base64: png.toString("base64"), usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300, input_tokens_details: { text_tokens: 100, image_tokens: 0 } }, requestId: "req_mock", durationMs: 10 }) }; }
  async function generate(id: string) {
    await enqueuePrototype(db, owner, id, await request(id));
    const provider = images(); await handlePrototypeTask(db, await claim(id), worker, 120, { images: provider, storage });
    return readPrototype(db, owner, id);
  }
  it("loads only completed consultation and enforces ownership on reads, quotes and writes", async () => {
    const id = await project();
    expect((await readPrototype(db, owner, id)).requirements).toEqual(summary);
    await expect(readPrototype(db, "other-user", id)).rejects.toThrow("not found");
    await expect(quotePrototype(db, "other-user", id, { mode: "plan", feedback: "", expectedRevision: 0 })).rejects.toThrow("not found");
    await expect(saveDesignPlan(db, "other-user", id, 0, design, true)).rejects.toThrow("not found");
    await db.update(projects).set({ currentState: {} }).where(eq(projects.id, id));
    await expect(readPrototype(db, owner, id)).rejects.toThrow("consultation");
  });
  it("plans real durable jobs, persists specification and requires human acceptance before images", async () => {
    const id = await project(false);
    const input = await request(id, "plan"); await enqueuePrototype(db, owner, id, input);
    const planner = { model: "gpt-4.1-mini-2025-04-14", maxOutputTokens: 6000, inputTokenBound: () => 5000,
      consult: vi.fn().mockResolvedValue({ id: "plan_mock", model: "gpt-4.1-mini-2025-04-14", value: design, usage: { inputTokens: 100, outputTokens: 100, cachedInputTokens: 0 }, outcome: "completed", durationMs: 10 }) };
    await handlePrototypeTask(db, await claim(id), worker, 120, { planner, storage });
    const view = await readPrototype(db, owner, id);
    expect(view.state.design?.screens).toHaveLength(1);
    expect(view.state.acceptedPlanRevision).toBeNull();
    expect(planner.consult).toHaveBeenCalledOnce();
    await expect(request(id)).rejects.toThrow("accept");
    const logs = await db.select().from(usageLogs).where(eq(usageLogs.projectId, id));
    expect(logs).toHaveLength(1);
  });
  it("saves screen edits, invalidates approvals and rejects stale revisions", async () => {
    const id = await project();
    const revised = { ...design, screens: [{ ...design.screens[0]!, name: "Books" }] };
    await saveDesignPlan(db, owner, id, 0, revised, true);
    const view = await readPrototype(db, owner, id);
    expect(view.state.planRevision).toBe(2);
    expect(view.state.design?.screens[0]?.name).toBe("Books");
    await expect(saveDesignPlan(db, owner, id, 0, revised, true)).rejects.toThrow("changed");
    await expect(finishPrototype(db, owner, id, view.state.revision)).rejects.toThrow("every required screen");
  });
  it("generates one selected screen, saves private metadata and approves exact versions through the state machine", async () => {
    const id = await project(); const view = await generate(id);
    expect(view.versions).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain("storageUri");
    expect(view.versions[0]?.imagePath).toContain(`/api/projects/${id}/prototypes/`);
    expect(view.budget.spentUsd).toBe(0.0065);
    expect(view.budget.reservedUsd).toBe(0);
    await expect(approvePrototypeScreen(db, "other-user", id, view.state.revision, "reading-list", view.versions[0]!.id)).rejects.toThrow("not found");
    await approvePrototypeScreen(db, owner, id, view.state.revision, "reading-list", view.versions[0]!.id);
    const approved = await readPrototype(db, owner, id);
    await finishPrototype(db, owner, id, approved.state.revision);
    await finishPrototype(db, owner, id, approved.state.revision);
    const final = await readPrototype(db, owner, id);
    expect(final.projectStatus).toBe("prototype_approved");
    const handoff = await readPrototypeHandoff(db, owner, id);
    expect(handoff).toMatchObject({ schemaVersion: 1, design, approvedBy: owner });
    expect((await db.select().from(workflowJobs).where(eq(workflowJobs.projectId, id))).map(j => j.type)).toEqual(["prototype_task"]);
  });
  it("edits an existing image, preserves history and invalidates previous approval", async () => {
    const id = await project(); const first = await generate(id);
    await approvePrototypeScreen(db, owner, id, first.state.revision, "reading-list", first.versions[0]!.id);
    const input = await request(id, "edit", { baseVersionId: first.versions[0]!.id });
    await enqueuePrototype(db, owner, id, input);
    const provider = images();
    await handlePrototypeTask(db, await claim(id), worker, 120, { images: provider, storage });
    expect(provider.create.mock.calls[0]![2]).toHaveLength(1);
    const view = await readPrototype(db, owner, id);
    expect(view.versions.map(v => v.version)).toEqual([1, 2]);
    expect(view.state.approvals["reading-list"]).toBeUndefined();
    await expect(approvePrototypeScreen(db, owner, id, view.state.revision, "reading-list", first.versions[0]!.id)).rejects.toThrow("latest");
  });
  it("deduplicates requests and serializes competing jobs on a project", async () => {
    const id = await project(); const input = await request(id);
    await Promise.all([enqueuePrototype(db, owner, id, input), enqueuePrototype(second, owner, id, input)]);
    expect(await db.select().from(workflowJobs).where(eq(workflowJobs.projectId, id))).toHaveLength(1);
    expect((await readPrototype(db, owner, id)).budget.reservedUsd).toBeGreaterThan(0);
    await expect(enqueuePrototype(db, owner, id, { ...input, feedback: "different" })).rejects.toThrow("different content");
    await expect(enqueuePrototype(db, owner, id, { ...input, requestId: randomUUID() })).rejects.toThrow("changed");
    const job = await claim(id); const provider = images();
    await Promise.all([handlePrototypeTask(db, job, worker, 120, { images: provider, storage }), handlePrototypeTask(second, job, worker, 120, { images: provider, storage })]);
    expect(provider.create).toHaveBeenCalledOnce();
    expect((await readPrototype(db, owner, id)).versions).toHaveLength(1);
  });
  it("rejects missing confirmation, stale quotes and insufficient budgets before dispatch", async () => {
    const id = await project(true, 1); const input = await request(id);
    await expect(enqueuePrototype(db, owner, id, { ...input, confirmed: false })).rejects.toThrow();
    await expect(enqueuePrototype(db, owner, id, { ...input, quoteHash: "a".repeat(64) })).rejects.toThrow("Estimate changed");
    await expect(enqueuePrototype(db, owner, id, input)).rejects.toThrow("budget");
    expect(await db.select().from(agentRuns).where(eq(agentRuns.projectId, id))).toHaveLength(0);
  });
  it("retains uncertain costs and never retries a timed-out image request", async () => {
    const id = await project(); await enqueuePrototype(db, owner, id, await request(id));
    const provider = images(); provider.create.mockRejectedValue(new ProviderError("Uncertain timeout", false, true));
    const job = await claim(id); await handlePrototypeTask(db, job, worker, 120, { images: provider, storage });
    await handlePrototypeTask(db, job, worker, 120, { images: provider, storage });
    const view = await readPrototype(db, owner, id);
    expect(view.state.status).toBe("failed"); expect(view.budget.spentUsd).toBeGreaterThan(0); expect(view.budget.reservedUsd).toBe(0);
    expect(provider.create).toHaveBeenCalledOnce();
  });
  it("settles a crashed dispatched run conservatively without calling the provider", async () => {
    const id = await project(); await enqueuePrototype(db, owner, id, await request(id)); const job = await claim(id);
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.projectId, id));
    await db.update(agentRuns).set({ input: { ...run!.input, phase: "dispatched" } }).where(eq(agentRuns.id, run!.id));
    await db.update(workflowJobs).set({ status: "running", leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(workflowJobs.id, job.id));
    await recoverStaleJobs(db); const recovered = await claim(id); const provider = images();
    await handlePrototypeTask(db, recovered, worker, 120, { images: provider, storage });
    expect(provider.create).not.toHaveBeenCalled();
    expect((await readPrototype(db, owner, id)).state.error).toContain("interrupted");
    expect(await db.select().from(usageLogs).where(eq(usageLogs.projectId, id))).toHaveLength(1);
  });
  it("records billed invalid output without saving an image version", async () => {
    const id = await project(); await enqueuePrototype(db, owner, id, await request(id)); const provider = images();
    provider.create.mockResolvedValue({ model, base64: Buffer.from("bad png").toString("base64"), usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300, input_tokens_details: { text_tokens: 100, image_tokens: 0 } } });
    await handlePrototypeTask(db, await claim(id), worker, 120, { images: provider, storage });
    const view = await readPrototype(db, owner, id);
    expect(view.versions).toHaveLength(0); expect(view.budget.spentUsd).toBe(0.0065);
  });
  it("retains the estimate when usage is absent and safely sweeps failed uploads", async () => {
    const id = await project(); await enqueuePrototype(db, owner, id, await request(id)); const provider = images();
    provider.create.mockResolvedValue({ model, base64: png.toString("base64"), usage: null });
    storage.write.mockRejectedValueOnce(new Error("upload uncertain"));
    await handlePrototypeTask(db, await claim(id), worker, 120, { images: provider, storage });
    expect((await readPrototype(db, owner, id)).versions).toHaveLength(0);
    expect((await readPrototype(db, owner, id)).budget.spentUsd).toBeGreaterThan(0);
    await db.update(cleanupJobs).set({ scheduledFor: new Date(Date.now() - 1000) }).where(eq(cleanupJobs.projectId, id));
    const [target] = await db.select().from(cleanupJobs).where(eq(cleanupJobs.projectId, id));
    // Reused disposable databases can contain older due cleanup records. The
    // sweeper's ten-object batch may legitimately process those on later calls.
    for (let batch = 0; batch < 10; batch++) {
      await cleanupPrototypeOrphans(db, storage);
      const [current] = await db.select().from(cleanupJobs).where(eq(cleanupJobs.id, target!.id));
      if (current?.status === "succeeded") break;
    }
    const countForTarget = () => storage.remove.mock.calls.filter(call => call[0] === target!.externalId).length;
    expect(countForTarget()).toBe(1);
    await cleanupPrototypeOrphans(db, storage); expect(countForTarget()).toBe(1);
    expect(await db.select().from(prototypeVersions).where(eq(prototypeVersions.projectId, id))).toHaveLength(0);
  });
  it("claims distinct queued projects across independent Workers", async () => {
    const id1 = await project(); const id2 = await project();
    await enqueuePrototype(db, owner, id1, await request(id1)); await enqueuePrototype(db, owner, id2, await request(id2));
    const [first, other] = await Promise.all([claimNextJob(db, "worker-a", 120), claimNextJob(second, "worker-b", 120)]);
    expect(first?.id).toBeTruthy(); expect(other?.id).toBeTruthy(); expect(first?.id).not.toBe(other?.id);
    expect(await db.select().from(artifacts).where(and(eq(artifacts.projectId, id1), eq(artifacts.kind, "prototype_image")))).toHaveLength(0);
  });
  it("recovers a reservation interrupted before dispatch and executes it once", async () => {
    const id = await project(); await enqueuePrototype(db, owner, id, await request(id));
    const job = await claim(id);
    await db.update(workflowJobs).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(workflowJobs.id, job.id));
    await recoverStaleJobs(db);
    const provider = images(); await handlePrototypeTask(db, await claim(id), worker, 120, { images: provider, storage });
    expect(provider.create).toHaveBeenCalledOnce();
    expect((await readPrototype(db, owner, id)).versions).toHaveLength(1);
  });
  it("releases a known unbilled access rejection and requires an explicit new request", async () => {
    const id = await project(); await enqueuePrototype(db, owner, id, await request(id));
    const provider = images(); provider.create.mockRejectedValue(new ProviderError("Model access denied", false, false));
    await handlePrototypeTask(db, await claim(id), worker, 120, { images: provider, storage });
    const view = await readPrototype(db, owner, id);
    expect(view.budget.spentUsd).toBe(0); expect(view.budget.reservedUsd).toBe(0);
    expect(view.state.activeJobId).toBeNull(); expect(provider.create).toHaveBeenCalledOnce();
  });
  it("retains the reservation on successful images without usage and never cleans linked versions", async () => {
    const id = await project(); await enqueuePrototype(db, owner, id, await request(id));
    const provider = images(); provider.create.mockResolvedValue({ model, base64: png.toString("base64"), usage: null });
    await handlePrototypeTask(db, await claim(id), worker, 120, { images: provider, storage });
    const view = await readPrototype(db, owner, id);
    expect(view.versions[0]?.costBasis).toBe("reserved_upper_bound_no_usage");
    const [version] = await db.select().from(prototypeVersions).where(eq(prototypeVersions.projectId, id));
    await db.update(cleanupJobs).set({ status: "pending", scheduledFor: new Date(Date.now() - 1000) }).where(eq(cleanupJobs.projectId, id));
    await cleanupPrototypeOrphans(db, storage);
    expect(storage.remove.mock.calls.some(call => call[0] === version!.imageStorageUri)).toBe(false);
  });
});
