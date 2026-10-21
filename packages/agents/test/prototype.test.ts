import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { approvedRequirements, validateDesign, validateDesignTraceability } from "../src/prototype-schema";
import { fingerprint, imageCost, imageOutputEstimate, imageReservation, loadImagePricing } from "../src/prototype-pricing";
import { OpenAIImageProvider } from "../src/prototype-provider";
import { validatePrototypeImage } from "../src/prototype-storage";
import { design } from "./prototype-fixtures";
import { summary } from "./fixtures";
const settings = { quality: "low" as const, size: "1536x1024" as const };
describe("prototype specification and paid-request bounds", () => {
  it("requires completed consultation and no unresolved questions", () => {
    expect(() => approvedRequirements(null)).toThrow();
    expect(() => approvedRequirements({ consultation: { status: "completed", summary: { ...summary, openQuestions: ["Unknown"] } } })).toThrow();
    expect(approvedRequirements({ consultation: { status: "completed", revision: 7, summary } }).revision).toBe(7);
  });
  it("validates product-specific screen lists and navigation", () => {
    expect(validateDesign(design).screens).toHaveLength(1);
    expect(() => validateDesign({ ...design, screens: [] })).toThrow();
    expect(() => validateDesign({ ...design, screens: [design.screens[0], design.screens[0]] })).toThrow();
    expect(() => validateDesign({ ...design, screens: [{ ...design.screens[0], navigationTo: ["missing"] }] })).toThrow();
    expect(() => validateDesignTraceability({ ...design, screens: [{ ...design.screens[0]!, requirementReferences: ["Unapproved payments feature"] }] }, summary)).toThrow();
  });
  it("uses Flare official rates and explicit quality calculator values", () => {
    const pricing = loadImagePricing({});
    expect([pricing.textInput, pricing.imageInput, pricing.imageOutput]).toEqual([5, 8, 30]);
    expect(imageOutputEstimate({ quality: "low", size: "1024x1024" })).toBe(196);
    expect(imageOutputEstimate({ quality: "high", size: "1024x1024" })).toBe(1756);
    expect(imageReservation("A simple screen", settings, 0, pricing)).toBeLessThan(0.15);
    expect(() => imageReservation("Edit", settings, 1, pricing)).toThrow("verified input-token bound");
    expect(() => loadImagePricing({ OPENAI_PROTOTYPE_IMAGE_MODEL: "unverified" })).toThrow();
    expect(() => loadImagePricing({ OPENAI_IMAGE_TEXT_INPUT_USD_PER_MILLION: "" })).toThrow();
  });
  it("accounts separately for image input, text input and output without invented counts", () => {
    expect(imageCost({ input_tokens: 300, output_tokens: 200, total_tokens: 500, input_tokens_details: { text_tokens: 100, image_tokens: 200 } }, loadImagePricing({}))).toBe(0.0081);
    expect(() => imageCost({ input_tokens: 300, output_tokens: -1, total_tokens: 299, input_tokens_details: { text_tokens: 100, image_tokens: 200 } }, loadImagePricing({}))).toThrow();
    expect(fingerprint({ feedback: "a" })).not.toBe(fingerprint({ feedback: "b" }));
  });
  it("fully decodes images and rejects corrupt content and unexpected dimensions", async () => {
    const png = await sharp({ create: { width: 32, height: 24, channels: 3, background: "white" } }).png().toBuffer();
    expect((await validatePrototypeImage(png, "32x24")).width).toBe(32);
    await expect(validatePrototypeImage(png, "24x32")).rejects.toThrow();
    await expect(validatePrototypeImage(png.subarray(0, 30))).rejects.toThrow();
    await expect(validatePrototypeImage(Buffer.from("not an image"))).rejects.toThrow();
  });
});
describe("official OpenAI image SDK integration (mocked HTTP, no paid requests)", () => {
  it("calls generations for one selected screen and retains reported usage", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: "aW1hZ2U=" }], usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3, input_tokens_details: { text_tokens: 1, image_tokens: 0 } } }, { headers: { "x-request-id": "req_test" } }));
    const provider = new OpenAIImageProvider("test-key", "gpt-image-2.5-flare", 1000, transport);
    const result = await provider.create("Reading list screen", settings, [], "private-user-id");
    const [url, init] = transport.mock.calls[0]!;
    expect(String(url)).toContain("/images/generations");
    expect(JSON.parse(init.body)).toMatchObject({ model: "gpt-image-2.5-flare", n: 1, size: "1536x1024", quality: "low", output_format: "png" });
    expect(init.body).not.toContain("private-user-id");
    expect(result.usage?.output_tokens).toBe(2);
  });
  it("uses the edits endpoint with source bytes rather than fetching arbitrary URLs", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }));
    Object.assign(transport, { Response });
    const provider = new OpenAIImageProvider("test-key", "gpt-image-2.5-flare", 1000, transport);
    await provider.create("Make the table minimal", settings, [Buffer.from("image")], "owner");
    expect(String(transport.mock.calls[0]![0])).toContain("/images/edits");
    expect(transport.mock.calls[0]![1].body).toBeInstanceOf(FormData);
  });
  it("does not retry account rejection or uncertain transport failures", async () => {
    const denied = vi.fn().mockResolvedValue(Response.json({ error: { message: "private details" } }, { status: 403 }));
    await expect(new OpenAIImageProvider("test", "gpt-image-2.5-flare", 1000, denied).create("x", settings, [], "owner")).rejects.toMatchObject({ uncertain: false });
    expect(denied).toHaveBeenCalledOnce();
    const failed = vi.fn().mockRejectedValue(new Error("connection lost"));
    await expect(new OpenAIImageProvider("test", "gpt-image-2.5-flare", 1000, failed).create("x", settings, [], "owner")).rejects.toMatchObject({ uncertain: true });
    expect(failed).toHaveBeenCalledOnce();
  });
});
