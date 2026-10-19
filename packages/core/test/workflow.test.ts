import { describe, expect, it } from "vitest";
import {
  WorkflowStateMachine,
  canTransition,
  allowedTransitions,
  isTerminalProjectStatus,
  isApprovalRequired,
  APPROVAL_STAGES,
} from "../src/index";

describe("workflow transitions", () => {
  it("follows the main forward journey from idea to completed", () => {
    const journey = [
      ["idea_submitted", "consultation"],
      ["consultation", "prototype_pending"],
      ["prototype_pending", "prototype_approved"],
      ["prototype_approved", "prd_pending"],
      ["prd_pending", "prd_approved"],
      ["prd_approved", "planning_pending"],
      ["planning_pending", "plan_approved"],
      ["plan_approved", "coding"],
      ["coding", "qa"],
      ["qa", "delivery"],
      ["delivery", "cleanup"],
      ["cleanup", "completed"],
    ] as const;

    for (const [from, to] of journey) {
      expect(canTransition(from, to)).toBe(true);
      const result = WorkflowStateMachine.transition(from, to, {
        projectId: "p1",
        reason: "test",
      });
      expect(result.ok).toBe(true);
      expect(result.to).toBe(to);
    }
  });

  it("allows QA to loop back to coding for automatic fix cycles", () => {
    expect(canTransition("qa", "coding")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    expect(canTransition("idea_submitted", "completed")).toBe(false);
    expect(canTransition("coding", "prototype_pending")).toBe(false);
    expect(canTransition("completed", "consultation")).toBe(false);
    const result = WorkflowStateMachine.transition("idea_submitted", "completed", {
      projectId: "p1",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Illegal transition");
  });

  it("allows pausing, failing and cancelling from any forward state", () => {
    for (const status of [
      "idea_submitted",
      "consultation",
      "prototype_pending",
      "prototype_approved",
      "prd_pending",
      "prd_approved",
      "planning_pending",
      "plan_approved",
      "coding",
      "qa",
      "delivery",
      "cleanup",
    ] as const) {
      expect(canTransition(status, "paused")).toBe(true);
      expect(canTransition(status, "failed")).toBe(true);
      expect(canTransition(status, "cancelled")).toBe(true);
    }
  });

  it("allows failed to recover via paused, and paused to resume", () => {
    expect(canTransition("failed", "paused")).toBe(true);
    expect(canTransition("paused", "coding")).toBe(true);
    expect(canTransition("paused", "completed")).toBe(false);
    expect(canTransition("failed", "completed")).toBe(false);
  });

  it("exposes allowed transitions per state", () => {
    expect(allowedTransitions("idea_submitted")).toContain("consultation");
    expect(allowedTransitions("completed")).toEqual([]);
    expect(allowedTransitions("cancelled")).toEqual([]);
  });

  it("flags terminal states", () => {
    expect(isTerminalProjectStatus("completed")).toBe(true);
    expect(isTerminalProjectStatus("cancelled")).toBe(true);
    expect(isTerminalProjectStatus("coding")).toBe(false);
  });

  it("detects approval-gated transitions", () => {
    expect(isApprovalRequired("prototype_pending", "prototype_approved")).toBe(false);
    expect(isApprovalRequired("prototype_approved", "prd_pending")).toBe(true);
    expect(isApprovalRequired("prd_approved", "planning_pending")).toBe(true);
    expect(isApprovalRequired("plan_approved", "coding")).toBe(true);
  });

  it("defines all three approval stages", () => {
    expect(APPROVAL_STAGES).toEqual(["prototype", "prd", "development_plan"]);
  });
});