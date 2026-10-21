import { z } from "zod";
import { consultationState, requirementsSchema, ConsultationError, type RequirementsSummary } from "./schema";
const text = z.string().trim().min(1).max(2000);
const list = z.array(text).max(30);
export const screenSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
  name: text.max(120), purpose: text, layout: text,
  components: list.min(1), controls: list, interactions: list,
  requirementReferences: list.min(1), navigationTo: z.array(z.string()).max(20),
  viewport: z.enum(["desktop", "mobile"]), responsive: text,
}).strict();
export const designSchema = z.object({
  productOverview: text, targetUsers: list.min(1),
  screens: z.array(screenSchema).min(1).max(12), navigation: text,
  visualDirection: text,
  tokens: z.object({ colors: list.min(1), typography: text, spacing: text }).strict(),
  assumptions: list, limitations: list,
}).strict();
export type DesignSpecification = z.infer<typeof designSchema>;
export function validateDesign(value: unknown): DesignSpecification {
  const design = designSchema.parse(value);
  const ids = new Set(design.screens.map(s => s.id));
  if (ids.size !== design.screens.length || design.screens.some(s => s.navigationTo.some(id => !ids.has(id))))
    throw new ConsultationError("Screen IDs must be unique and navigation must point to existing screens.");
  if (Buffer.byteLength(JSON.stringify(design), "utf8") > 24000)
    throw new ConsultationError("Keep the design specification within 24 KB.");
  return design;
}
export function validateDesignTraceability(design: DesignSpecification, summary: RequirementsSummary) {
  const requirements = new Set([...summary.requiredFunctionality, ...summary.productGoals, summary.authentication, summary.dataRequirements]);
  if (design.screens.some(screen => screen.requirementReferences.some(reference => !requirements.has(reference))))
    throw new ConsultationError("Each screen must reference exact approved functionality, goals, authentication or data requirements.");
  return design;
}
export function approvedRequirements(currentState: Record<string, unknown> | null) {
  const state = consultationState(currentState);
  if (state.status !== "completed" || !state.summary || state.activeJobId)
    throw new ConsultationError("Complete and approve consultation before planning prototypes.");
  const summary = requirementsSchema.parse(state.summary);
  if (summary.openQuestions.length) throw new ConsultationError("Resolve consultation questions first.");
  return { summary, revision: state.revision };
}
export interface PrototypeState {
  revision: number; planRevision: number; design: DesignSpecification | null;
  acceptedPlanRevision: number | null; activeJobId: string | null;
  status: "empty" | "queued" | "processing" | "review" | "failed" | "approved";
  error: string | null; approvals: Record<string, string>;
  finalArtifactId: string | null;
}
export function prototypeState(currentState: Record<string, unknown> | null): PrototypeState {
  return { revision: 0, planRevision: 0, design: null, acceptedPlanRevision: null,
    activeJobId: null, status: "empty", error: null, approvals: {}, finalArtifactId: null,
    ...(currentState?.prototype as Partial<PrototypeState> ?? {}) };
}
export const imageSettingsSchema = z.object({
  quality: z.enum(["low", "medium", "high"]),
  size: z.enum(["1536x1024", "1024x1536", "1024x1024"]),
}).strict();
export type ImageSettings = z.infer<typeof imageSettingsSchema>;
export const prototypeRequestSchema = z.object({
  requestId: z.uuid(), expectedRevision: z.number().int().nonnegative(),
  mode: z.enum(["plan", "generate", "edit", "regenerate"]),
  screenId: z.string().max(48).optional(), feedback: z.string().trim().max(2000).default(""),
  referenceAssetId: z.uuid().optional(), baseVersionId: z.uuid().optional(),
  settings: imageSettingsSchema.optional(), confirmed: z.literal(true),
  quoteHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type PrototypeRequest = z.infer<typeof prototypeRequestSchema>;
