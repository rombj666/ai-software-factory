// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ConsultationView } from "@asf/agents/consultation";
import { summary } from "../../../packages/agents/test/fixtures";
const actions = vi.hoisted(() => ({
  send: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  complete: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/app/actions/consultation", () => ({
  sendConsultation: actions.send,
  getConsultation: actions.read,
  saveRequirements: actions.save,
  completeConsultation: actions.complete,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: actions.refresh }),
}));
import { ConsultationWorkspace } from "../components/consultation-workspace";
function view(
  overrides: Partial<ConsultationView["state"]> = {},
): ConsultationView {
  return {
    projectId: "f33be5e0-3c99-4169-9bb1-d7b44d8c0c16",
    projectStatus: "consultation",
    state: {
      revision: 1,
      status: "collecting",
      activeJobId: null,
      summary: null,
      readyToComplete: false,
      error: null,
      ...overrides,
    },
    messages: [
      {
        id: "user-1",
        role: "user",
        content: "My book club",
        createdAt: new Date().toISOString(),
      },
      {
        id: "ai-1",
        role: "assistant",
        content: "Who can add books?",
        createdAt: new Date().toISOString(),
      },
    ],
    budget: { spentUsd: 0.001, reservedUsd: 0, limitUsd: 20 },
    assets: [],
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);
describe("consultation workspace interactions (mocked actions)", () => {
  it("shows history, sends a user answer and disables sending while the job is queued", async () => {
    const user = userEvent.setup();
    const initial = view();
    actions.send.mockResolvedValue({
      data: view({ status: "queued", revision: 2, activeJobId: "job-2" }),
      error: null,
    });
    render(<ConsultationWorkspace initial={initial} uploadsEnabled={false} />);
    expect(screen.getByText("Who can add books?")).toBeTruthy();
    await user.type(
      screen.getByLabelText("Your answer or correction"),
      "The organizer",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(actions.send).toHaveBeenCalledWith(
      initial.projectId,
      expect.objectContaining({
        content: "The organizer",
        expectedRevision: 1,
        mode: "message",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/Queued — waiting/)).toBeTruthy(),
    );
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Confirm & finish consultation" }),
    ).toBeNull();
  });
  it("preserves an idempotency key when an uncertain send is retried", async () => {
    const user = userEvent.setup();
    actions.send.mockRejectedValue(new Error("network"));
    render(<ConsultationWorkspace initial={view()} uploadsEnabled={false} />);
    await user.type(
      screen.getByLabelText("Your answer or correction"),
      "Organizer",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(actions.send.mock.calls[0]![1].requestId).toBe(
      actions.send.mock.calls[1]![1].requestId,
    );
  });
  it("requires saved summary corrections before explicit completion and supports multiline lists", async () => {
    const user = userEvent.setup();
    const initial = view({ status: "ready", summary, readyToComplete: true });
    actions.save.mockResolvedValue({
      data: view({
        status: "ready",
        summary: {
          ...summary,
          requiredFunctionality: ["Search", "Borrow", "Return"],
        },
        readyToComplete: true,
        revision: 2,
      }),
      error: null,
    });
    actions.complete.mockResolvedValue({
      data: {
        ...view({
          status: "completed",
          summary,
          readyToComplete: true,
          revision: 3,
        }),
        projectStatus: "prototype_pending",
      },
      error: null,
    });
    render(<ConsultationWorkspace initial={initial} uploadsEnabled={false} />);
    const features = screen.getByLabelText("Required functionality");
    await user.clear(features);
    await user.type(features, "Search{Enter}Borrow{Enter}Return");
    expect(
      (
        screen.getByRole("button", {
          name: "Confirm & finish consultation",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(
      screen.getByRole("button", { name: "Save summary corrections" }),
    );
    expect(actions.save).toHaveBeenCalledWith(
      initial.projectId,
      1,
      expect.objectContaining({
        requiredFunctionality: ["Search", "Borrow", "Return"],
      }),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Confirm & finish consultation",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    await user.click(
      screen.getByRole("button", { name: "Confirm & finish consultation" }),
    );
    expect(actions.complete).toHaveBeenCalledWith(initial.projectId, 2);
    await screen.findByText(/Consultation complete/);
  });
  it("offers retry after failure and reports missing private storage honestly", async () => {
    const user = userEvent.setup();
    const initial = view({ status: "failed", error: "Rate limit reached" });
    actions.send.mockResolvedValue({
      data: view({ status: "queued", revision: 2, activeJobId: "retry-job" }),
      error: null,
    });
    render(<ConsultationWorkspace initial={initial} uploadsEnabled={false} />);
    expect(
      screen.getByText(/Uploads require a configured private Blob store/),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Upload reference image")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry Planner" }));
    expect(actions.send).toHaveBeenCalledWith(
      initial.projectId,
      expect.objectContaining({ mode: "retry", expectedRevision: 1 }),
    );
  });
});
