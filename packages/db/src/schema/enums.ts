import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Shared PostgreSQL enums.
 *
 * Workflow statuses intentionally mirror the FINAL MVP user journey
 * (see docs/workflow.md). M1 only exercises the first few states, but the
 * enum is versioned so later milestones can add transitions without schema
 * churn.
 */
export const projectStatusEnum = pgEnum("project_status", [
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
]);

export const jobStatusEnum = pgEnum("workflow_job_status", [
  "queued",
  "claimed",
  "running",
  "succeeded",
  "failed",
  "paused",
  "cancelled",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "todo",
  "in_progress",
  "done",
  "failed",
  "skipped",
]);

export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "paused",
]);

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "changes_requested",
]);

export const previewStatusEnum = pgEnum("preview_status", [
  "requested",
  "creating",
  "active",
  "expired",
  "cleaned_up",
]);

export const exportStatusEnum = pgEnum("export_status", [
  "requested",
  "preparing",
  "ready",
  "failed",
]);

export const cleanupJobStatusEnum = pgEnum("cleanup_job_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
]);

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);

export const prototypeVersionStatusEnum = pgEnum("prototype_version_status", [
  "pending",
  "approved",
  "rejected",
  "superseded",
]);