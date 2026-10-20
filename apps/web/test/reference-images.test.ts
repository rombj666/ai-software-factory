import { describe, expect, it } from "vitest";
import {
  boundedUploadForm,
  MAX_IMAGE_BYTES,
  validateReferenceImage,
} from "../lib/reference-images";

describe("private reference image validation", () => {
  it("checks image signatures, declared types, size and rejects active file formats", () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(validateReferenceImage(png, "image/png")).toBe("image/png");
    expect(
      validateReferenceImage(new Uint8Array([255, 216, 255, 0]), "image/jpeg"),
    ).toBe("image/jpeg");
    expect(
      validateReferenceImage(
        new TextEncoder().encode("RIFF0000WEBP"),
        "image/webp",
      ),
    ).toBe("image/webp");
    expect(() => validateReferenceImage(png, "image/jpeg")).toThrow();
    expect(() =>
      validateReferenceImage(
        new TextEncoder().encode("<svg onload='alert(1)'/>"),
        "image/svg+xml",
      ),
    ).toThrow();
    expect(() =>
      validateReferenceImage(new Uint8Array(MAX_IMAGE_BYTES + 1), "image/png"),
    ).toThrow();
  });
  it("caps streamed bytes even without a Content-Length header", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES + 65537));
        controller.close();
      },
    });
    const request = new Request("http://localhost/upload", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    await expect(boundedUploadForm(request)).rejects.toThrow("too large");
  });
});
