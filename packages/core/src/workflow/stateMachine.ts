import { canTransition, allowedTransitions } from "./transitions";
import { createWorkflowEvent, type WorkflowEvent } from "./events";
import { isApprovalRequired, APPROVAL_GATES } from "./approvals";
import { isTerminalProjectStatus, type ProjectStatus } from "./types";

export interface TransitionOptions {
  projectId: string;
  reason?: string;
  actor?: string;
  occurredAt?: Date;
}

export interface TransitionResult {
  ok: boolean;
  from: ProjectStatus;
  to: ProjectStatus;
  event: WorkflowEvent;
  /** Set when the destination state requires an approval gate. */
  requiresApproval?: string;
  error?: string;
}

/**
 * Pure workflow state machine. Persistence is the caller's responsibility
 * (Web app / Worker write the transition + event to the database).
 */
export class WorkflowStateMachine {
  static canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
    return canTransition(from, to);
  }

  static allowedTransitions(from: ProjectStatus): readonly ProjectStatus[] {
    return allowedTransitions(from);
  }

  static transition(
    from: ProjectStatus,
    to: ProjectStatus,
    options: TransitionOptions,
  ): TransitionResult {
    const occurredAt = options.occurredAt ?? new Date();

    if (from === to) {
      return {
        ok: false,
        from,
        to,
        event: createWorkflowEvent({
          projectId: options.projectId,
          eventType: "project.status_changed",
          from,
          to,
          payload: { reason: options.reason, actor: options.actor },
          occurredAt,
        }),
        error: `No-op transition from '${from}' to '${to}'`,
      };
    }

    if (!canTransition(from, to)) {
      return {
        ok: false,
        from,
        to,
        event: createWorkflowEvent({
          projectId: options.projectId,
          eventType: "project.status_changed",
          from,
          to,
          payload: { reason: options.reason, actor: options.actor },
          occurredAt,
        }),
        error: `Illegal transition '${from}' -> '${to}'`,
      };
    }

    const gate = isApprovalRequired(from, to, APPROVAL_GATES)
      ? APPROVAL_GATES.find((g) => g.requiredBeforeStatus === to)?.stage
      : undefined;

    const event = createWorkflowEvent({
      projectId: options.projectId,
      eventType: "project.status_changed",
      from,
      to,
      payload: {
        reason: options.reason,
        actor: options.actor,
        requiresApproval: gate,
      },
      occurredAt,
    });

    return {
      ok: true,
      from,
      to,
      event,
      requiresApproval: gate,
    };
  }

  static isTerminal(status: ProjectStatus): boolean {
    return isTerminalProjectStatus(status);
  }
}