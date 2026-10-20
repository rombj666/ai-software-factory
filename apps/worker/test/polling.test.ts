import { describe, expect, it, vi } from "vitest";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { isDatabaseError, safeError } from "../src/errors";
import { runPollingLoop } from "../src/polling";

const wrapped = (code: string) => new DrizzleQueryError("UPDATE secret_table SET payload=$1", ["private-payload"], Object.assign(new Error("database failure"), { code }));

describe("database error reporting", () => {
  it("exposes nested codes and messages but omits SQL, parameters and credentials", () => {
    const url = "postgres://username:private-password@localhost/db?token=private-token";
    const cause = Object.assign(new Error(`invalid input syntax for type uuid: 'private-payload' ${url} password=private-password`), { code: "22P02", detail: "private-payload", query: "secret SQL" });
    const error = new DrizzleQueryError("secret SQL", ["private-payload"], cause);
    const output = JSON.stringify(safeError(error, url));
    expect(output).toContain("22P02");
    expect(output).toContain("invalid input syntax for type uuid");
    for (const secret of ["secret SQL", "private-payload", "private-password", "private-token", "username"]) expect(output).not.toContain(secret);
    expect(isDatabaseError(error)).toBe(true);
  });

  it("handles circular causes", () => {
    const error = new Error("failure");
    error.cause = error;
    expect(safeError(error, "invalid")).toMatchObject({ causes: [] });
  });
});

describe("worker polling failure policy", () => {
  it.each(["42P01", "42703", "28P01", "42501", "22P02", "08P01", "ERR_INVALID_ARG_TYPE"])("stops immediately on permanent %s errors", async (code) => {
    const tick = vi.fn().mockRejectedValue(wrapped(code));
    const sleep = vi.fn();
    const onError = vi.fn();
    expect(await runPollingLoop({ isRunning: () => true, tick, sleep, onError, pollIntervalMs: 2000 })).toBe(false);
    expect(tick).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.anything(), true, 0);
  });

  it.each([wrapped("40001"), wrapped("08006"), new Error("unknown failure")])("bounds consecutive transient or unknown failures", async (error) => {
    const tick = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn();
    expect(await runPollingLoop({ isRunning: () => true, tick, sleep, onError: vi.fn(), pollIntervalMs: 2000 })).toBe(false);
    expect(tick).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls.flat()).toEqual([5000, 10_000, 20_000, 40_000]);
  });

  it("resets the failure budget after success", async () => {
    let calls = 0;
    const sleep = vi.fn();
    const tick = vi.fn(async () => { calls++; if (calls !== 3 && calls !== 6) throw wrapped("40P01"); });
    expect(await runPollingLoop({ isRunning: () => calls < 6, tick, sleep, onError: vi.fn(), pollIntervalMs: 2000 })).toBe(true);
    expect(sleep.mock.calls.flat()).toEqual([5000, 10_000, 5000, 10_000]);
  });
});
