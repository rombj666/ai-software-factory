import {
  PROJECT_STATUSES,
  type ProjectStatus,
} from "./types";

/**
 * Valid one-step transitions. The forward path follows the MVP journey.
 * `paused` / `failed` are recoverable holding states:
 *   - paused may resume to any non-terminal state (caller records the target
 *     in the transition payload);
 *   - failed may be retried by moving back to `paused` first (or cancelled by
 *     the user).
 * Terminal states have no outgoing transitions.
 */
const TRANSITION_RULES: Record<ProjectStatus, readonly ProjectStatus[]> = {
  idea_submitted: ["consultation", "paused", "failed", "cancelled"],
  consultation: ["prototype_pending", "paused", "failed", "cancelled"],
  prototype_pending: ["prototype_approved", "paused", "failed", "cancelled"],
  prototype_approved: ["prd_pending", "paused", "failed", "cancelled"],
  prd_pending: ["prd_approved", "paused", "failed", "cancelled"],
  prd_approved: ["planning_pending", "paused", "failed", "cancelled"],
  planning_pending: ["plan_approved", "paused", "failed", "cancelled"],
  plan_approved: ["coding", "paused", "failed", "cancelled"],
  coding: ["qa", "paused", "failed", "cancelled"],
  // QA may loop back to coding for automatic fix cycles.
  qa: ["delivery", "coding", "paused", "failed", "cancelled"],
  delivery: ["cleanup", "paused", "failed", "cancelled"],
  cleanup: ["completed", "paused", "failed", "cancelled"],
  completed: [],
  paused: PROJECT_STATUSES.filter((s) => !["paused", "completed", "cancelled"].includes(s)),
  failed: ["paused", "cancelled"],
  cancelled: [],
};

export function allowedTransitions(from: ProjectStatus): readonly ProjectStatus[] {
  return TRANSITION_RULES[from] ?? [];
}

export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return allowedTransitions(from).includes(to);
}