"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { enqueuePrototype, readPrototype, quotePrototype, saveDesignPlan, approvePrototypeScreen, finishPrototype } from "@asf/agents/prototype";
import { ConsultationError } from "@asf/agents/schema";
import { db } from "@/lib/db";
import { requireUserId } from "./projects";
function publicError(error: unknown) {
  if (error instanceof ConsultationError) return error.message;
  if (error instanceof ZodError) return "Check the design fields and selected settings.";
  return "Prototype request could not be completed. Check configuration and refresh before retrying.";
}
export async function getPrototype(projectId: string) {
  const ownerId = await requireUserId();
  try { return { data: await readPrototype(db(), ownerId, projectId), error: null }; }
  catch (error) { return { data: null, error: publicError(error) }; }
}
export async function estimatePrototype(projectId: string, input: unknown) {
  const ownerId = await requireUserId();
  try { return { data: await quotePrototype(db(), ownerId, projectId, input), error: null }; }
  catch (error) { return { data: null, error: publicError(error) }; }
}
async function mutate(projectId: string, action: (ownerId: string) => Promise<unknown>) {
  const ownerId = await requireUserId();
  try {
    await action(ownerId); revalidatePath(`/dashboard/projects/${projectId}`);
    return { data: await readPrototype(db(), ownerId, projectId), error: null };
  } catch (error) { return { data: null, error: publicError(error) }; }
}
export async function requestPrototype(projectId: string, input: unknown) {
  return mutate(projectId, ownerId => enqueuePrototype(db(), ownerId, projectId, input));
}
export async function updateDesignPlan(projectId: string, revision: number, design: unknown, accept: boolean) {
  return mutate(projectId, ownerId => saveDesignPlan(db(), ownerId, projectId, revision, design, accept));
}
export async function approveScreen(projectId: string, revision: number, screenId: string, versionId: string) {
  return mutate(projectId, ownerId => approvePrototypeScreen(db(), ownerId, projectId, revision, screenId, versionId));
}
export async function approveFinalPrototype(projectId: string, revision: number) {
  return mutate(projectId, ownerId => finishPrototype(db(), ownerId, projectId, revision));
}
