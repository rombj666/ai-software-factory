import { and, eq, sql } from "drizzle-orm";
import type { DbClient } from "@asf/db";
import { agentRuns, artifacts, cleanupJobs, lifecycleEvents, projectAssets, projects, prototypeVersions, usageLogs, workflowJobs } from "@asf/db/schema";
import { lockProject } from "@asf/agents/consultation";
import { planningProvider, designRequest, imagePrompt, savePrototypeState } from "@asf/agents/prototype";
import { prototypeState, validateDesign, validateDesignTraceability, approvedRequirements, prototypeRequestSchema } from "@asf/agents/prototype-schema";
import { imageCost, imageReservation, type ImagePricing } from "@asf/agents/prototype-pricing";
import { estimatedUsd } from "@asf/agents/pricing";
import { ProviderError, type AIProvider, type AIResult } from "@asf/agents/provider";
import { OpenAIImageProvider, type ImageProvider, type ImageResult } from "@asf/agents/prototype-provider";
import { privatePrototypeStorage, validatePrototypeImage, MAX_PROTOTYPE_BYTES, type PrototypeStorage } from "@asf/agents/prototype-storage";
import type { ClaimedJob } from "./jobQueue";

export interface PrototypeDependencies { planner?: AIProvider; images?: ImageProvider; storage?: PrototypeStorage; }
/** Never replay a dispatched paid call. A durable reservation survives crashes. */
export async function handlePrototypeTask(db: DbClient, job: ClaimedJob, workerId: string, leaseSeconds: number, injected: PrototypeDependencies = {}) {
  if (!job.projectId) throw new Error("Prototype job missing project.");
  const projectId = job.projectId;
  const storage = injected.storage ?? privatePrototypeStorage;
  const prepared = await db.transaction(async tx => {
    const project = await lockProject(tx, projectId);
    const state = prototypeState(project.currentState);
    const [queued] = await tx.select().from(workflowJobs).where(eq(workflowJobs.id, job.id));
    if (!queued || queued.status !== "claimed" || queued.claimedBy !== workerId || !queued.leaseExpiresAt || queued.leaseExpiresAt <= new Date()) return null;
    const [run] = await tx.select().from(agentRuns).where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.agentType, "prototype"), sql`${agentRuns.input}->>'jobId' = ${job.id}`));
    if (!run || run.status !== "running") {
      await tx.update(workflowJobs).set({ status: "failed", error: "Prototype reservation is no longer active.", claimedBy: null, leaseExpiresAt: null, finishedAt: new Date() }).where(eq(workflowJobs.id, job.id));
      if (state.activeJobId === job.id) await savePrototypeState(tx, project, { ...state, activeJobId: null, status: "failed", error: "Prototype reservation is no longer active." });
      return null;
    }
    const reservationUsd = Number(run.input?.reservationUsd);
    let error: string | null = null;
    if (run.input?.phase === "dispatched") {
      await tx.insert(usageLogs).values({ projectId, kind: "external_api", provider: "openai", amount: reservationUsd.toFixed(6), unit: "USD",
        metadata: { jobId: job.id, agentRunId: run.id, pricing: run.input.pricing, model: run.input.model, actualTokensKnown: false, costBasis: "uncertain_reserved_upper_bound" } });
      error = "Worker interrupted after dispatch. Cost retained conservatively; review provider usage before explicitly retrying.";
    } else if (project.status !== "prototype_pending" || state.activeJobId !== job.id || state.revision !== job.payload.revision) error = "This prototype job was superseded.";
    if (error) {
      await tx.update(agentRuns).set({ status: "failed", error, finishedAt: new Date() }).where(eq(agentRuns.id, run.id));
      await tx.update(workflowJobs).set({ status: "failed", error, finishedAt: new Date(), claimedBy: null, leaseExpiresAt: null }).where(eq(workflowJobs.id, job.id));
      if (state.activeJobId === job.id) await savePrototypeState(tx, project, { ...state, activeJobId: null, status: "failed", error });
      return null;
    }
    return { project, state, run, reservationUsd, input: prototypeRequestSchema.parse(Object.fromEntries(Object.entries(job.payload).filter(([key]) => !["requestHash", "revision", "planRevision"].includes(key)))) };
  });
  if (!prepared) return;
  const { input } = prepared;
  let result: AIResult | ImageResult | undefined;
  let design: ReturnType<typeof validateDesign> | undefined;
  let image: Awaited<ReturnType<typeof validatePrototypeImage>> | undefined;
  let failure: ProviderError | undefined;
  let amount: number | undefined;
  let basis = "estimated_from_reported_tokens";
  let dispatched = false;
  const path = `projects/${projectId}/prototypes/${job.id}.png`;
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey && !injected.planner && !injected.images) throw new ProviderError("OpenAI is not configured on the Worker.", false, false);
    const timeout = Number(process.env.OPENAI_PROTOTYPE_IMAGE_TIMEOUT_MS ?? 60000);
    if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 180000 || timeout + 30000 >= leaseSeconds * 1000) throw new ProviderError("Image timeout plus 30 seconds must fit inside the Worker lease.", false, false);
    const images: Buffer[] = [];
    let planner: AIProvider | undefined;
    let imageProvider: ImageProvider | undefined;
    let prompt = "";
    if (input.mode === "plan") {
      const config = planningProvider();
      planner = injected.planner ?? config.provider;
      if (config.timeout + 30000 >= leaseSeconds * 1000) throw new ProviderError("Planner timeout does not fit the Worker lease.", false, false);
      const bound = estimatedUsd({ inputTokens: planner.inputTokenBound(designRequest(prepared.project, input.feedback)), cachedInputTokens: 0, outputTokens: planner.maxOutputTokens }, prepared.run.input!.pricing as unknown as ReturnType<typeof planningProvider>["pricing"]);
      if (planner.model !== prepared.run.input?.model || bound > prepared.reservationUsd + 1e-9) throw new ProviderError("Planner configuration changed. Request a fresh estimate.", false, false);
    } else {
      if (!process.env.BLOB_READ_WRITE_TOKEN && !injected.storage) throw new ProviderError("Private Blob is not configured on the Worker.", false, false);
      const rates = prepared.run.input!.pricing as unknown as ImagePricing;
      imageProvider = injected.images ?? new OpenAIImageProvider(apiKey!, rates.model, timeout);
      if (imageProvider.model !== rates.model) throw new ProviderError("Image model changed after confirmation.", false, false);
      prompt = imagePrompt(prepared.project, input);
      if (input.mode === "edit") {
        const references = await db.transaction(async tx => {
          const project = await lockProject(tx, projectId);
          if (project.ownerId !== prepared.project.ownerId) throw new ProviderError("Project ownership changed.", false, false);
          const [base] = await tx.select().from(prototypeVersions).where(and(eq(prototypeVersions.id, input.baseVersionId!), eq(prototypeVersions.projectId, projectId)));
          if (!base) throw new ProviderError("Revision source no longer exists.", false, false);
          const [reference] = input.referenceAssetId ? await tx.select().from(projectAssets).where(and(eq(projectAssets.id, input.referenceAssetId), eq(projectAssets.projectId, projectId), eq(projectAssets.kind, "reference_image"))) : [];
          if (input.referenceAssetId && !reference) throw new ProviderError("Reference no longer exists.", false, false);
          return [base.imageStorageUri, ...(reference ? [reference.storageUri] : [])];
        });
        for (const uri of references) images.push((await validatePrototypeImage(await storage.read(uri))).bytes);
      }
      if (imageReservation(prompt, input.settings!, images.length, rates) > prepared.reservationUsd + 1e-9) throw new ProviderError("Image estimate changed. Confirm a fresh request.", false, false);
    }
    // Commit the dispatch marker BEFORE the API. Recovery treats it as billed
    // uncertainty, including a crash between this commit and the network call.
    const ready = await db.transaction(async tx => {
      const project = await lockProject(tx, projectId);
      const state = prototypeState(project.currentState);
      const [queued] = await tx.select().from(workflowJobs).where(eq(workflowJobs.id, job.id));
      const [run] = await tx.select().from(agentRuns).where(eq(agentRuns.id, prepared.run.id));
      if (!queued || queued.status !== "claimed" || queued.claimedBy !== workerId || !queued.leaseExpiresAt || queued.leaseExpiresAt <= new Date() || run?.status !== "running" || run.input?.phase !== "reserved") return false;
      if (state.activeJobId !== job.id || state.revision !== job.payload.revision || project.status !== "prototype_pending") throw new ProviderError("Prototype job superseded before dispatch.", false, false);
      await tx.update(agentRuns).set({ input: { ...run.input, phase: "dispatched", storagePath: input.mode === "plan" ? null : path }, startedAt: new Date() }).where(eq(agentRuns.id, run.id));
      if (input.mode !== "plan") await tx.insert(cleanupJobs).values({ projectId, resourceType: "prototype_orphan", externalId: path, scheduledFor: new Date(Date.now() + 15 * 60000) });
      await tx.update(workflowJobs).set({ status: "running" }).where(eq(workflowJobs.id, job.id));
      await savePrototypeState(tx, project, { ...state, status: "processing" });
      return true;
    });
    if (!ready) return;
    dispatched = true;
    if (planner) {
      const response = await planner.consult(designRequest(prepared.project, input.feedback)); result = response;
      amount = estimatedUsd(response.usage, prepared.run.input!.pricing as unknown as ReturnType<typeof planningProvider>["pricing"]);
      if (response.outcome !== "completed") throw new ProviderError("Design Planner output was incomplete or refused. Request a new plan explicitly.", false, false);
      design = validateDesignTraceability(validateDesign(response.value), approvedRequirements(prepared.project.currentState).summary);
    } else {
      const response = await imageProvider!.create(prompt, input.settings!, images, prepared.project.ownerId); result = response;
      if (response.usage) amount = imageCost(response.usage, prepared.run.input!.pricing as unknown as ImagePricing);
      else { amount = prepared.reservationUsd; basis = "reserved_upper_bound_no_usage"; }
      if (!response.base64 || response.base64.length > Math.ceil(MAX_PROTOTYPE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(response.base64)) throw new ProviderError("OpenAI returned an invalid or oversized image. No image was saved.", false, false);
      image = await validatePrototypeImage(Buffer.from(response.base64, "base64"), input.settings!.size);
      await storage.write(path, image.bytes);
    }
  } catch (error) {
    // Database faults reach the existing circuit breaker. Never auto-replay a
    // call whose dispatch marker is already durable.
    const { isDatabaseError } = await import("./errors");
    if (isDatabaseError(error)) throw error;
    failure = error instanceof ProviderError ? error : new ProviderError(dispatched ? "Prototype result could not be validated or stored. Review usage and explicitly retry." : "Prototype configuration or reference image is unavailable. No paid request was made.", false, dispatched && !result);
  }
  await db.transaction(async tx => {
    const project = await lockProject(tx, projectId); const state = prototypeState(project.currentState);
    const [run] = await tx.select().from(agentRuns).where(eq(agentRuns.id, prepared.run.id));
    if (!run || run.status !== "running") return;
    if (amount === undefined && (failure?.uncertain || result)) { amount = prepared.reservationUsd; basis = "uncertain_reserved_upper_bound"; }
    if (amount !== undefined) await tx.insert(usageLogs).values({ projectId, kind: result ? "tokens" : "external_api", provider: "openai", amount: amount.toFixed(6), unit: "USD",
      metadata: { agentRunId: run.id, jobId: job.id, model: run.input?.model, pricing: run.input?.pricing, costBasis: basis, reservationUsd: prepared.reservationUsd, actualTokensKnown: Boolean(result?.usage), usage: result?.usage ?? null, requestId: result && "requestId" in result ? result.requestId : result && "id" in result ? result.id : null } });
    if (state.activeJobId !== job.id || state.revision !== job.payload.revision || project.status !== "prototype_pending") failure = new ProviderError("Prototype result was superseded.", false, false);
    let next = { ...state, activeJobId: null, error: failure?.message ?? null, status: failure ? "failed" as const : "review" as const };
    let versionId: string | null = null;
    if (!failure && design) {
      const planRevision = state.planRevision + 1;
      await tx.insert(artifacts).values({ projectId, kind: "prototype_design", metadata: { design, planRevision, jobId: job.id, consultationRevision: prepared.project.currentState?.consultation, accepted: false } });
      next = { ...next, design, planRevision, acceptedPlanRevision: null, approvals: {} };
    } else if (!failure && image) {
      const versions = await tx.select({ id: prototypeVersions.id }).from(prototypeVersions).where(eq(prototypeVersions.projectId, projectId));
      const history = await tx.select().from(artifacts).where(and(eq(artifacts.projectId, projectId), eq(artifacts.kind, "prototype_image")));
      const screenVersion = history.filter(row => row.metadata?.screenId === input.screenId).length + 1;
      const [version] = await tx.insert(prototypeVersions).values({ projectId, version: versions.length + 1, imageStorageUri: path, prompt: imagePrompt(prepared.project, input) }).returning();
      if (!version) throw new Error("Image version insert failed");
      versionId = version.id;
      await tx.insert(artifacts).values({ projectId, kind: "prototype_image", storageUri: path, metadata: {
        versionId, screenId: input.screenId, screenVersion, planRevision: state.planRevision, design: state.design,
        requirements: prepared.project.currentState?.consultation, feedback: input.feedback, baseVersionId: input.baseVersionId ?? null,
        referenceAssetId: input.referenceAssetId ?? null, jobId: job.id, model: run.input?.model, quality: input.settings!.quality, size: input.settings!.size,
        width: image.width, height: image.height, costUsd: amount, costBasis: basis, pricing: run.input?.pricing,
      } });
      const screenApprovals = { ...state.approvals }; delete screenApprovals[input.screenId!];
      next = { ...next, approvals: screenApprovals };
      // A linked image must never be cleaned up; failed/crashed uploads retain
      // their pending cleanup record and are handled by the bounded sweeper.
      await tx.update(cleanupJobs).set({ status: "succeeded" }).where(and(eq(cleanupJobs.resourceType, "prototype_orphan"), eq(cleanupJobs.externalId, path)));
    }
    await tx.update(agentRuns).set({ status: failure ? "failed" : "succeeded", error: failure?.message ?? null, finishedAt: new Date(), output: { versionId, costUsd: amount ?? 0, costBasis: basis } }).where(eq(agentRuns.id, run.id));
    await tx.update(workflowJobs).set({ status: failure ? "failed" : "succeeded", error: failure?.message ?? null, result: { versionId }, finishedAt: new Date(), claimedBy: null, leaseExpiresAt: null }).where(eq(workflowJobs.id, job.id));
    if (state.activeJobId === job.id) await savePrototypeState(tx, project, next);
    await tx.insert(lifecycleEvents).values({ projectId, eventType: failure ? "prototype.failed" : "prototype.generated", payload: { jobId: job.id, versionId, mode: input.mode } });
  });
}

/** Only M3 deterministic paths, never reference/customer uploads. Repeatable. */
export async function cleanupPrototypeOrphans(db: DbClient, storage: PrototypeStorage = privatePrototypeStorage) {
  const pending = await db.select().from(cleanupJobs).where(and(eq(cleanupJobs.resourceType, "prototype_orphan"), eq(cleanupJobs.status, "pending"), sql`${cleanupJobs.scheduledFor} <= now()`)).limit(10);
  for (const cleanup of pending) {
    const path = cleanup.externalId;
    if (!path || !/^projects\/[a-f0-9-]{36}\/prototypes\/[a-f0-9-]{36}\.png$/.test(path)) continue;
    try {
      await db.transaction(async tx => {
        // Share the finalizer's project lock: never race an image becoming
        // linked between separate "linked?" and "active?" reads.
        const projectId = path.split("/")[1]!;
        await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("update");
        const linked = await tx.select({ id: prototypeVersions.id }).from(prototypeVersions).where(eq(prototypeVersions.imageStorageUri, path));
        const active = await tx.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.status, "running"), sql`${agentRuns.input}->>'storagePath' = ${path}`));
        if (active.length) return;
        if (!linked.length) await storage.remove(path);
        await tx.update(cleanupJobs).set({ status: "succeeded" }).where(eq(cleanupJobs.id, cleanup.id));
      });
    } catch {
      await db.update(cleanupJobs).set({ attempts: cleanup.attempts + 1, status: cleanup.attempts + 1 >= cleanup.maxAttempts ? "failed" : "pending", scheduledFor: new Date(Date.now() + 60000) }).where(eq(cleanupJobs.id, cleanup.id));
    }
  }
}
