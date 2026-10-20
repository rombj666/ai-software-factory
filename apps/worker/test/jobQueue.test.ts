import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { createDb, type DbClient } from "@asf/db";
import { workflowJobs } from "@asf/db/schema";
import { claimNextJob, recoverStaleJobs } from "../src/jobQueue";

const dialect = new PgDialect();

describe("postgres.js timestamp binding", () => {
  it("reproduces the raw Date serializer failure and verifies the column encoder", async () => {
    const db = createDb("postgres://localhost/unused");
    try {
      const date = new Date("2026-10-20T00:00:00Z");
      const serializers = db.$client.options.serializers as unknown as Record<string, (value: unknown) => string>;
      const legacy = dialect.sqlToQuery(sql`SELECT ${date}::timestamptz`);
      expect(() => Buffer.byteLength(serializers[1184]!(legacy.params[0])))
        .toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
      const fixed = dialect.sqlToQuery(sql`SELECT ${sql.param(date, workflowJobs.availableAt)}::timestamptz`);
      expect(serializers[1184]!(fixed.params[0])).toBe(date.toISOString());
    } finally { await db.$client.end(); }
  });

  it.each(["recovery", "claim"])("encodes every timestamp in the actual %s query", async (operation) => {
    const db = createDb("postgres://localhost/unused");
    const execute = vi.spyOn(db, "execute").mockImplementation(async (query) => {
      const compiled = dialect.sqlToQuery(query as ReturnType<typeof sql>);
      const expected = operation === "recovery" ? 3 : 4;
      const dates = compiled.params.filter((value) => typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value));
      expect(dates).toHaveLength(expected);
      expect(compiled.params.some((value) => value instanceof Date)).toBe(false);
      // Exercise the adapter's actual configured serializer, not a mocked encoder.
      const serializers = db.$client.options.serializers as unknown as Record<string, (value: unknown) => string>;
      for (const value of dates) expect(Buffer.byteLength(serializers[1184]!(value))).toBeGreaterThan(0);
      return [] as never;
    });
    try {
      if (operation === "recovery") expect(await recoverStaleJobs(db)).toBe(0);
      else expect(await claimNextJob(db, "test-worker", 120)).toBeNull();
      expect(execute).toHaveBeenCalledOnce();
    } finally { await db.$client.end(); }
  });
});

// Explicitly opt into a disposable local database. Never use DATABASE_URL here.
const testUrl = process.env.WORKER_TEST_DATABASE_URL;
it.skipIf(!testUrl)("recovers and claims jobs using the real PostgreSQL driver and migration", async () => {
  const url = new URL(testUrl!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/asf_worker_test") {
    throw new Error("Use a disposable local database named asf_worker_test");
  }
  const db = createDb(testUrl!);
  const rollback = new Error("rollback test transaction");
  try {
    await expect(db.transaction(async (tx) => {
      const migration = await readFile(new URL("../../../packages/db/drizzle/0000_magical_karnak.sql", import.meta.url), "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await tx.execute(sql.raw(statement));
      }
      const now = new Date();
      const jobs = await tx.insert(workflowJobs).values([
        { type: "expired-claimed", status: "claimed", claimedBy: "old", leaseExpiresAt: new Date(now.getTime() - 60_000) },
        { type: "expired-running", status: "running", claimedBy: "old", leaseExpiresAt: new Date(now.getTime() - 60_000) },
        { type: "null-lease", status: "running", claimedBy: "old" },
        { type: "active", status: "running", leaseExpiresAt: new Date(now.getTime() + 60_000) },
        { type: "done", status: "succeeded", leaseExpiresAt: new Date(now.getTime() - 60_000) },
        { type: "future", status: "queued", availableAt: new Date(now.getTime() + 60_000) },
      ]).returning();
      const queueDb = tx as unknown as DbClient;
      expect(await recoverStaleJobs(queueDb)).toBe(3);
      const recovered = await tx.select().from(workflowJobs);
      for (const job of recovered.filter((job) => ["expired-claimed", "expired-running", "null-lease"].includes(job.type))) {
        expect(job.status).toBe("queued");
        expect(job.claimedBy).toBeNull();
        expect(job.leaseExpiresAt).toBeNull();
        expect(job.availableAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
      }
      for (const type of ["active", "done", "future"]) {
        expect(recovered.find((job) => job.type === type)).toEqual(jobs.find((job) => job.type === type));
      }
      for (let i = 0; i < 3; i++) {
        expect(await claimNextJob(queueDb, "test-worker", 120)).toMatchObject({ attempts: 0 });
      }
      expect(await claimNextJob(queueDb, "test-worker", 120)).toBeNull();
      expect(await recoverStaleJobs(queueDb)).toBe(0);
      const claimed = (await tx.select().from(workflowJobs)).filter((job) => job.status === "claimed");
      expect(claimed).toHaveLength(3);
      expect(claimed.every((job) => job.claimedBy === "test-worker" && job.leaseExpiresAt! > now && job.startedAt! >= now)).toBe(true);
      throw rollback;
    })).rejects.toBe(rollback);

    // The rollback leaves an empty database. A real Worker must log the
    // underlying missing-table SQLSTATE, close its client and exit, not poll.
    await expect(promisify(execFile)(process.execPath, [
      "--import", "tsx", fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    ], {
      env: { ...process.env, DATABASE_URL: testUrl!, WORKER_RECOVER_STALE_ON_START: "true" },
      timeout: 10_000,
    })).rejects.toMatchObject({
      code: 1,
      killed: false,
      stderr: expect.stringMatching(/42P01[\s\S]*fatal: true[\s\S]*operator intervention required/),
    });
  } finally { await db.$client.end(); }
}, 30_000);
