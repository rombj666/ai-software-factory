/**
 * Typed project workflow states, mirroring the FINAL MVP user journey:
 * Idea → AI Consultation → Visual Prototype → Prototype Approval → PRD →
 * PRD Approval → Architecture & Development Plan → Plan Approval → Coding →
 * QA & Auto Fix → Delivery → Cleanup.
 *
 * M1 only exercises the first states, but the state set is complete so later
 * milestones can extend the transition table without breaking consumers.
 */
export const PROJECT_STATUSES = [
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
  "completed",
  "paused",
  "failed",
  "cancelled",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TERMINAL_PROJECT_STATUSES = ["completed", "cancelled"] as const;
export type TerminalProjectStatus = (typeof TERMINAL_PROJECT_STATUSES)[number];

/** Statuses that are considered "in progress" for dashboard counting. */
export const ACTIVE_PROJECT_STATUSES: readonly ProjectStatus[] = [
  "consultation",
  "prototype_pending",
  "prototype_approved",
  "prd_pending",
  "prd_approved",
  "planning_pending",
  "plan_approved",
  "coding",
  "qa",
];

export function isTerminalProjectStatus(status: ProjectStatus): boolean {
  return (TERMINAL_PROJECT_STATUSES as readonly string[]).includes(status);
}

export function isActiveProjectStatus(status: ProjectStatus): boolean {
  return ACTIVE_PROJECT_STATUSES.includes(status);
}