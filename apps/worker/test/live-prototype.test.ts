import { beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { loadImagePricing } from "@asf/agents/prototype-pricing";
import { ProviderError } from "@asf/agents/provider";
import { verifyLiveImage, LIVE_IMAGE_CONFIRMATION, type LiveImageDependencies } from "../src/scripts/test-live-prototype";
let png: Buffer;
beforeAll(async () => { png = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: "white" } }).png().toBuffer(); });
function fixture() {
  const objects = new Map<string, Buffer>([["unrelated-customer-object", Buffer.from("keep")]]);
  const provider = { model: "gpt-image-2.5-flare", create: vi.fn().mockImplementation(async () => ({ model: "gpt-image-2.5-flare", base64: png.toString("base64"), requestId: "req_mock", durationMs: 1, usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300, input_tokens_details: { text_tokens: 100, image_tokens: 0 } } })) };
  const deps: LiveImageDependencies = {
    provider,
    storage: {
      read: vi.fn().mockImplementation(async path => objects.get(path)!),
      write: vi.fn().mockImplementation(async (path, bytes) => { objects.set(path, bytes); }),
      remove: vi.fn().mockImplementation(async path => { objects.delete(path); }),
    },
    checkModelAccess: vi.fn().mockResolvedValue({ id: provider.model, status: 200 }),
    claimAttempt: vi.fn().mockResolvedValue(undefined), saveReport: vi.fn().mockResolvedValue(undefined),
    verifyAbsent: vi.fn().mockImplementation(async path => !objects.has(path)),
  };
  return { deps, provider, objects };
}
const options = { confirmation: LIVE_IMAGE_CONFIRMATION, runId: "unit-test-only" };
describe("opt-in live image verifier safety (mocked OpenAI and Blob)", () => {
  it("makes one generation request, checks real PNG dimensions/content and deletes only its object", async () => {
    const { deps, provider, objects } = fixture();
    const result = await verifyLiveImage(loadImagePricing({}), options, deps);
    expect(result.status).toBe("succeeded"); expect(provider.create).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ paidRequestsAttempted: 1, generationSucceeded: true, quality: "low", actualImageDimensions: { width: 1536, height: 1024 }, estimatedUsdFromReportedUsage: 0.0065, privateBlobUploadSucceeded: true, privateBlobReadBackSucceeded: true, contentIntegrityVerified: true, cleanupSucceeded: true, cleanupAbsenceVerified: true, authenticatedHttpRetrievalVerified: false });
    expect(deps.storage.remove).toHaveBeenCalledWith("verification/m3/unit-test-only/inventory-dashboard.png");
    expect(objects.size).toBe(1); expect(objects.has("unrelated-customer-object")).toBe(true);
  });
  it("stops before model access or generation when reservation exceeds $0.15", async () => {
    const { deps, provider } = fixture();
    const result = await verifyLiveImage({ ...loadImagePricing({}), imageOutput: 10000 }, options, deps);
    expect(result.status).toBe("blocked"); expect(deps.checkModelAccess).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
  });
  it("requires explicit opt-in and supports an unpaid model-access preflight", async () => {
    const { deps, provider } = fixture();
    expect((await verifyLiveImage(loadImagePricing({}), {}, deps)).status).toBe("blocked");
    const result = await verifyLiveImage(loadImagePricing({}), { preflightOnly: true }, deps);
    expect(result.stage).toBe("preflight_complete"); expect(result.modelAccessVerified).toBe(true);
    expect(provider.create).not.toHaveBeenCalled(); expect(deps.claimAttempt).not.toHaveBeenCalled();
  });
  it("stops on access errors or an existing durable attempt receipt", async () => {
    const { deps, provider } = fixture();
    vi.mocked(deps.checkModelAccess).mockResolvedValueOnce({ id: null, status: 403 });
    expect((await verifyLiveImage(loadImagePricing({}), options, deps)).status).toBe("blocked");
    vi.mocked(deps.claimAttempt).mockRejectedValueOnce(new Error("already exists"));
    expect((await verifyLiveImage(loadImagePricing({}), options, deps)).status).toBe("blocked");
    expect(provider.create).not.toHaveBeenCalled();
  });
  it("never retries an uncertain paid request or touches storage after generation failure", async () => {
    const { deps, provider } = fixture();
    provider.create.mockRejectedValue(new ProviderError("sensitive provider details", false, true));
    const result = await verifyLiveImage(loadImagePricing({}), options, deps);
    expect(result.status).toBe("failed"); expect(result.paidRequestsAttempted).toBe(1);
    expect(provider.create).toHaveBeenCalledOnce(); expect(deps.storage.write).not.toHaveBeenCalled(); expect(deps.storage.remove).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("sensitive provider details");
  });
  it("cleans its path after an uncertain upload and fails a content-integrity mismatch", async () => {
    const { deps, objects } = fixture();
    vi.mocked(deps.storage.write).mockImplementationOnce(async (path, bytes) => { objects.set(path, bytes); throw new Error("upload response lost"); });
    const failed = await verifyLiveImage(loadImagePricing({}), options, deps);
    expect(failed.status).toBe("failed"); expect(failed.cleanupAbsenceVerified).toBe(true); expect(objects.size).toBe(1);
    vi.mocked(deps.storage.read).mockResolvedValueOnce(Buffer.from("bad content"));
    const mismatch = await verifyLiveImage(loadImagePricing({}), options, deps);
    expect(mismatch.status).toBe("failed"); expect(mismatch.contentIntegrityVerified).toBe(false); expect(mismatch.cleanupAbsenceVerified).toBe(true);
  });
  it("does not fabricate absent usage or claim cleanup when deletion fails", async () => {
    const { deps, provider } = fixture();
    provider.create.mockResolvedValue({ model: provider.model, base64: png.toString("base64"), usage: null, requestId: null, durationMs: 1 });
    vi.mocked(deps.storage.remove).mockRejectedValueOnce(new Error("secret storage diagnostic"));
    const result = await verifyLiveImage(loadImagePricing({}), options, deps);
    expect(result.apiReportedUsage).toBeNull(); expect(result.estimatedUsdFromReportedUsage).toBeNull();
    expect(result.status).toBe("failed"); expect(result.cleanupSucceeded).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret storage diagnostic");
  });
});
