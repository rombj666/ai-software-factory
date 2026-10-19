import Link from "next/link";
import { isActiveProjectStatus, isTerminalProjectStatus } from "@asf/core";
import { listProjectsForUser } from "@/app/actions/projects";
import { ProjectStatusBadge } from "@/components/project-status-badge";

const ROADMAP = [
  { milestone: "M1", name: "Foundation & Infrastructure", done: true },
  { milestone: "M2", name: "AI Consultation", done: false },
  { milestone: "M3", name: "Prototype Engine", done: false },
  { milestone: "M4", name: "PRD & Development Planning", done: false },
  { milestone: "M5", name: "AI Developer & Sandbox", done: false },
  { milestone: "M6", name: "QA & Auto Fix", done: false },
  { milestone: "M7", name: "Preview & Code Export", done: false },
  { milestone: "M8", name: "Cleanup & E2E Validation", done: false },
];

export default async function DashboardPage() {
  const projects = await listProjectsForUser();

  const stats = {
    total: projects.length,
    active: projects.filter((p) => isActiveProjectStatus(p.status)).length,
    completed: projects.filter((p) => isTerminalProjectStatus(p.status)).length,
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500">
            Your AI Software Factory workspace (Milestone 1 foundation).
          </p>
        </div>
        <Link
          href="/dashboard/projects/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-brand-700"
        >
          Create Project
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Total projects</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Active executions</p>
          <p className="mt-1 text-3xl font-bold text-brand-600">{stats.active}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Completed projects</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{stats.completed}</p>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Recent projects</h2>
          <Link
            href="/dashboard/projects"
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            View all
          </Link>
        </div>
        {projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm text-slate-500">No projects yet.</p>
            <Link
              href="/dashboard/projects/new"
              className="mt-2 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              Create your first project
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <ul className="divide-y divide-slate-100">
              {projects.slice(0, 5).map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/dashboard/projects/${project.id}`}
                    className="flex items-center justify-between px-5 py-4 hover:bg-slate-50"
                  >
                    <div>
                      <p className="font-medium text-slate-900">{project.title}</p>
                      <p className="line-clamp-1 text-sm text-slate-500">{project.idea}</p>
                    </div>
                    <ProjectStatusBadge status={project.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-900">Product roadmap</h2>
        <p className="mt-1 text-sm text-slate-500">
          Later milestones are planned but not implemented. Nothing below M1 is
          simulated.
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {ROADMAP.map((item) => (
            <li
              key={item.milestone}
              className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm ${
                item.done
                  ? "border-brand-200 bg-brand-50 text-brand-900"
                  : "border-slate-200 text-slate-500"
              }`}
            >
              <span>
                <span className="font-semibold">{item.milestone}</span> — {item.name}
              </span>
              <span>{item.done ? "Implemented" : "Not implemented"}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
