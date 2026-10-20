import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { plannerResponseSchema } from "./schema";

export interface AIRequest {
  instructions: string;
  messages: { role: "user" | "assistant"; content: string }[];
}
export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}
export interface AIResult {
  id: string;
  model: string;
  value: unknown;
  usage: AIUsage;
  durationMs: number;
  outcome: "completed" | "incomplete" | "refused";
}
export interface AIProvider {
  model: string;
  maxOutputTokens: number;
  /** Conservative upper bound: UTF-8 bytes of the full payload plus protocol headroom. */
  inputTokenBound(request: AIRequest): number;
  consult(request: AIRequest): Promise<AIResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
    public uncertain: boolean,
  ) {
    super(message);
  }
}

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  constructor(
    apiKey: string,
    public model = "gpt-4.1-mini-2025-04-14",
    public maxOutputTokens = 2500,
    timeoutMs = 45_000,
    transport?: typeof fetch,
  ) {
    // The persistent job queue owns retries. Never retry a paid call inside the SDK.
    this.client = new OpenAI({
      apiKey,
      maxRetries: 0,
      timeout: timeoutMs,
      ...(transport ? { fetch: transport } : {}),
    });
  }
  private payload(request: AIRequest) {
    return {
      model: this.model,
      instructions: request.instructions,
      input: request.messages,
      max_output_tokens: this.maxOutputTokens,
      store: false,
      text: { format: zodTextFormat(plannerResponseSchema, "consultation") },
    };
  }
  inputTokenBound(request: AIRequest): number {
    return (
      Buffer.byteLength(JSON.stringify(this.payload(request)), "utf8") + 4096
    );
  }
  async consult(request: AIRequest): Promise<AIResult> {
    const started = performance.now();
    try {
      // Parse locally AFTER retaining usage, so invalid/refused/incomplete output
      // still incurs a persisted usage record. No fabricated fallback response.
      const response = await this.client.responses.create(
        this.payload(request),
      );
      const refused = response.output.some(
        (item) =>
          item.type === "message" &&
          item.content.some((part) => part.type === "refusal"),
      );
      let value: unknown = null;
      try {
        value = JSON.parse(response.output_text);
      } catch {
        /* billed invalid output is handled by the Worker */
      }
      if (!response.usage)
        throw new ProviderError(
          "OpenAI returned no usage; the reserved estimate is retained.",
          false,
          true,
        );
      return {
        id: response.id,
        model: response.model,
        value,
        outcome: refused
          ? "refused"
          : response.status === "completed"
            ? "completed"
            : "incomplete",
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cachedInputTokens:
            response.usage.input_tokens_details?.cached_tokens ?? 0,
        },
        durationMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof OpenAI.APIError) {
        if (error.status === 429)
          throw new ProviderError(
            "OpenAI rate limit reached. Retry after the queued backoff.",
            true,
            false,
          );
        if (error.status === 401 || error.status === 403)
          throw new ProviderError(
            "OpenAI access is not configured correctly. Ask the operator to check the Worker API key.",
            false,
            false,
          );
        if (
          error.status &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408
        ) {
          throw new ProviderError(
            "OpenAI rejected this request. Check the configured model and request limits.",
            false,
            false,
          );
        }
      }
      // Timeouts/connection failures/5xx may have completed remotely. Keep the
      // reservation and require explicit user retry rather than duplicate billing.
      throw new ProviderError(
        "OpenAI did not confirm a result. The request may have incurred cost; review usage before retrying.",
        false,
        true,
      );
    }
  }
}
