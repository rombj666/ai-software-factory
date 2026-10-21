"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import {
  enqueueConsultation,
  editRequirements,
  finishConsultation,
  readConsultation,
} from "@asf/agents/consultation";
import { ConsultationError } from "@asf/agents/schema";
import { db } from "@/lib/db";
import { requireUserId } from "./projects";

export async function getConsultation(projectId: string) {
  const ownerId = await requireUserId();
  try {
    return {
      data: await readConsultation(db(), ownerId, projectId),
      error: null,
    };
  } catch (error) {
    return { data: null, error: publicError(error) };
  }
}
function publicError(error: unknown) {
  if (error instanceof ConsultationError) return error.message;
  if (error instanceof ZodError)
    return "Check the submitted fields and try again.";
  return "Consultation could not be updated. Your saved messages are safe. Please retry.";
}
export async function sendConsultation(
  projectId: string,
  input: Parameters<typeof enqueueConsultation>[3],
) {
  const ownerId = await requireUserId();
  try {
    await enqueueConsultation(db(), ownerId, projectId, input);
    revalidatePath(`/dashboard/projects/${projectId}`);
    return {
      data: await readConsultation(db(), ownerId, projectId),
      error: null,
    };
  } catch (error) {
    return { data: null, error: publicError(error) };
  }
}
export async function saveRequirements(
  projectId: string,
  revision: number,
  summary: unknown,
) {
  const ownerId = await requireUserId();
  try {
    await editRequirements(db(), ownerId, projectId, revision, summary);
    revalidatePath(`/dashboard/projects/${projectId}`);
    return {
      data: await readConsultation(db(), ownerId, projectId),
      error: null,
    };
  } catch (error) {
    return { data: null, error: publicError(error) };
  }
}
export async function completeConsultation(
  projectId: string,
  revision: number,
) {
  const ownerId = await requireUserId();
  try {
    await finishConsultation(db(), ownerId, projectId, revision);
    revalidatePath(`/dashboard/projects/${projectId}`);
    revalidatePath("/dashboard/projects");
    return {
      data: await readConsultation(db(), ownerId, projectId),
      error: null,
    };
  } catch (error) {
    return { data: null, error: publicError(error) };
  }
}
