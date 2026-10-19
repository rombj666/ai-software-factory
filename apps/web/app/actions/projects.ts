"use server";

import { redirect } from "next/navigation";
import { getSessionSafe } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { lifecycleEvents, projects } from "@asf/db/schema";
import { and, desc, eq } from "drizzle-orm";

export interface CreateProjectResult {
  error: string | null;
}

/** Returns the authenticated user id or redirects to sign-in. */
export async function requireUserId(): Promise<string> {
  const { data: session } = await getSessionSafe();
  if (!session?.user?.id) {
    redirect("/auth/sign-in");
  }
  return session.user.id;
}

/**
 * Server action compatible with React `useActionState`:
 * `(prevState, formData) => Promise<State>`.
 */
export async function createProject(
  _prevState: CreateProjectResult,
  formData: FormData,
): Promise<CreateProjectResult> {
  const userId = await requireUserId();
  const title = String(formData.get("title") ?? "").trim();
  const idea = String(formData.get("idea") ?? "").trim();

  if (!title || !idea) {
    return { error: "Title and idea are required." };
  }

  // M1 scope: only persist idea, title, ownership and initial state.
  // AI consultation/prototyping begins in M2+.
  const rows = await db()
    .insert(projects)
    .values({
      ownerId: userId,
      title,
      idea,
      status: "idea_submitted",
    })
    .returning({ id: projects.id });

  const row = rows[0];
  if (!row) {
    return { error: "Project insert returned no row." };
  }

  redirect(`/dashboard/projects/${row.id}`);
}

export async function listProjectsForUser() {
  const userId = await requireUserId();
  return db()
    .select({
      id: projects.id,
      title: projects.title,
      idea: projects.idea,
      status: projects.status,
      budgetLimitCents: projects.budgetLimitCents,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.ownerId, userId))
    .orderBy(desc(projects.createdAt));
}

export async function getProjectForUser(projectId: string) {
  const userId = await requireUserId();
  const rows = await db()
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, userId)));
  return rows[0] ?? null;
}

export async function listProjectEventsForUser(projectId: string) {
  await requireUserId();
  const project = await getProjectForUser(projectId);
  if (!project) return [];
  return db()
    .select({
      id: lifecycleEvents.id,
      eventType: lifecycleEvents.eventType,
      payload: lifecycleEvents.payload,
      createdAt: lifecycleEvents.createdAt,
    })
    .from(lifecycleEvents)
    .where(eq(lifecycleEvents.projectId, projectId))
    .orderBy(desc(lifecycleEvents.createdAt));
}
