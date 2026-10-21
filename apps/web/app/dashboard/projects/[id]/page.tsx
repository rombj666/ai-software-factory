import Link from "next/link";
import { readConsultation } from "@asf/agents/consultation";
import { db } from "@/lib/db";
import { ConsultationWorkspace } from "@/components/consultation-workspace";
import { PrototypeWorkspace } from "@/components/prototype-workspace";
import { readPrototype } from "@asf/agents/prototype";
import { storageConfigured } from "@/lib/reference-images";
import { notFound } from "next/navigation";
import {
  getProjectForUser,
  listProjectEventsForUser,
} from "@/app/actions/projects";
import { ProjectStatusBadge } from "@/components/project-status-badge";

export default async function ProjectDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProjectForUser(id);
  if (!project) {
    notFound();
  }

  const events = await listProjectEventsForUser(id);
  const consultation = await readConsultation(db(), project.ownerId, id);
  const prototype = ["prototype_pending", "prototype_approved"].includes(project.status)
    ? await readPrototype(db(), project.ownerId, id) : null;

  const futureFeatures = [
    "PRD & Development Planning (M4)",
    "AI Developer & Sandbox (M5)",
    "QA & Auto Fix (M6)",
    "Preview & Code Export (M7)",
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/projects"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to projects
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">{project.title}</h1>
          <ProjectStatusBadge status={project.status} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Product idea
            </h2>
            <p className="mt-3 whitespace-pre-wrap text-slate-800">
              {project.idea}
            </p>
          </section>

          <ConsultationWorkspace
            initial={consultation}
            uploadsEnabled={storageConfigured()}
          />

          {prototype && <PrototypeWorkspace initial={prototype} uploadsEnabled={storageConfigured()} />}

          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Lifecycle events
            </h2>
            {events.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                No lifecycle events recorded yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {events.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm"
                  >
                    <span className="font-mono text-slate-700">
                      {event.eventType}
                    </span>
                    <span className="text-xs text-slate-400">
                      {event.createdAt.toISOString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Details
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Status</dt>
                <dd className="font-medium text-slate-900">{project.status}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Budget</dt>
                <dd className="font-medium text-slate-900">
                  ${(project.budgetLimitCents / 100).toFixed(2)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Created</dt>
                <dd className="font-medium text-slate-900">
                  {project.createdAt.toISOString()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Updated</dt>
                <dd className="font-medium text-slate-900">
                  {project.updatedAt.toISOString()}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Coming in later milestones
            </h2>
            <ul className="mt-3 space-y-1.5 text-sm text-slate-500">
              {futureFeatures.map((feature) => (
                <li key={feature}>• {feature}</li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
