import { describe, expect, it } from "vitest";
import {
  isClaimable,
  isRecoverable,
  canRetry,
  computeLeaseExpiry,
  nextAvailableAt,
  isTerminalJobStatus,
} from "../src/index";

describe("job claim & lease semantics", () => {
  const now = new Date("2026-10-16T10:00:00.000Z");

  it("claimable when queued and available", () => {
    expect(
      isClaimable({ status: "queued", availableAt: now, now }),
    ).toBe(true);
    expect(
      isClaimable({ status: "queued", availableAt: new Date(now.getTime() + 1000), now }),
    ).toBe(false);
    expect(isClaimable({ status: "running", availableAt: now, now })).toBe(false);
    expect(isClaimable({ status: "succeeded", availableAt: now, now })).toBe(false);
  });

  it("computes lease expiry correctly", () => {
    const expiry = computeLeaseExpiry({ now, leaseSeconds: 120 });
    expect(expiry.toISOString()).toBe("2026-10-16T10:02:00.000Z");
    const defaultExpiry = computeLeaseExpiry({ now });
    expect(defaultExpiry.toISOString()).toBe("2026-10-16T10:02:00.000Z");
  });

  it("recovers expired claimed/running jobs", () => {
    const expired = new Date(now.getTime() - 1);
    expect(isRecoverable({ status: "claimed", leaseExpiresAt: expired, now })).toBe(true);
    expect(isRecoverable({ status: "running", leaseExpiresAt: expired, now })).toBe(true);
    const future = new Date(now.getTime() + 60_000);
    expect(isRecoverable({ status: "claimed", leaseExpiresAt: future, now })).toBe(false);
    expect(isRecoverable({ status: "queued", leaseExpiresAt: expired, now })).toBe(false);
    expect(isRecoverable({ status: "succeeded", leaseExpiresAt: expired, now })).toBe(false);
  });

  it("respects retry limits", () => {
    expect(canRetry(0, 3)).toBe(true);
    expect(canRetry(2, 3)).toBe(true);
    expect(canRetry(3, 3)).toBe(false);
  });

  it("computes backoff availability", () => {
    const next = nextAvailableAt(now, 1, 30);
    expect(next.toISOString()).toBe("2026-10-16T10:00:30.000Z");
  });

  it("marks terminal job statuses", () => {
    expect(isTerminalJobStatus("succeeded")).toBe(true);
    expect(isTerminalJobStatus("failed")).toBe(true);
    expect(isTerminalJobStatus("cancelled")).toBe(true);
    expect(isTerminalJobStatus("queued")).toBe(false);
  });
});