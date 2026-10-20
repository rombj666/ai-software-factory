export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export function storageConfigured() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  return Boolean(token && !token.includes("...") && !token.includes("YOUR"));
}
export function validateReferenceImage(
  bytes: Uint8Array,
  declaredType: string,
): string {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new Error("Choose an image no larger than 4 MiB.");
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every(
    (value, index) => bytes[index] === value,
  );
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  const actual = png
    ? "image/png"
    : jpeg
      ? "image/jpeg"
      : webp
        ? "image/webp"
        : null;
  if (!actual || actual !== declaredType)
    throw new Error(
      "Upload a valid PNG, JPEG or WebP image matching its file type.",
    );
  return actual;
}
/** Cap actual streamed bytes, rather than trusting Content-Length. */
export async function boundedUploadForm(request: Request): Promise<FormData> {
  const limit = MAX_IMAGE_BYTES + 64 * 1024;
  if (Number(request.headers.get("content-length")) > limit)
    throw new Error("Image upload is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Choose an image to upload.");
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error("Image upload is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return new Response(body, {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  }).formData();
}
