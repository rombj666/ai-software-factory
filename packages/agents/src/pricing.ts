export interface ModelPricing {
  model: string;
  input: number;
  cachedInput: number;
  output: number;
  source: string;
}
// Standard text rates, USD per million tokens. Verified 2026-10-20:
// https://developers.openai.com/api/docs/models/gpt-4.1-mini
const verified = new Set(["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14"]);
export function loadPricing(
  model: string,
  env: NodeJS.ProcessEnv = process.env,
): ModelPricing {
  const names = [
    "OPENAI_INPUT_USD_PER_MILLION",
    "OPENAI_CACHED_INPUT_USD_PER_MILLION",
    "OPENAI_OUTPUT_USD_PER_MILLION",
  ] as const;
  const values = names.map((name) => env[name]);
  if (values.some((value) => value !== undefined)) {
    const rates = values.map(Number);
    if (
      values.some((value) => !value?.trim()) ||
      rates.some((rate) => !Number.isFinite(rate) || rate < 0) ||
      !env.OPENAI_PRICING_SOURCE
    ) {
      throw new Error(
        "Set all three nonnegative model pricing rates and OPENAI_PRICING_SOURCE.",
      );
    }
    if (rates[1]! > rates[0]!)
      throw new Error(
        "Cached input pricing cannot exceed regular input pricing.",
      );
    return {
      model,
      input: rates[0]!,
      cachedInput: rates[1]!,
      output: rates[2]!,
      source: env.OPENAI_PRICING_SOURCE,
    };
  }
  if (!verified.has(model))
    throw new Error(
      "This model needs verified pricing configuration before paid execution.",
    );
  return {
    model,
    input: 0.4,
    cachedInput: 0.1,
    output: 1.6,
    source:
      "https://developers.openai.com/api/docs/models/gpt-4.1-mini (verified 2026-10-20)",
  };
}
export function estimatedUsd(
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  },
  pricing: ModelPricing,
): number {
  for (const value of Object.values(usage))
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Invalid token usage");
  if (usage.cachedInputTokens > usage.inputTokens)
    throw new Error("Invalid cached token usage");
  // Round upward to microdollars to avoid understating budget use.
  return (
    Math.ceil(
      (usage.inputTokens - usage.cachedInputTokens) * pricing.input +
        usage.cachedInputTokens * pricing.cachedInput +
        usage.outputTokens * pricing.output,
    ) / 1_000_000
  );
}
