// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mocks = vi.hoisted(() => ({ register: vi.fn(), verify: vi.fn() }));
vi.mock("@/app/actions/auth", () => ({ signUpWithEmail: mocks.register, verifyRegistrationEmail: mocks.verify }));
import { SignUpForm } from "../components/sign-up-form";
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
async function fillForm() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Full Name"), "Ada Lovelace");
  await user.type(screen.getByLabelText("Email Address"), "ada@example.com");
  await user.type(screen.getByLabelText("Password"), "a secure password");
  await user.type(screen.getByLabelText("Confirm Password"), "a secure password");
  return user;
}
describe("Sign Up form (mocked server actions)", () => {
  it("requires all registration fields and applies password constraints", () => {
    render(<SignUpForm />);
    for (const label of ["Full Name", "Email Address", "Password", "Confirm Password"]) expect((screen.getByLabelText(label) as HTMLInputElement).required).toBe(true);
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    expect(password.minLength).toBe(8);
    expect(password.maxLength).toBe(128);
    expect(password.autocomplete).toBe("new-password");
  });
  it("prevents duplicate submissions while registration is pending and displays errors", async () => {
    let finish!: (result: { error: string; message: null; verificationEmail: null }) => void;
    mocks.register.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<SignUpForm />);
    const user = await fillForm();
    await user.click(screen.getByRole("button", { name: "Sign Up" }));
    const pending = screen.getByRole("button", { name: "Creating account..." }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    await user.click(pending);
    expect(mocks.register).toHaveBeenCalledOnce();
    finish({ error: "An account with this email already exists. Please sign in.", message: null, verificationEmail: null });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already exists"));
    expect((screen.getByRole("button", { name: "Sign Up" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("replaces the password form with verification instructions and supports codes", async () => {
    mocks.register.mockResolvedValue({ error: null, message: "Check your email to verify your account.", verificationEmail: "ada@example.com" });
    mocks.verify.mockResolvedValue({ error: "Code expired." });
    render(<SignUpForm />);
    const user = await fillForm();
    await user.click(screen.getByRole("button", { name: "Sign Up" }));
    await screen.findByRole("status");
    expect(screen.queryByLabelText("Password")).toBeNull();
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify email" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Code expired."));
    expect(mocks.verify).toHaveBeenCalledOnce();
  });
});
