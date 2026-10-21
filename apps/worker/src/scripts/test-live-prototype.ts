import { readFile, mkdir, open, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import sharp from "sharp";
import { head, BlobNotFoundError } from "@vercel/blob";
import { OpenAIImageProvider, type ImageProvider } from "@asf/agents/prototype-provider";
import { IMAGE_MODEL, imageCost, imageReservation, loadImagePricing, type ImagePricing, type ImageUsage } from "@asf/agents/prototype-pricing";
import { privatePrototypeStorage, validatePrototypeImage, MAX_PROTOTYPE_BYTES, type PrototypeStorage } from "@asf/agents/prototype-storage";
import type { ImageSettings } from "@asf/agents/prototype-schema";

export const LIVE_IMAGE_BUDGET_USD = 0.15;
export const LIVE_IMAGE_CONFIRMATION = "one-image-max-estimate-0.15";
export const LIVE_IMAGE_SETTINGS: ImageSettings = { quality: "low", size: "1536x1024" };
export const LIVE_IMAGE_PROMPT = "Create one polished desktop UI design reference for a simple Inventory Management Dashboard using synthetic sample data only. Landscape interface, white background, dark slate text, indigo accents, accessible system sans-serif typography and consistent 8px spacing. Left navigation: Dashboard and Products. Main content: Inventory overview title, three cards for Total products 24, Low stock 3, Stock value $12400, a simple stock-level bar chart, and a product table with Product, SKU, In stock, Reorder level columns. Show sample rows Notebook INV-001 120 20; Desk lamp INV-002 8 10; Storage box INV-003 45 15. Include search and an Add product button. Straight-on flat software screen, no device frame, readable text, no invented major features. This is a static visual reference, not executable software.";
class LiveConfigurationError extends Error {}

export interface LiveImageReport {
  date: string; runId: string; status: "preflight" | "succeeded" | "failed" | "blocked";
  stage: string; reason: string | null;
  requestedModel: string; actualModel: string | null; modelEvidence: string | null;
  modelAccessVerified: boolean; modelAccessHttpStatus: number | null;
  maximumAuthorizedEstimateUsd: number; conservativeReservationUsd: number;
  estimatorIsGuaranteedBillingCap: false; pricing: ImagePricing;
  paidRequestsAttempted: number; generationSucceeded: boolean;
  quality: string; requestedSize: string; actualImageDimensions: { width: number; height: number } | null;
  returnedMimeType: string | null; apiReportedUsage: ImageUsage | null;
  estimatedUsdFromReportedUsage: number | null; requestId: string | null;
  privateBlobPath: string; privateBlobUploadSucceeded: boolean;
  privateBlobReadBackSucceeded: boolean; contentIntegrityVerified: boolean;
  contentSha256: string | null; uploadedBytes: number | null;
  cleanupAttempted: boolean; cleanupSucceeded: boolean | null; cleanupAbsenceVerified: boolean;
  authenticatedHttpRetrievalVerified: false; productionDatabaseModified: false;
}
export interface LiveImageDependencies {
  provider: ImageProvider; storage: PrototypeStorage;
  checkModelAccess(): Promise<{ id: string | null; status: number }>;
  claimAttempt(report: LiveImageReport): Promise<void>;
  saveReport(report: LiveImageReport): Promise<void>;
  verifyAbsent(path: string): Promise<boolean>;
  event?(event: { stage: string; reservationUsd: number; model: string }): void;
}

/** Testable single paid attempt. No database client, Worker, retries or HTTP login. */
export async function verifyLiveImage(
  pricing: ImagePricing,
  options: { confirmation?: string; preflightOnly?: boolean; runId?: string },
  deps: LiveImageDependencies,
): Promise<LiveImageReport> {
  const runId = options.runId ?? randomUUID();
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(runId)) throw new Error("Invalid verification run identifier.");
  if (pricing.model !== IMAGE_MODEL || deps.provider.model !== IMAGE_MODEL) throw new Error("The live test requires gpt-image-2.5-flare exactly.");
  const reservation = imageReservation(LIVE_IMAGE_PROMPT, LIVE_IMAGE_SETTINGS, 0, pricing);
  const report: LiveImageReport = {
    date: new Date().toISOString(), runId, status: "preflight", stage: "budget", reason: null,
    requestedModel: IMAGE_MODEL, actualModel: null, modelEvidence: null,
    modelAccessVerified: false, modelAccessHttpStatus: null,
    maximumAuthorizedEstimateUsd: LIVE_IMAGE_BUDGET_USD, conservativeReservationUsd: reservation,
    estimatorIsGuaranteedBillingCap: false, pricing,
    paidRequestsAttempted: 0, generationSucceeded: false,
    quality: "low", requestedSize: LIVE_IMAGE_SETTINGS.size, actualImageDimensions: null,
    returnedMimeType: null, apiReportedUsage: null, estimatedUsdFromReportedUsage: null, requestId: null,
    privateBlobPath: `verification/m3/${runId}/inventory-dashboard.png`,
    privateBlobUploadSucceeded: false, privateBlobReadBackSucceeded: false,
    contentIntegrityVerified: false, contentSha256: null, uploadedBytes: null,
    cleanupAttempted: false, cleanupSucceeded: null, cleanupAbsenceVerified: false,
    authenticatedHttpRetrievalVerified: false, productionDatabaseModified: false,
  };
  let uploadAttempted = false;
  try {
    if (!Number.isFinite(reservation) || reservation > LIVE_IMAGE_BUDGET_USD) {
      report.status = "blocked"; report.reason = "Conservative reservation exceeds the authorized $0.15 estimate.";
      return report;
    }
    if (!options.preflightOnly && options.confirmation !== LIVE_IMAGE_CONFIRMATION) {
      report.status = "blocked"; report.reason = "Explicit single-image confirmation is required.";
      return report;
    }
    report.stage = "model_access";
    const access = await deps.checkModelAccess();
    report.modelAccessHttpStatus = access.status;
    if (access.status !== 200 || access.id !== IMAGE_MODEL) {
      report.status = "blocked"; report.reason = "Model access preflight failed. No paid image request was made.";
      return report;
    }
    report.modelAccessVerified = true;
    if (options.preflightOnly) { report.stage = "preflight_complete"; return report; }
    report.stage = "attempt_guard";
    // Exclusive durable receipt blocks every later CLI invocation, including
    // retries after a crash or an uncertain provider outcome.
    await deps.claimAttempt(report);
    report.stage = "generation";
    report.paidRequestsAttempted = 1;
    await deps.saveReport(report);
    deps.event?.({ stage: "dispatching_one_image", reservationUsd: reservation, model: IMAGE_MODEL });
    const response = await deps.provider.create(LIVE_IMAGE_PROMPT, LIVE_IMAGE_SETTINGS, [], `synthetic-m3-verification-${runId}`);
    report.actualModel = response.model;
    report.modelEvidence = "Exact model specified in the Images request and verified by Models.retrieve; Images response does not independently echo a resolved model snapshot.";
    report.requestId = response.requestId;
    if (response.usage) {
      // Only known numeric usage fields are persisted; never raw provider errors.
      const usage: ImageUsage = {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        total_tokens: response.usage.total_tokens,
        input_tokens_details: {
          text_tokens: response.usage.input_tokens_details?.text_tokens,
          image_tokens: response.usage.input_tokens_details?.image_tokens,
        },
      };
      report.estimatedUsdFromReportedUsage = imageCost(usage, pricing);
      report.apiReportedUsage = usage;
    }
    await deps.saveReport(report);
    report.stage = "image_validation";
    const encoded = response.base64;
    if (!encoded || encoded.length > Math.ceil(MAX_PROTOTYPE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("Invalid image response.");
    const returnedBytes = Buffer.from(encoded, "base64");
    const metadata = await sharp(returnedBytes, { limitInputPixels: 8_294_400 }).metadata();
    if (metadata.format !== "png") throw new Error("Expected a PNG response.");
    report.returnedMimeType = "image/png";
    const image = await validatePrototypeImage(returnedBytes, LIVE_IMAGE_SETTINGS.size);
    report.generationSucceeded = true;
    report.actualImageDimensions = { width: image.width, height: image.height };
    report.contentSha256 = createHash("sha256").update(image.bytes).digest("hex");
    report.uploadedBytes = image.bytes.length;
    report.stage = "private_blob_upload";
    uploadAttempted = true;
    await deps.storage.write(report.privateBlobPath, image.bytes);
    report.privateBlobUploadSucceeded = true;
    await deps.saveReport(report);
    report.stage = "private_blob_read_back";
    const downloaded = await deps.storage.read(report.privateBlobPath);
    const downloadedMetadata = await sharp(downloaded, { limitInputPixels: 8_294_400 }).metadata();
    if (downloadedMetadata.format !== "png" || !downloaded.equals(image.bytes)) throw new Error("Private read-back content mismatch.");
    await validatePrototypeImage(downloaded, LIVE_IMAGE_SETTINGS.size);
    report.privateBlobReadBackSucceeded = true;
    report.contentIntegrityVerified = true;
    report.status = "succeeded";
    report.stage = "complete";
  } catch {
    report.status = report.paidRequestsAttempted ? "failed" : "blocked";
    report.reason = `Verification stopped during ${report.stage}. No paid retry will be attempted; inspect the receipt before any separately authorized run.`;
  } finally {
    if (uploadAttempted) {
      report.cleanupAttempted = true;
      try {
        // Delete ONLY this invocation's unpredictable path, including after
        // an uncertain upload. No prefix listings or unrelated deletes.
        await deps.storage.remove(report.privateBlobPath);
        report.cleanupAbsenceVerified = await deps.verifyAbsent(report.privateBlobPath);
        report.cleanupSucceeded = report.cleanupAbsenceVerified;
      } catch {
        report.cleanupSucceeded = false;
      }
      if (!report.cleanupSucceeded) {
        report.status = "failed";
        report.reason = "The test image cleanup was not confirmed. Retry cleanup only; do not rerun paid generation.";
      }
    }
    await deps.saveReport(report);
  }
  return report;
}

async function main() {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const env: NodeJS.ProcessEnv = {};
  for (const path of [".env", ".env.local", "apps/web/.env", "apps/web/.env.local", "apps/worker/.env", "apps/worker/.env.local"]) {
    try { Object.assign(env, parseEnv(await readFile(resolve(root, path), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Local environment file could not be read."); }
  }
  Object.assign(env, process.env);
  const missing = ["OPENAI_API_KEY", "BLOB_READ_WRITE_TOKEN"].filter(name => !env[name]?.trim() || env[name]!.includes("...") || env[name]!.includes("YOUR"));
  if (missing.length) throw new LiveConfigurationError(`Missing required credentials: ${missing.join(", ")}.`);
  if (env.OPENAI_PROTOTYPE_IMAGE_MODEL !== IMAGE_MODEL) throw new LiveConfigurationError("Set OPENAI_PROTOTYPE_IMAGE_MODEL=gpt-image-2.5-flare.");
  const pricing = loadImagePricing(env);
  const dir = resolve(root, "temp/m3-live-image-verification");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const preflightOnly = process.argv.includes("--preflight");
  // Existing Blob adapter reads this server-only variable. Never print it.
  process.env.BLOB_READ_WRITE_TOKEN = env.BLOB_READ_WRITE_TOKEN;
  const result = await verifyLiveImage(pricing, { confirmation: env.M3_LIVE_IMAGE_CONFIRM, preflightOnly }, {
    provider: new OpenAIImageProvider(env.OPENAI_API_KEY!, IMAGE_MODEL, 60000),
    storage: privatePrototypeStorage,
    async checkModelAccess() {
      const response = await fetch(`https://api.openai.com/v1/models/${IMAGE_MODEL}`, {
        headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) { await response.body?.cancel(); return { id: null, status: response.status }; }
      const data = await response.json() as { id?: unknown };
      return { id: data.id === IMAGE_MODEL ? IMAGE_MODEL : null, status: response.status };
    },
    async claimAttempt(report) {
      const handle = await open(resolve(dir, "paid-attempt.json"), "wx", 0o600);
      try { await handle.writeFile(JSON.stringify({ runId: report.runId, requestedModel: report.requestedModel, reservationUsd: report.conservativeReservationUsd, paidAttemptAuthorized: true })); await handle.sync(); }
      finally { await handle.close(); }
    },
    async saveReport(report) {
      await writeFile(resolve(dir, `${preflightOnly ? "preflight" : "result"}-${report.runId}.json`), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    },
    async verifyAbsent(path) {
      try { await head(path, { abortSignal: AbortSignal.timeout(15000) }); return false; }
      catch (error) { if (error instanceof BlobNotFoundError) return true; throw new Error("Cleanup absence check failed."); }
    },
    event: event => console.log(JSON.stringify(event)),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "succeeded" && !(preflightOnly && result.stage === "preflight_complete")) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Environment and SDK failures can contain credential-bearing request data.
    // Never print raw errors, causes, response bodies or stacks here.
    console.error(error instanceof LiveConfigurationError ? error.message : "Live image verification stopped before completion. Check required local configuration; no automatic paid retry was attempted.");
    process.exitCode = 1;
  });
}
