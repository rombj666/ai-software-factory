import sharp from "sharp";
import { get, put, del } from "@vercel/blob";
export const MAX_PROTOTYPE_BYTES = 12 * 1024 * 1024;
export interface PrototypeStorage {
  read(path: string): Promise<Buffer>;
  write(path: string, bytes: Buffer): Promise<void>;
  remove(path: string): Promise<void>;
}
export async function validatePrototypeImage(bytes: Buffer, expectedSize?: string) {
  if (!bytes.length || bytes.length > MAX_PROTOTYPE_BYTES) throw new Error("Image exceeds size limit.");
  const decoder = sharp(bytes, { limitInputPixels: 8_294_400, failOn: "warning" });
  const meta = await decoder.metadata();
  if (!["png", "jpeg", "webp"].includes(meta.format ?? "") || !meta.width || !meta.height || (meta.pages ?? 1) > 1)
    throw new Error("Invalid prototype image.");
  if (expectedSize && `${meta.width}x${meta.height}` !== expectedSize) throw new Error("Unexpected image dimensions.");
  // Fully decode, reject corrupt/truncated payloads; normalize without metadata.
  const normalized = await decoder.png().toBuffer();
  if (normalized.length > MAX_PROTOTYPE_BYTES) throw new Error("Decoded image exceeds size limit.");
  return { bytes: normalized, width: meta.width, height: meta.height };
}
export const privatePrototypeStorage: PrototypeStorage = {
  async read(path) {
    const result = await get(path, { access: "private", useCache: false, abortSignal: AbortSignal.timeout(15000) });
    if (!result || result.statusCode !== 200) throw new Error("Private reference image unavailable.");
    const reader = result.stream.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > MAX_PROTOTYPE_BYTES) { await reader.cancel(); throw new Error("Private image exceeds size limit."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks);
  },
  async write(path, bytes) { await put(path, bytes, { access: "private", contentType: "image/png", addRandomSuffix: false, allowOverwrite: false, abortSignal: AbortSignal.timeout(15000) }); },
  async remove(path) { await del(path, { abortSignal: AbortSignal.timeout(15000) }); },
};
