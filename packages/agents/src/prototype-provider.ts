import { createHash } from "node:crypto";
import OpenAI, { toFile } from "openai";
import { ProviderError } from "./provider";
import type { ImageSettings } from "./prototype-schema";
import type { ImageUsage } from "./prototype-pricing";
export interface ImageResult {
  base64: string | null; usage: ImageUsage | null;
  requestId: string | null; model: string; durationMs: number;
}
export interface ImageProvider {
  model: string;
  create(prompt: string, settings: ImageSettings, images: Buffer[], ownerId: string): Promise<ImageResult>;
}
export class OpenAIImageProvider implements ImageProvider {
  private client: OpenAI;
  constructor(apiKey: string, public model: string, timeoutMs = 60_000, transport?: typeof fetch) {
    this.client = new OpenAI({ apiKey, maxRetries: 0, timeout: timeoutMs, ...(transport ? { fetch: transport } : {}) });
  }
  async create(prompt: string, settings: ImageSettings, images: Buffer[], ownerId: string): Promise<ImageResult> {
    const start = performance.now();
    try {
      const shared = { model: this.model, prompt, ...settings, n: 1, output_format: "png" as const,
        safety_identifier: createHash("sha256").update(ownerId).digest("hex") };
      const response = images.length
        ? await this.client.images.edit({ ...shared, image: await Promise.all(images.map((image, i) => toFile(image, `reference-${i}.png`, { type: "image/png" }))) })
        : await this.client.images.generate(shared);
      return { base64: response.data?.length === 1 ? response.data[0]?.b64_json ?? null : null,
        usage: response.usage ?? null, requestId: response._request_id ?? null,
        model: this.model, durationMs: Math.round(performance.now() - start) };
    } catch (error) {
      if (error instanceof OpenAI.APIError && error.status && error.status >= 400 && error.status < 500 && ![408, 409].includes(error.status))
        throw new ProviderError(error.status === 401 || error.status === 403 ? "OpenAI image access is unavailable. Check model access and organization verification." : "OpenAI rejected the image request. Check settings or try different feedback.", false, false);
      throw new ProviderError("Image outcome is unknown. Reserved cost is retained. Review provider usage before explicitly trying again.", false, true);
    }
  }
}
