import Link from "next/link";
import { CreateProjectForm } from "@/components/create-project-form";

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/dashboard/projects"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to projects
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Create Project</h1>
        <p className="text-sm text-slate-500">
          Describe your idea. The AI consultation begins in a later milestone.
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <CreateProjectForm />
      </div>
    </div>
  );
}
