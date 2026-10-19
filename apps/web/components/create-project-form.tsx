"use client";

import { useActionState } from "react";
import { createProject } from "@/app/actions/projects";

export function CreateProjectForm() {
  const [state, formAction, pending] = useActionState(createProject, {
    error: null,
  });

  return (
    <form action={formAction} className="space-y-5">
      {state.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <div>
        <label htmlFor="title" className="block text-sm font-medium text-slate-700">
          Project title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={200}
          placeholder="e.g. Inventory Management System"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>
      <div>
        <label htmlFor="idea" className="block text-sm font-medium text-slate-700">
          Product idea
        </label>
        <textarea
          id="idea"
          name="idea"
          required
          rows={6}
          maxLength={4000}
          placeholder="Describe the application you want to build..."
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white shadow hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? "Creating..." : "Create project"}
        </button>
        <span className="text-xs text-slate-400">
          Milestone 1 persists only the idea, title and ownership. AI
          consultation starts in M2.
        </span>
      </div>
    </form>
  );
}
