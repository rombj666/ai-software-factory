import { createHash } from "node:crypto";
import type { ImageSettings } from "./prototype-schema";
export const IMAGE_MODEL = "gpt-image-2.5-flare";
export const IMAGE_PRICING_SOURCE = "https://developers.openai.com/api/docs/models/gpt-image-2.5-flare";
export const CALCULATOR_SOURCE = "https://developers.openai.com/api/docs/guides/image-generation";
export interface ImagePricing {
  model: string; textInput: number; imageInput: number; imageOutput: number;
  source: string; verifiedAt: string;
  editInputTokenBound: number | null; editBoundSource: string | null;
  outputEstimatorSource: string; outputReservationMargin: string;
}
export function loadImagePricing(env: NodeJS.ProcessEnv = process.env): ImagePricing {
  const model = env.OPENAI_PROTOTYPE_IMAGE_MODEL || IMAGE_MODEL;
  if (![IMAGE_MODEL, `${IMAGE_MODEL}-2026-09-08`].includes(model)) throw new Error("Unverified prototype image model.");
  const names = ["OPENAI_IMAGE_TEXT_INPUT_USD_PER_MILLION", "OPENAI_IMAGE_INPUT_USD_PER_MILLION", "OPENAI_IMAGE_OUTPUT_USD_PER_MILLION"];
  const custom = names.some(n => env[n] !== undefined);
  const rates = custom ? names.map(n => Number(env[n])) : [5, 8, 30];
  if (rates.some(n => !Number.isFinite(n) || n <= 0) || (custom && (!env.OPENAI_IMAGE_PRICING_SOURCE || names.some(n => !env[n]?.trim()))))
    throw new Error("Complete verified image pricing is required.");
  const bound = env.OPENAI_IMAGE_EDIT_INPUT_TOKEN_BOUND ? Number(env.OPENAI_IMAGE_EDIT_INPUT_TOKEN_BOUND) : null;
  if (bound !== null && (!Number.isSafeInteger(bound) || bound < 1 || !env.OPENAI_IMAGE_EDIT_BOUND_SOURCE)) throw new Error("A verified edit input bound and its source are required.");
  return { model, textInput: rates[0]!, imageInput: rates[1]!, imageOutput: rates[2]!,
    source: custom ? env.OPENAI_IMAGE_PRICING_SOURCE! : IMAGE_PRICING_SOURCE,
    verifiedAt: "2026-10-21", editInputTokenBound: bound, editBoundSource: env.OPENAI_IMAGE_EDIT_BOUND_SOURCE ?? null,
    outputEstimatorSource: CALCULATOR_SOURCE, outputReservationMargin: "2x published calculator output tokens plus 1024 tokens; text UTF-8 bytes plus 4096" };
}
export function usd(amount: number) { return Math.ceil(amount * 1e6) / 1e6; }
/** Formula verified against OpenAI's published calculator, with 2x output +
 * 1024 tokens of headroom. Explicit settings only; no auto/partial images. */
export function imageOutputEstimate(settings: ImageSettings) {
  const [w, h] = settings.size.split("x").map(Number) as [number, number];
  const long = { low: 16, medium: 24, high: 48 }[settings.quality];
  const short = long / (Math.max(w, h) / Math.min(w, h));
  const floor = Math.floor(short);
  const rounded = short - floor === 0.5 ? floor + floor % 2 : Math.round(short);
  return Math.ceil(long * rounded * (2e6 + w * h) / 4e6);
}
export function imageReservation(prompt: string, settings: ImageSettings, imageCount: number, pricing: ImagePricing) {
  if (imageCount && pricing.editInputTokenBound === null)
    throw new Error("Image editing needs a verified input-token bound. No paid request was made.");
  const textTokens = Buffer.byteLength(prompt, "utf8") + 4096;
  if (textTokens > 36000) throw new Error("Prototype prompt exceeds the safe input limit.");
  return usd((textTokens * pricing.textInput + (imageOutputEstimate(settings) * 2 + 1024) * pricing.imageOutput + imageCount * (pricing.editInputTokenBound ?? 0) * pricing.imageInput) / 1e6);
}
export interface ImageUsage { input_tokens: number; output_tokens: number; total_tokens: number; input_tokens_details: { text_tokens: number; image_tokens: number } }
export function imageCost(usage: ImageUsage, pricing: ImagePricing) {
  const { text_tokens, image_tokens } = usage.input_tokens_details;
  if (![usage.input_tokens, usage.output_tokens, usage.total_tokens, text_tokens, image_tokens].every(n => Number.isSafeInteger(n) && n >= 0) || text_tokens + image_tokens !== usage.input_tokens || usage.input_tokens + usage.output_tokens !== usage.total_tokens)
    throw new Error("Invalid image usage.");
  return usd((text_tokens * pricing.textInput + image_tokens * pricing.imageInput + usage.output_tokens * pricing.imageOutput) / 1e6);
}
export function fingerprint(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
