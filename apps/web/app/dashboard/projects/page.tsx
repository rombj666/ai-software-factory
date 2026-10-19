import Link from "next/link";
import { listProjectsForUser } from "@/app/actions/projects";
import { ProjectStatusBadge } from "@/components/project-status-badge";

export default async function ProjectsPage() {
  const projects = await listProjectsForUser();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Projects</h1>
          <p className="text-sm text-slate-500">
            Only your own projects are shown.
          </p>
        </div>
        <Link
          href="/dashboard/projects/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-brand-700"
        >
          Create Project
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
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
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Title
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Status
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.map((project) => (
                <tr key={project.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link
                      href={`/dashboard/projects/${project.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {project.title}
                    </Link>
                    <p className="line-clamp-1 text-sm text-slate-500">{project.idea}</p>
                  </td>
                  <td className="px-5 py-3">
                    <ProjectStatusBadge status={project.status} />
                  </td>
                  <td className="px-5 py-3 text-sm text-slate-500">
                    {project.createdAt.toISOString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
