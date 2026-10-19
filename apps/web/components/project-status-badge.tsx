import type { ProjectStatus } from "@asf/core";

const LABELS: Record<ProjectStatus, string> = {
  idea_submitted: "Idea submitted",
  consultation: "Consultation",
  prototype_pending: "Prototype pending",
  prototype_approved: "Prototype approved",
  prd_pending: "PRD pending",
  prd_approved: "PRD approved",
  planning_pending: "Planning pending",
  plan_approved: "Plan approved",
  coding: "Coding",
  qa: "QA",
  delivery: "Delivery",
  cleanup: "Cleanup",
  completed: "Completed",
  paused: "Paused",
  failed: "Failed",
  cancelled: "Cancelled",
};

const TONES: Record<ProjectStatus, string> = {
  idea_submitted: "bg-slate-100 text-slate-700",
  consultation: "bg-sky-100 text-sky-800",
  prototype_pending: "bg-violet-100 text-violet-800",
  prototype_approved: "bg-indigo-100 text-indigo-800",
  prd_pending: "bg-blue-100 text-blue-800",
  prd_approved: "bg-teal-100 text-teal-800",
  planning_pending: "bg-cyan-100 text-cyan-800",
  plan_approved: "bg-emerald-100 text-emerald-800",
  coding: "bg-amber-100 text-amber-800",
  qa: "bg-orange-100 text-orange-800",
  delivery: "bg-green-100 text-green-800",
  cleanup: "bg-lime-100 text-lime-800",
  completed: "bg-green-200 text-green-900",
  paused: "bg-yellow-100 text-yellow-800",
  failed: "bg-rose-100 text-rose-800",
  cancelled: "bg-red-100 text-red-800",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
