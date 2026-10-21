"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PrototypeView } from "@asf/agents/prototype";
import type { DesignSpecification, ImageSettings } from "@asf/agents/prototype-schema";
import { designSchema } from "@asf/agents/prototype-schema";
import { approveFinalPrototype, approveScreen, estimatePrototype, getPrototype, requestPrototype, updateDesignPlan } from "@/app/actions/prototype";

const button = "rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50";
const secondary = "rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800";
const panel = "rounded-xl border border-slate-200 bg-white p-5 sm:p-6";
type QuoteInput = { mode: "plan" | "generate" | "edit" | "regenerate"; expectedRevision: number; feedback: string; screenId?: string; settings?: ImageSettings; baseVersionId?: string; referenceAssetId?: string };
type PendingQuote = { input: QuoteInput; reservationUsd: number; model: string; quoteHash: string; requestId: string };
function money(value: number) { return `$${value.toFixed(4)}`; }

export function PrototypeWorkspace({ initial, uploadsEnabled }: { initial: PrototypeView; uploadsEnabled: boolean }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [design, setDesign] = useState<DesignSpecification | null>(initial.state.design);
  const [selectedScreen, setSelectedScreen] = useState(initial.state.design?.screens[0]?.id ?? "");
  const [selectedVersion, setSelectedVersion] = useState("");
  const [quality, setQuality] = useState<ImageSettings["quality"]>("low");
  const [size, setSize] = useState<ImageSettings["size"]>("1536x1024");
  const [feedback, setFeedback] = useState("");
  const [reference, setReference] = useState("");
  const [quote, setQuote] = useState<PendingQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const gate = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [rawDesign, setRawDesign] = useState("");
  const active = Boolean(view.state.activeJobId);
  const closed = view.projectStatus === "prototype_approved";
  const disabled = busy || active || closed;
  const screen = view.state.design?.screens.find(item => item.id === selectedScreen);
  const versions = view.versions.filter(item => item.screenId === selectedScreen);
  const currentVersions = versions.filter(item => item.planRevision === view.state.planRevision);
  const latest = currentVersions.at(-1);
  const displayed = versions.find(item => item.id === selectedVersion) ?? latest ?? versions.at(-1);
  const accepted = view.state.acceptedPlanRevision === view.state.planRevision && Boolean(view.state.design);
  const allApproved = accepted && view.state.design!.screens.every(item => {
    const current = view.versions.filter(v => v.screenId === item.id && v.planRevision === view.state.planRevision).at(-1);
    return current && view.state.approvals[item.id] === current.id;
  });
  const remaining = view.budget.limitUsd - view.budget.spentUsd - view.budget.reservedUsd;

  function apply(next: PrototypeView) {
    setView(previous => {
      if (next.state.planRevision !== previous.state.planRevision) {
        setDesign(next.state.design); setSelectedScreen(next.state.design?.screens[0]?.id ?? ""); setSelectedVersion("");
      }
      return next;
    });
  }
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let polling = false;
    const timer = setInterval(async () => {
      if (polling) return; polling = true;
      try {
        const result = await getPrototype(view.projectId);
        if (!stopped && result.data) { apply(result.data); if (!result.data.state.activeJobId) router.refresh(); }
        if (!stopped && result.error) setError(result.error);
      } catch { if (!stopped) setError("Connection interrupted. Refresh to check saved job status."); }
      finally { polling = false; }
    }, 2500);
    return () => { stopped = true; clearInterval(timer); };
  }, [active, view.projectId, router]);
  useEffect(() => { if (screen) setSize(screen.viewport === "mobile" ? "1024x1536" : "1536x1024"); }, [screen?.id, screen?.viewport]);

  async function run(action: () => Promise<{ data: PrototypeView | null; error: string | null }>) {
    if (gate.current) return; gate.current = true; setBusy(true); setError(null);
    try {
      const result = await action();
      if (result.data) { apply(result.data); setDesign(result.data.state.design); setQuote(null); router.refresh(); }
      if (result.error) setError(result.error);
    } catch { setError("Connection interrupted. Refresh to check saved state before submitting again."); }
    finally { gate.current = false; setBusy(false); }
  }
  async function estimate(mode: QuoteInput["mode"]) {
    if (gate.current) return; gate.current = true; setBusy(true); setError(null); setQuote(null);
    const input: QuoteInput = { mode, expectedRevision: view.state.revision, feedback,
      ...(mode === "plan" ? {} : { screenId: selectedScreen, settings: { size, quality } }),
      ...(mode === "edit" && displayed ? { baseVersionId: displayed.id } : {}),
      ...(mode === "edit" && reference ? { referenceAssetId: reference } : {}) };
    try {
      const result = await estimatePrototype(view.projectId, input);
      if (result.data) setQuote({ input, ...result.data, requestId: crypto.randomUUID() });
      if (result.error) setError(result.error);
    } catch { setError("Could not retrieve an estimate. Please try again."); }
    finally { gate.current = false; setBusy(false); }
  }
  function editScreen(index: number, key: string, value: unknown) {
    setDesign(previous => previous ? { ...previous, screens: previous.screens.map((item, i) => i === index ? { ...item, [key]: value } : item) } : previous);
    setQuote(null);
  }

  async function uploadReference(file: File) {
    if (gate.current) return;
    if (file.size > 4 * 1024 * 1024) { setError("Choose a reference image no larger than 4 MiB."); return; }
    gate.current = true; setBusy(true); setError(null);
    try {
      const body = new FormData(); body.set("file", file);
      const response = await fetch(`/api/projects/${view.projectId}/assets`, { method: "POST", body });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? "Reference upload failed."); return; }
      const refreshed = await getPrototype(view.projectId);
      if (refreshed.data) apply(refreshed.data);
      setReference(result.id); setQuote(null);
    } catch { setError("Reference upload failed. Please retry."); }
    finally { gate.current = false; setBusy(false); }
  }

  return (
    <section className="space-y-5" aria-label="Prototype Workspace">
      <div className={panel}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Visual prototype · M3</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Prototype Workspace</h2><p className="mt-1 text-sm text-slate-500">Plan, explore and approve {view.title} before development.</p></div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{closed ? "Prototype approved" : active ? view.state.status === "queued" ? "Queued for Worker" : "Generating…" : "Ready for review"}</span>
        </div>
        <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium text-slate-700">Approved requirements</summary><p className="mt-2 text-slate-600">{view.requirements.description}</p><ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">{view.requirements.requiredFunctionality.map(item => <li key={item}>{item}</li>)}</ul></details>
        <dl className="mt-5 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-4">
          {[["Project cost", money(view.budget.spentUsd)], ["Reserved", money(view.budget.reservedUsd)], ["Remaining", money(Math.max(0, remaining))], ["Budget", money(view.budget.limitUsd)]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-semibold text-slate-800">{value}</dd></div>)}
        </dl>
        {(error || view.state.error) && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error || view.state.error}</p>}
        {active && <p role="status" className="mt-3 text-sm text-brand-700">Your request is saved. You can leave this page and return while the Worker processes it.</p>}
      </div>

      <div className={panel}>
        <h3 className="font-semibold text-slate-900">1. Review the design plan</h3>
        {!design ? <p className="mt-2 text-sm text-slate-500">Ask the Planner to turn your approved requirements into the screens your product needs. Image generation starts only after your confirmation.</p> : <div className="mt-4 space-y-4">
          <p className="text-sm text-slate-600">{design.productOverview}</p>
          <label className="block text-sm font-medium text-slate-700">Design direction<textarea className={field} rows={3} disabled={disabled} value={design.visualDirection} onChange={event => { setDesign({ ...design, visualDirection: event.target.value }); setQuote(null); }} /></label>
          <p className="text-xs text-slate-500">{design.tokens.typography} · {design.tokens.colors.join(" · ")}</p>
          <div className="space-y-3">{design.screens.map((item, index) => <details key={item.id} className="rounded-lg border border-slate-200 p-3" open={design.screens.length === 1}>
            <summary className="cursor-pointer text-sm font-medium text-slate-800">{item.name} <span className="font-normal text-slate-400">· {item.viewport}</span></summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-700">Screen name<input className={field} disabled={disabled} value={item.name} maxLength={120} onChange={event => editScreen(index, "name", event.target.value)} /></label>
              <label className="text-sm text-slate-700">Viewport<select className={field} disabled={disabled} value={item.viewport} onChange={event => editScreen(index, "viewport", event.target.value)}><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select></label>
              <label className="text-sm text-slate-700 sm:col-span-2">Purpose<textarea className={field} disabled={disabled} value={item.purpose} onChange={event => editScreen(index, "purpose", event.target.value)} /></label>
              <label className="text-sm text-slate-700 sm:col-span-2">Layout<textarea className={field} disabled={disabled} value={item.layout} onChange={event => editScreen(index, "layout", event.target.value)} /></label>
              <p className="text-xs text-slate-500 sm:col-span-2">Components: {item.components.join(", ")}<br />Responsive: {item.responsive}</p>
              <button className={secondary} disabled={disabled || design.screens.length <= 1} onClick={() => setDesign({ ...design, screens: design.screens.filter(s => s.id !== item.id).map(s => ({ ...s, navigationTo: s.navigationTo.filter(id => id !== item.id) })) })}>Remove screen</button>
            </div>
          </details>)}</div>
          <div className="flex flex-wrap gap-2">
            <button className={secondary} disabled={disabled || design.screens.length >= 12} onClick={() => setDesign({ ...design, screens: [...design.screens, { id: `screen-${crypto.randomUUID().slice(0, 8)}`, name: "New screen", purpose: "Describe its purpose", layout: "Describe the layout", components: ["Main content"], controls: [], interactions: [], requirementReferences: [view.requirements.requiredFunctionality[0]!], navigationTo: [], viewport: "desktop", responsive: "Stack content on small screens" }] })}>Add screen</button>
            <button className={secondary} disabled={disabled} onClick={() => run(() => updateDesignPlan(view.projectId, view.state.revision, design, false))}>Save draft</button>
            <button className={button} disabled={disabled} onClick={() => run(() => updateDesignPlan(view.projectId, view.state.revision, design, true))}>Accept design plan</button>
          </div>
          <button className="text-sm text-brand-700 underline" onClick={() => { setAdvanced(!advanced); setRawDesign(JSON.stringify(design, null, 2)); }}>Edit full specification</button>
          {advanced && <div><label className="text-sm text-slate-700">Structured design specification<textarea className={`${field} font-mono`} rows={16} disabled={disabled} value={rawDesign} onChange={event => setRawDesign(event.target.value)} /></label><button className={secondary} disabled={disabled} onClick={() => { try { setDesign(designSchema.parse(JSON.parse(rawDesign))); setAdvanced(false); setQuote(null); } catch { setError("Enter a valid structured design specification."); } }}>Apply specification</button></div>}
          {design.limitations.length > 0 && <p className="text-xs text-slate-500">Design limitations: {design.limitations.join(" ")}</p>}
        </div>}
        {!closed && <div className="mt-4 border-t border-slate-100 pt-4"><label className="block text-sm text-slate-700">Feedback for planning or revision<textarea className={field} maxLength={2000} rows={3} disabled={busy} value={feedback} onChange={event => { setFeedback(event.target.value); setQuote(null); }} placeholder="Describe the design direction or the changes you want." /></label><button className={`${secondary} mt-3`} disabled={disabled} onClick={() => estimate("plan")}>{design ? "Estimate a revised design plan" : "Estimate design planning"}</button></div>}
      </div>

      {view.state.design && <div className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-slate-900">2. Explore and revise screens</h3><p className="text-xs text-slate-500">Plan {view.state.planRevision} · {accepted ? "Accepted" : "Awaiting acceptance"}</p></div>
        <div className="mt-4 flex flex-wrap gap-2">{view.state.design.screens.map(item => <button key={item.id} onClick={() => { setSelectedScreen(item.id); setSelectedVersion(""); setQuote(null); }} className={`${secondary} ${selectedScreen === item.id ? "border-brand-500 bg-brand-50" : ""}`} aria-pressed={selectedScreen === item.id}>{item.name} {view.state.approvals[item.id] ? "✓" : ""}</button>)}</div>
        {screen && <p className="mt-3 text-sm text-slate-500">{screen.purpose}</p>}
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          {displayed ? <a href={displayed.imagePath} target="_blank" rel="noreferrer" aria-label="View full-size prototype"><img src={displayed.imagePath} alt={`${screen?.name ?? "Prototype"} version ${displayed.version}`} className="max-h-[640px] w-full object-contain" /></a> : <div className="flex min-h-64 items-center justify-center p-8 text-center text-sm text-slate-400">{active ? "Your selected screen is being prepared." : "Generate this screen to explore its visual design."}</div>}
        </div>
        {displayed && <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><label className="text-sm text-slate-600">Version history<select className={field} value={displayed.id} onChange={event => { setSelectedVersion(event.target.value); setQuote(null); }}>{[...versions].reverse().map(version => <option key={version.id} value={version.id}>v{version.version} · plan {version.planRevision} · {version.quality} · {version.createdAt}</option>)}</select></label><p className="text-xs text-slate-500">{displayed.model}<br />{displayed.size} · {money(displayed.costUsd)} {displayed.costBasis.includes("reported") ? "estimated from usage" : "reserved estimate"}<br />{displayed.feedback}</p></div>}
        {!closed && <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-slate-700">Quality<select className={field} disabled={disabled} value={quality} onChange={event => { setQuality(event.target.value as ImageSettings["quality"]); setQuote(null); }}><option value="low">Draft · low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
            <label className="text-sm text-slate-700">Resolution<select className={field} disabled={disabled} value={size} onChange={event => { setSize(event.target.value as ImageSettings["size"]); setQuote(null); }}><option value="1536x1024">1536 × 1024 · landscape</option><option value="1024x1536">1024 × 1536 · portrait</option><option value="1024x1024">1024 × 1024 · square</option></select></label>
            <label className="text-sm text-slate-700">Revision reference<select className={field} disabled={disabled} value={reference} onChange={event => { setReference(event.target.value); setQuote(null); }}><option value="">No reference</option>{view.references.map(item => <option value={item.id} key={item.id}>{item.filename}</option>)}</select></label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={button} disabled={disabled || !accepted || !uploadsEnabled} onClick={() => estimate(latest ? "regenerate" : "generate")}>{latest ? "Estimate regeneration" : "Estimate this screen"}</button>
            <button className={secondary} disabled={disabled || !accepted || !displayed || displayed.planRevision !== view.state.planRevision || !feedback.trim() || !uploadsEnabled} onClick={() => estimate("edit")}>Request changes · estimate</button>
            <button className={secondary} disabled={disabled || !latest || displayed?.id !== latest.id || view.state.approvals[selectedScreen] === latest.id} onClick={() => run(() => approveScreen(view.projectId, view.state.revision, selectedScreen, latest!.id))}>Approve screen</button>
          </div>
          <label className="block text-sm text-slate-700">Upload a revision reference (PNG, JPEG or WebP, up to 4 MiB)<input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || !uploadsEnabled} className="mt-2 block w-full text-sm" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadReference(file); event.target.value = ""; }} /></label>
          {!uploadsEnabled && <p className="text-sm text-amber-700">Private image storage must be configured before image generation.</p>}
          <p className="text-xs text-slate-500">One screen per request. Each successful revision is preserved. Images are design references; final approval requires the latest version of every screen.</p>
        </div>}
      </div>}

      {quote && <div role="dialog" aria-modal="false" aria-label="Confirm paid prototype request" className="rounded-xl border-2 border-brand-300 bg-brand-50 p-5">
        <h3 className="font-semibold text-slate-900">Confirm {quote.input.mode === "plan" ? "design planning" : "image generation"}</h3><p className="mt-2 text-sm text-slate-700">Reserve {money(quote.reservationUsd)} from this project’s budget for one request using {quote.model}.</p><p className="mt-2 text-xs text-slate-600">This is a conservative cost estimate, not an exact charge. Uncertain outcomes retain the reservation. Failed image requests are never retried automatically.</p>
        <div className="mt-4 flex gap-2"><button className={button} disabled={disabled || quote.reservationUsd > remaining} onClick={() => run(() => requestPrototype(view.projectId, { ...quote.input, confirmed: true, requestId: quote.requestId, quoteHash: quote.quoteHash }))}>Confirm paid request</button><button className={secondary} disabled={busy} onClick={() => setQuote(null)}>Cancel</button></div>
        {quote.reservationUsd > remaining && <p className="mt-2 text-sm text-red-700">The remaining project budget cannot cover this request.</p>}
      </div>}
      <div className={panel}>
        <h3 className="font-semibold text-slate-900">3. Final prototype approval</h3>
        {closed ? <div className="mt-3 text-sm text-slate-600"><p>Approved versions and the structured design handoff are saved. This milestone is complete.</p><a className="mt-3 inline-block font-medium text-brand-700 underline" href={`/api/projects/${view.projectId}/prototype-handoff`} target="_blank" rel="noreferrer">View approved design handoff</a></div> : <div><p className="mt-2 text-sm text-slate-500">Review and approve every required screen. Final approval locks these specific versions and saves the design specification for the next milestone.</p><button className={`${button} mt-4`} disabled={disabled || !allApproved} onClick={() => run(() => approveFinalPrototype(view.projectId, view.state.revision))}>Approve final prototype</button></div>}
      </div>
    </section>
  );
}
