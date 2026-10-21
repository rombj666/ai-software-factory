import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  session: vi.fn(),
  owned: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  selectRows: [] as unknown[],
  insert: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({ getSessionSafe: mock.session }));
vi.mock("@asf/agents/consultation", () => ({ ownedProject: mock.owned }));
vi.mock("@vercel/blob", () => ({
  put: mock.put,
  get: mock.get,
  del: mock.del,
}));
vi.mock("@/lib/db", () => {
  const tx = {
    select: () => ({ from: () => ({ where: async () => mock.selectRows }) }),
    insert: () => ({ values: mock.insert }),
  };
  return {
    db: () => ({
      transaction: (action: (transaction: typeof tx) => unknown) => action(tx),
    }),
  };
});
import { POST } from "../app/api/projects/[id]/assets/route";
import { GET } from "../app/api/projects/[id]/assets/[assetId]/route";
const id = "f33be5e0-3c99-4169-9bb1-d7b44d8c0c16";
const assetId = "04c087c9-043d-4efe-bccc-734ef8b93dc3";
const params = Promise.resolve({ id, assetId });
function upload(type = "image/png") {
  const form = new FormData();
  form.set(
    "file",
    new File(
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
      "reference.png",
      { type },
    ),
  );
  return new Request(`https://factory.test/api/projects/${id}/assets`, {
    method: "POST",
    body: form,
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-private-store");
  mock.selectRows = [];
  mock.session.mockResolvedValue({ data: { user: { id: "owner" } } });
  mock.owned.mockResolvedValue({ status: "consultation" });
});
afterEach(() => vi.unstubAllEnvs());
describe("private image route boundaries (mocked storage and session)", () => {
  it("requires authentication before upload or image access", async () => {
    mock.session.mockResolvedValue({ data: null });
    expect((await POST(upload(), { params })).status).toBe(401);
    expect(
      (await GET(new Request("https://factory.test"), { params })).status,
    ).toBe(401);
    expect(mock.put).not.toHaveBeenCalled();
    expect(mock.get).not.toHaveBeenCalled();
  });
  it("checks ownership for both upload and reads before calling storage", async () => {
    mock.owned.mockRejectedValue(new Error("Project not found"));
    expect((await POST(upload(), { params })).status).toBe(404);
    expect(
      (await GET(new Request("https://factory.test"), { params })).status,
    ).toBe(404);
    expect(mock.owned).toHaveBeenCalledWith(expect.anything(), id, "owner");
    expect(mock.put).not.toHaveBeenCalled();
    expect(mock.get).not.toHaveBeenCalled();
  });
  it("rejects cross-origin upload requests", async () => {
    const request = upload();
    request.headers.set("origin", "https://other.test");
    expect((await POST(request, { params })).status).toBe(403);
    expect(mock.put).not.toHaveBeenCalled();
  });
  it("rejects mismatched MIME types and reports unavailable storage", async () => {
    expect((await POST(upload("image/jpeg"), { params })).status).toBe(400);
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect((await POST(upload(), { params })).status).toBe(503);
    expect(mock.put).not.toHaveBeenCalled();
  });
  it("uploads privately, persists metadata and never returns a storage credential or URL", async () => {
    mock.put.mockResolvedValue({
      pathname: "ignored",
      url: "private-storage-url",
    });
    const response = await POST(upload(), { params });
    expect(response.status).toBe(201);
    expect(mock.put).toHaveBeenCalledWith(
      expect.stringContaining(`projects/${id}/references/`),
      expect.anything(),
      expect.objectContaining({ access: "private", allowOverwrite: false }),
    );
    expect(mock.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: id,
        mimeType: "image/png",
        filename: "reference.png",
      }),
    );
    const body = await response.text();
    expect(body).not.toContain("private-storage-url");
    expect(body).not.toContain("test-private-store");
  });
  it("serves owned private images through a no-store authenticated proxy", async () => {
    mock.selectRows = [
      {
        id: assetId,
        projectId: id,
        storageUri: `projects/${id}/references/${assetId}`,
        mimeType: "image/png",
      },
    ];
    mock.get.mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
    });
    const response = await GET(new Request("https://factory.test"), { params });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mock.get).toHaveBeenCalledWith(expect.any(String), {
      access: "private",
      useCache: false,
    });
  });
  it("cleans up only the just-uploaded blob if metadata persistence fails", async () => {
    mock.insert.mockRejectedValue(new Error("database down"));
    expect((await POST(upload(), { params })).status).toBe(503);
    expect(mock.del).toHaveBeenCalledWith(mock.put.mock.calls[0]![0]);
  });
});
