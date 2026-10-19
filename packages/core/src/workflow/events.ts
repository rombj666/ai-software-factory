import type { ProjectStatus } from "./types";

/**
 * Workflow event types persisted in `lifecycle_events`.
 */
export const WORKFLOW_EVENT_TYPES = [
  "project.created",
  "project.status_changed",
  "approval.requested",
  "approval.decided",
  "job.queued",
  "job.claimed",
  "job.succeeded",
  "job.failed",
  "job.paused",
  "job.cancelled",
  "job.recovered",
] as const;

export type WorkflowEventType = (typeof WORKFLOW_EVENT_TYPES)[number];

export interface WorkflowEvent {
  id: string;
  projectId: string | null;
  eventType: WorkflowEventType;
  from?: ProjectStatus;
  to?: ProjectStatus;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export function createWorkflowEvent(input: {
  id?: string;
  projectId: string | null;
  eventType: WorkflowEventType;
  from?: ProjectStatus;
  to?: ProjectStatus;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
}): WorkflowEvent {
  return {
    id: input.id ?? crypto.randomUUID(),
    projectId: input.projectId,
    eventType: input.eventType,
    from: input.from,
    to: input.to,
    payload: input.payload ?? {},
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
  };
}