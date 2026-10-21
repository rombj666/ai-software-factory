// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PrototypeView } from "@asf/agents/prototype";
import { design } from "../../../packages/agents/test/prototype-fixtures";
import { summary } from "../../../packages/agents/test/fixtures";
import { prototypeState } from "@asf/agents/prototype-schema";
const mocks = vi.hoisted(() => ({ estimate: vi.fn(), request: vi.fn(), read: vi.fn(), save: vi.fn(), approve: vi.fn(), final: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/actions/prototype", () => ({ estimatePrototype: mocks.estimate, requestPrototype: mocks.request, getPrototype: mocks.read, updateDesignPlan: mocks.save, approveScreen: mocks.approve, approveFinalPrototype: mocks.final }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { PrototypeWorkspace } from "../components/prototype-workspace";
function view(): PrototypeView {
  return { projectId: "0f8f5696-ae58-4158-8673-a35af257ba74", title: "Reading room", projectStatus: "prototype_pending", requirements: summary,
    state: { ...prototypeState(null), design, planRevision: 1, acceptedPlanRevision: 1, status: "review" },
    versions: [], references: [], budget: { spentUsd: 0.1, reservedUsd: 0, limitUsd: 20 } };
}
beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);
describe("Prototype Workspace (mocked server actions; no live generation)", () => {
  it("requires an estimate and explicit confirmation before a paid request", async () => {
    mocks.estimate.mockResolvedValue({ data: { model: "gpt-image-2.5-flare", reservationUsd: 0.08, quoteHash: "a".repeat(64) }, error: null });
    let finish!: (value: unknown) => void;
    mocks.request.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<PrototypeWorkspace initial={view()} uploadsEnabled />);
    const user = userEvent.setup();
    expect(mocks.estimate).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Estimate this screen" }));
    expect(mocks.request).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog").textContent).toContain("$0.0800");
    await user.click(screen.getByRole("button", { name: "Confirm paid request" }));
    const pending = screen.getByRole("button", { name: "Confirm paid request" }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true); await user.click(pending);
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.request.mock.calls[0]![1]).toMatchObject({ mode: "generate", confirmed: true, screenId: "reading-list", settings: { quality: "low", size: "1536x1024" } });
    finish({ data: view(), error: null });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("supports screen list edits before accepting the design", async () => {
    mocks.save.mockResolvedValue({ data: view(), error: null });
    render(<PrototypeWorkspace initial={view()} uploadsEnabled />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add screen" }));
    await user.click(screen.getByRole("button", { name: "Accept design plan" }));
    expect(mocks.save.mock.calls[0]![2].screens).toHaveLength(2);
    expect(mocks.save.mock.calls[0]![3]).toBe(true);
  });
  it("keeps final approval disabled until each screen has an approved current version", () => {
    render(<PrototypeWorkspace initial={view()} uploadsEnabled />);
    expect((screen.getByRole("button", { name: "Approve final prototype" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Approve screen" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("shows version history and supports final approval after screen review", async () => {
    const initial = view();
    initial.versions = [{ id: "version-1", screenId: "reading-list", version: 1, planRevision: 1, feedback: "", model: "gpt-image-2.5-flare", quality: "low", size: "1536x1024", costUsd: 0.01, costBasis: "estimated_from_reported_tokens", createdAt: "2026-10-21T00:00:00Z", imagePath: "/api/private-image" }];
    initial.state.approvals = { "reading-list": "version-1" };
    mocks.final.mockResolvedValue({ data: { ...initial, projectStatus: "prototype_approved" }, error: null });
    render(<PrototypeWorkspace initial={initial} uploadsEnabled />);
    expect(screen.getByAltText("Reading list version 1").getAttribute("src")).toBe("/api/private-image");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Approve final prototype" }));
    expect(mocks.final).toHaveBeenCalledOnce();
    await screen.findByRole("link", { name: "View approved design handoff" });
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
