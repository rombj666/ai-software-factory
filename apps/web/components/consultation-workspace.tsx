"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ConsultationView } from "@asf/agents/consultation";
import type { RequirementsSummary } from "@asf/agents/schema";
import {
  completeConsultation,
  getConsultation,
  saveRequirements,
  sendConsultation,
} from "@/app/actions/consultation";

const fields: {
  key: keyof RequirementsSummary;
  label: string;
  list?: boolean;
}[] = [
  { key: "productName", label: "Product name" },
  { key: "description", label: "Description" },
  { key: "targetUsers", label: "Target users", list: true },
  { key: "productGoals", label: "Product goals", list: true },
  { key: "requiredFunctionality", label: "Required functionality", list: true },
  { key: "optionalFunctionality", label: "Optional functionality", list: true },
  { key: "authentication", label: "Authentication and permissions" },
  { key: "dataRequirements", label: "Data requirements" },
  { key: "designPreferences", label: "UI and design preferences" },
  { key: "preferredTechnologies", label: "Preferred technologies", list: true },
  { key: "mvpSupportNotes", label: "Current MVP support" },
  { key: "intendedUsage", label: "Intended usage" },
  { key: "openQuestions", label: "Open questions", list: true },
  { key: "assumptions", label: "Assumptions", list: true },
];
const control =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50";
const button =
  "rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50";

type Result = Awaited<ReturnType<typeof getConsultation>>;
export function ConsultationWorkspace({
  initial,
  uploadsEnabled,
}: {
  initial: ConsultationView;
  uploadsEnabled: boolean;
}) {
  const [view, setView] = useState(initial);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [summaryDirty, setSummaryDirty] = useState(false);
  const request = useRef<{
    requestId: string;
    content: string;
    expectedRevision: number;
    mode: "message" | "start" | "retry";
  } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const active = ["queued", "processing"].includes(view.state.status);
  const closed = !["idea_submitted", "consultation"].includes(
    view.projectStatus,
  );
  function accept(result: Result) {
    if (result.data) {
      if (result.data.state.revision !== view.state.revision)
        setSummaryDirty(false);
      setView(result.data);
      setError(null);
      return true;
    }
    setError(result.error);
    return false;
  }
  useEffect(() => {
    setView(initial);
  }, [initial]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [view.messages.length]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      try {
        const result = await getConsultation(initial.projectId);
        if (cancelled) return;
        if (result.data) {
          setView(result.data);
          setError(null);
          failures = 0;
        } else {
          failures++;
          setError(result.error);
        }
      } catch {
        if (!cancelled) {
          failures++;
          setError("Connection interrupted. Conversation history is saved.");
        }
      }
      if (!cancelled && failures < 5)
        timer = setTimeout(poll, 3000 * Math.max(1, failures));
    }
    timer = setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, initial.projectId]);

  function mutate(action: () => Promise<Result>, onSuccess?: () => void) {
    startTransition(async () => {
      try {
        if (accept(await action())) onSuccess?.();
      } catch {
        setError(
          "The connection was interrupted. Refresh or retry; saved messages are preserved.",
        );
      }
    });
  }
  function send(mode: "message" | "start" | "retry") {
    const content = mode === "message" ? message.trim() : "";
    if (mode === "message" && !content) return;
    if (
      !request.current ||
      request.current.content !== content ||
      request.current.mode !== mode
    ) {
      request.current = {
        requestId: crypto.randomUUID(),
        content,
        mode,
        expectedRevision: view.state.revision,
      };
    }
    const submission = request.current;
    mutate(
      () => sendConsultation(view.projectId, submission),
      () => {
        request.current = null;
        setMessage("");
        router.refresh();
      },
    );
  }
  return (
    <section
      className="overflow-hidden rounded-xl border border-slate-200 bg-white"
      aria-labelledby="consultation-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
        <div>
          <h2
            id="consultation-heading"
            className="text-lg font-semibold text-slate-900"
          >
            Product consultation
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Shape your idea with the Planner. You decide when it is ready.
          </p>
        </div>
        <span
          role="status"
          className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium capitalize text-slate-700"
        >
          {view.state.status.replaceAll("_", " ")}
        </span>
      </div>
      <div
        className="max-h-[32rem] space-y-4 overflow-y-auto bg-slate-50/70 p-4 sm:p-5"
        role="log"
        aria-label="Consultation conversation"
      >
        {!view.messages.length && (
          <p className="text-sm text-slate-500">
            Start consultation to discuss your idea with the Planner.
          </p>
        )}
        {view.messages.map((item) => (
          <article
            key={item.id}
            className={`max-w-[95%] rounded-xl border p-4 sm:max-w-[90%] ${item.role === "user" ? "ml-auto border-brand-100 bg-brand-50" : "border-slate-200 bg-white"}`}
          >
            <p className="mb-1 text-xs font-semibold text-slate-500">
              {item.role === "assistant" ? "Planner" : "You"}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">
              {item.content}
            </p>
          </article>
        ))}
        {active && (
          <p role="status" className="animate-pulse text-sm text-slate-500">
            {view.state.status === "queued"
              ? "Queued — waiting for the Worker…"
              : "Planner is reviewing your requirements…"}
          </p>
        )}
        <div ref={bottom} />
      </div>
      {(error || view.state.error) && (
        <div
          role="alert"
          className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <p>{error || view.state.error}</p>
          <div className="mt-2 flex gap-3">
            {view.state.status === "failed" && !closed && (
              <button
                type="button"
                disabled={pending}
                className="font-semibold underline disabled:opacity-50"
                onClick={() => send("retry")}
              >
                Retry Planner
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              className="underline"
              onClick={() => mutate(() => getConsultation(view.projectId))}
            >
              Refresh status
            </button>
          </div>
        </div>
      )}
      {!closed && (
        <form
          className="space-y-3 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            send("message");
          }}
        >
          <label
            htmlFor="consultation-message"
            className="text-sm font-medium text-slate-700"
          >
            Your answer or correction
          </label>
          <textarea
            id="consultation-message"
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              request.current = null;
            }}
            maxLength={6000}
            rows={3}
            className={control}
            placeholder="Answer the questions, add details, or correct an earlier answer…"
            disabled={active || pending}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Saved privately to this project. You can correct earlier answers
              at any time.
            </p>
            {view.state.revision === 0 ? (
              <button
                type="button"
                className={button}
                disabled={pending}
                onClick={() => send("start")}
              >
                Start consultation
              </button>
            ) : (
              <button
                className={button}
                disabled={active || pending || !message.trim()}
              >
                {pending ? "Saving…" : "Send"}
              </button>
            )}
          </div>
        </form>
      )}
      <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
        Estimated spend: ${view.budget.spentUsd.toFixed(4)} · Reserved: $
        {view.budget.reservedUsd.toFixed(4)} · Project budget: $
        {view.budget.limitUsd.toFixed(2)}
        <p className="mt-1">
          Estimates use reported tokens and configured model pricing.
          Unconfirmed requests retain a conservative reservation.
        </p>
      </div>
      <ReferenceImages
        view={view}
        enabled={uploadsEnabled && !closed}
        disabled={pending || active}
        onRefresh={() => mutate(() => getConsultation(view.projectId))}
        onError={setError}
      />
      {view.state.summary && (
        <SummaryEditor
          key={view.state.revision}
          summary={view.state.summary}
          disabled={pending || active || closed}
          onDirty={setSummaryDirty}
          onSave={(summary) =>
            mutate(
              () =>
                saveRequirements(view.projectId, view.state.revision, summary),
              () => {
                setSummaryDirty(false);
                router.refresh();
              },
            )
          }
        />
      )}
      {view.state.status === "ready" && (
        <div className="space-y-3 border-t border-slate-100 p-5">
          <p className="text-sm text-slate-600">
            Review the summary and its assumptions. Save any corrections before
            confirming.
          </p>
          <button
            className={button}
            disabled={pending || summaryDirty}
            onClick={() =>
              mutate(
                () => completeConsultation(view.projectId, view.state.revision),
                () => router.refresh(),
              )
            }
          >
            {pending ? "Saving…" : "Confirm & finish consultation"}
          </button>
        </div>
      )}
      {closed && (
        <p className="border-t border-slate-100 p-5 text-sm text-slate-600">
          {view.state.status === "completed"
            ? "Consultation complete. Your reviewed summary is ready for M3. Prototype generation is not enabled yet."
            : "This project is no longer in consultation."}
        </p>
      )}
    </section>
  );
}
function SummaryEditor({
  summary,
  disabled,
  onSave,
  onDirty,
}: {
  summary: RequirementsSummary;
  disabled: boolean;
  onSave: (summary: RequirementsSummary) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [dirty, setDirty] = useState(false);
  return (
    <form
      className="space-y-4 border-t border-slate-100 p-5"
      onChange={() => {
        setDirty(true);
        onDirty(true);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const draft = Object.fromEntries(
          fields.map(({ key, list }) => {
            const value = String(values.get(key) ?? "");
            return [
              key,
              list
                ? value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
                : value,
            ];
          }),
        ) as RequirementsSummary;
        onSave(draft);
      }}
    >
      <div>
        <h3 className="font-semibold text-slate-900">Requirements summary</h3>
        <p className="mt-1 text-xs text-slate-500">
          Review and edit below. Use one item per line for lists.
        </p>
      </div>
      {fields.map(({ key, label, list }) => (
        <div key={key}>
          <label
            htmlFor={`summary-${key}`}
            className="text-sm font-medium text-slate-700"
          >
            {label}
          </label>
          {key === "intendedUsage" ? (
            <select
              id={`summary-${key}`}
              name={key}
              className={control}
              disabled={disabled}
              defaultValue={summary.intendedUsage}
            >
              <option value="local">Local use</option>
              <option value="temporary_preview">Temporary preview</option>
              <option value="live_ready">Live-ready</option>
            </select>
          ) : (
            <textarea
              id={`summary-${key}`}
              name={key}
              className={control}
              rows={list || key === "description" ? 3 : 2}
              disabled={disabled}
              maxLength={list ? 30000 : 6000}
              defaultValue={
                Array.isArray(summary[key])
                  ? (summary[key] as string[]).join("\n")
                  : String(summary[key])
              }
            />
          )}
        </div>
      ))}
      <button type="submit" className={button} disabled={disabled || !dirty}>
        Save summary corrections
      </button>
    </form>
  );
}
function ReferenceImages({
  view,
  enabled,
  disabled,
  onRefresh,
  onError,
}: {
  view: ConsultationView;
  enabled: boolean;
  disabled: boolean;
  onRefresh: () => void;
  onError: (error: string | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  return (
    <div className="space-y-3 border-t border-slate-100 p-5">
      <h3 className="text-sm font-semibold text-slate-900">
        Reference images{" "}
        <span className="font-normal text-slate-400">optional</span>
      </h3>
      <p className="text-xs text-slate-500">
        Saved privately for future prototype guidance. Describe the design cues
        in chat; M2 does not analyze or generate images.
      </p>
      {!enabled && (
        <p className="text-xs text-slate-500">
          {view.projectStatus === "consultation" ||
          view.projectStatus === "idea_submitted"
            ? "Uploads require a configured private Blob store."
            : "Uploads are closed after consultation."}
        </p>
      )}
      {enabled && (
        <input
          aria-label="Upload reference image"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled || uploading}
          className="max-w-full text-sm text-slate-600"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 4 * 1024 * 1024) {
              onError("Choose an image no larger than 4 MiB.");
              event.target.value = "";
              return;
            }
            setUploading(true);
            const form = new FormData();
            form.set("file", file);
            try {
              const response = await fetch(
                `/api/projects/${view.projectId}/assets`,
                { method: "POST", body: form },
              );
              const result = await response.json();
              if (!response.ok) onError(result.error ?? "Upload failed.");
              else {
                onError(null);
                onRefresh();
              }
            } catch {
              onError("Image upload failed. Please retry.");
            } finally {
              setUploading(false);
              event.target.value = "";
            }
          }}
        />
      )}
      {uploading && (
        <p role="status" className="text-xs text-slate-500">
          Uploading privately…
        </p>
      )}
      {view.assets.length > 0 && (
        <ul className="space-y-1 text-sm">
          {view.assets.map((asset) => (
            <li key={asset.id}>
              <a
                href={`/api/projects/${view.projectId}/assets/${asset.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-brand-600 underline"
              >
                {asset.filename ?? "Reference image"}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
