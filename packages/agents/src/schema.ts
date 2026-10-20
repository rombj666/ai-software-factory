import { z } from "zod";

const text = z.string().trim().min(1).max(6000);
const items = z.array(text).max(30);
export const requirementsSchema = z
  .object({
    productName: text,
    description: text,
    targetUsers: items.min(1),
    productGoals: items.min(1),
    requiredFunctionality: items.min(1),
    optionalFunctionality: items,
    authentication: text,
    dataRequirements: text,
    designPreferences: text,
    preferredTechnologies: items,
    mvpSupportNotes: text,
    intendedUsage: z.enum(["local", "temporary_preview", "live_ready"]),
    openQuestions: items,
    assumptions: items,
  })
  .strict();

export const plannerResponseSchema = z
  .object({
    message: text,
    questions: z.array(text).max(3),
    readyToComplete: z.boolean(),
    summary: requirementsSchema.nullable(),
  })
  .strict();
export type RequirementsSummary = z.infer<typeof requirementsSchema>;
export type PlannerResponse = z.infer<typeof plannerResponseSchema>;
export function validatePlannerResponse(value: unknown): PlannerResponse {
  const parsed = plannerResponseSchema.parse(value);
  if (
    parsed.readyToComplete &&
    (!parsed.summary ||
      parsed.questions.length ||
      parsed.summary.openQuestions.length)
  ) {
    throw new Error(
      "A complete consultation requires a summary and no unanswered questions.",
    );
  }
  return parsed;
}

export interface ConsultationState {
  revision: number;
  status:
    "collecting" | "queued" | "processing" | "ready" | "failed" | "completed";
  activeJobId: string | null;
  summary: RequirementsSummary | null;
  readyToComplete: boolean;
  error: string | null;
  completedAt?: string;
}
export function consultationState(
  currentState: Record<string, unknown> | null,
): ConsultationState {
  const value = currentState?.consultation as
    Partial<ConsultationState> | undefined;
  return {
    revision: value?.revision ?? 0,
    status: value?.status ?? "collecting",
    activeJobId: value?.activeJobId ?? null,
    summary: value?.summary ?? null,
    readyToComplete: value?.readyToComplete ?? false,
    error: value?.error ?? null,
    ...(value?.completedAt ? { completedAt: value.completedAt } : {}),
  };
}
export class ConsultationError extends Error {}
export const projectIdSchema = z.uuid();
export const requestSchema = z.object({
  mode: z.enum(["start", "message", "retry"]),
  requestId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  content: z.string().trim().min(1).max(6000),
});
