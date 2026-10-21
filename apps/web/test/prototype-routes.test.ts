import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ session: vi.fn(), owned: vi.fn(), get: vi.fn(), handoff: vi.fn(), rows: [] as unknown[] }));
vi.mock("@/lib/auth/server", () => ({ getSessionSafe: mock.session }));
vi.mock("@asf/agents/consultation", () => ({ ownedProject: mock.owned }));
vi.mock("@asf/agents/prototype", () => ({ readPrototypeHandoff: mock.handoff }));
vi.mock("@vercel/blob", () => ({ get: mock.get }));
vi.mock("@/lib/db", () => {
  const tx = { select: () => ({ from: () => ({ where: async () => mock.rows }) }) };
  return { db: () => ({ transaction: (action: (transaction: typeof tx) => unknown) => action(tx) }) };
});
import { GET } from "../app/api/projects/[id]/prototypes/[versionId]/route";
import { GET as handoff } from "../app/api/projects/[id]/prototype-handoff/route";
const id = "f33be5e0-3c99-4169-9bb1-d7b44d8c0c16";
const versionId = "04c087c9-043d-4efe-bccc-734ef8b93dc3";
const params = Promise.resolve({ id, versionId });
const request = new Request("https://factory.test");
beforeEach(() => { vi.resetAllMocks(); mock.rows = []; mock.session.mockResolvedValue({ data: { user: { id: "owner" } } }); });
afterEach(() => vi.unstubAllEnvs());
describe("private prototype routes (mocked auth and Blob)", () => {
  it("requires auth before private reads or handoff access", async () => {
    mock.session.mockResolvedValue({ data: null });
    expect((await GET(request, { params })).status).toBe(401);
    expect((await handoff(request, { params })).status).toBe(401);
    expect(mock.get).not.toHaveBeenCalled();
  });
  it("rejects cross-user access before contacting Blob", async () => {
    mock.owned.mockRejectedValue(new Error("not found"));
    expect((await GET(request, { params })).status).toBe(404);
    expect(mock.get).not.toHaveBeenCalled();
  });
  it("rejects malformed version IDs and nonexistent project versions", async () => {
    expect((await GET(request, { params: Promise.resolve({ id, versionId: "not-uuid" }) })).status).toBe(404);
    expect((await GET(request, { params })).status).toBe(404);
    expect(mock.get).not.toHaveBeenCalled();
  });
  it("streams owned images without exposing private locations and disables shared caching", async () => {
    mock.rows = [{ imageStorageUri: "projects/private/prototype.png" }];
    mock.get.mockResolvedValue({ statusCode: 200, stream: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } }) });
    const response = await GET(request, { params });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mock.owned).toHaveBeenCalledWith(expect.anything(), id, "owner");
    expect(mock.get).toHaveBeenCalledWith("projects/private/prototype.png", expect.objectContaining({ access: "private", useCache: false }));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
  it("returns a safe storage error and only exposes an owner-approved handoff", async () => {
    mock.rows = [{ imageStorageUri: "private" }]; mock.get.mockRejectedValue(new Error("secret"));
    const response = await GET(request, { params });
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
    mock.handoff.mockRejectedValue(new Error("unapproved"));
    expect((await handoff(request, { params })).status).toBe(404);
    mock.handoff.mockResolvedValue({ schemaVersion: 1, approvedBy: "owner" });
    const approved = await handoff(request, { params });
    expect(approved.status).toBe(200); expect(approved.headers.get("cache-control")).toBe("private, no-store");
  });
});
