import type { ProjectStatus } from "./types";

/**
 * Approval gates enforced along the journey. Coding must not begin until the
 * prototype, PRD and development plan approvals are completed.
 */
export const APPROVAL_STAGES = ["prototype", "prd", "development_plan"] as const;
export type ApprovalStage = (typeof APPROVAL_STAGES)[number];

export interface ApprovalGateDefinition {
  stage: ApprovalStage;
  /** The workflow state that is only reachable after this approval completes. */
  requiredBeforeStatus: ProjectStatus;
}

export const APPROVAL_GATES: readonly ApprovalGateDefinition[] = [
  { stage: "prototype", requiredBeforeStatus: "prd_pending" },
  { stage: "prd", requiredBeforeStatus: "planning_pending" },
  { stage: "development_plan", requiredBeforeStatus: "coding" },
];

export const APPROVAL_OUTCOMES = [
  "pending",
  "approved",
  "rejected",
  "changes_requested",
] as const;
export type ApprovalOutcome = (typeof APPROVAL_OUTCOMES)[number];

export function isApprovalRequired(
  from: ProjectStatus,
  to: ProjectStatus,
  gates: readonly ApprovalGateDefinition[] = APPROVAL_GATES,
): boolean {
  return gates.some((g) => g.requiredBeforeStatus === to && from !== to);
}