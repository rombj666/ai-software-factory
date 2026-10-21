import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => ({ get: mocks.get, put: mocks.put, del: mocks.del }));
import { privatePrototypeStorage, MAX_PROTOTYPE_BYTES } from "../src/prototype-storage";
beforeEach(() => vi.resetAllMocks());
describe("prototype Private Blob adapter (mocked Blob SDK)", () => {
  it("writes immutable private images and removes only the supplied cleanup path", async () => {
    const bytes = Buffer.from("png");
    await privatePrototypeStorage.write("projects/test/prototypes/image.png", bytes);
    expect(mocks.put).toHaveBeenCalledWith("projects/test/prototypes/image.png", bytes, expect.objectContaining({ access: "private", contentType: "image/png", addRandomSuffix: false, allowOverwrite: false }));
    await privatePrototypeStorage.remove("projects/test/prototypes/image.png");
    expect(mocks.del).toHaveBeenCalledWith("projects/test/prototypes/image.png", expect.objectContaining({ abortSignal: expect.any(AbortSignal) }));
  });
  it("reads privately with a streamed size cap", async () => {
    mocks.get.mockResolvedValue({ statusCode: 200, stream: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } }) });
    expect(await privatePrototypeStorage.read("path")).toEqual(Buffer.from([1, 2, 3]));
    mocks.get.mockResolvedValue({ statusCode: 200, stream: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_PROTOTYPE_BYTES + 1)); controller.close(); } }) });
    await expect(privatePrototypeStorage.read("path")).rejects.toThrow("size limit");
  });
});
