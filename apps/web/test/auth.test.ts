import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(), register: vi.fn(), verify: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), redirect: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({
  isAuthConfigured: mocks.configured,
  getAuth: () => ({ signUp: { email: mocks.register }, emailOtp: { verifyEmail: mocks.verify }, signIn: { email: mocks.signIn }, signOut: mocks.signOut }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import { signUpWithEmail, verifyRegistrationEmail, signInWithEmail, signOutAction } from "../app/actions/auth";

const initial = { error: null, message: null, verificationEmail: null };
function registration(overrides: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: " Ada Lovelace ", email: " ada@example.com ", password: "a secure password", confirmPassword: "a secure password", ...overrides })) form.set(key, value);
  return form;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.redirect.mockImplementation((url) => { throw new Error(`REDIRECT:${url}`); });
});
describe("registration server actions (mocked Neon SDK; no live registration)", () => {
  it.each([
    { name: " " }, { email: "invalid" }, { email: "" }, { password: "short", confirmPassword: "short" },
    { password: "x".repeat(129), confirmPassword: "x".repeat(129) }, { confirmPassword: "different" }, { confirmPassword: "" }, { name: "x".repeat(201) },
  ] as Record<string, string>[])("rejects invalid input before calling Neon: %j", async (overrides) => {
    expect((await signUpWithEmail(initial, registration(overrides))).error).toBeTruthy();
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it("rejects missing fields", async () => {
    expect((await signUpWithEmail(initial, new FormData())).error).toBeTruthy();
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it("handles missing configuration without contacting Neon", async () => {
    mocks.configured.mockReturnValue(false);
    expect((await signUpWithEmail(initial, registration())).error).toContain("unavailable");
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it("uses supported SDK registration, trims identity fields and redirects an issued session", async () => {
    mocks.register.mockResolvedValue({ data: { token: "provider-session", user: { emailVerified: false } }, error: null });
    await expect(signUpWithEmail(initial, registration())).rejects.toThrow("REDIRECT:/dashboard");
    expect(mocks.register).toHaveBeenCalledWith({ name: "Ada Lovelace", email: "ada@example.com", password: "a secure password", callbackURL: "/auth/sign-in" });
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it("prompts for verification without signing in when no session is issued", async () => {
    mocks.register.mockResolvedValue({ data: { token: null, user: { emailVerified: false } }, error: null });
    const state = await signUpWithEmail(initial, registration());
    expect(state.verificationEmail).toBe("ada@example.com");
    expect(state.message).toContain("verification");
    expect(JSON.stringify(state)).not.toContain("secure password");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it("offers sign in for a verified account when auto-login is disabled", async () => {
    mocks.register.mockResolvedValue({ data: { token: null, user: { emailVerified: true } }, error: null });
    const state = await signUpWithEmail(initial, registration());
    expect(state.verificationEmail).toBeNull();
    expect(state.message).toContain("sign in");
  });
  it.each(["USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"])("handles duplicate email: %s", async (code) => {
    mocks.register.mockResolvedValue({ error: { code, message: "private provider details" } });
    expect((await signUpWithEmail(initial, registration())).error).toContain("already exists");
  });
  it("does not expose unexpected provider errors", async () => {
    mocks.register.mockResolvedValue({ error: { code: "INTERNAL_ERROR", message: "secret-token" } });
    expect(JSON.stringify(await signUpWithEmail(initial, registration()))).not.toContain("secret-token");
    mocks.register.mockRejectedValue(new Error("secret-token"));
    expect(JSON.stringify(await signUpWithEmail(initial, registration()))).not.toContain("secret-token");
  });
  it("does not report success on an empty provider response", async () => {
    mocks.register.mockResolvedValue({ data: null, error: null });
    expect((await signUpWithEmail(initial, registration())).error).toBeTruthy();
  });
  it("verifies codes through Neon and redirects to sign in", async () => {
    const form = new FormData(); form.set("email", "ada@example.com"); form.set("otp", "123456");
    mocks.verify.mockResolvedValue({ error: null });
    await expect(verifyRegistrationEmail({ error: null }, form)).rejects.toThrow("REDIRECT:/auth/sign-in");
    expect(mocks.verify).toHaveBeenCalledWith({ email: "ada@example.com", otp: "123456" });
  });
  it("handles malformed and expired verification codes", async () => {
    const form = new FormData(); form.set("email", "ada@example.com"); form.set("otp", "bad");
    expect((await verifyRegistrationEmail({ error: null }, form)).error).toBeTruthy();
    expect(mocks.verify).not.toHaveBeenCalled();
    form.set("otp", "123456"); mocks.verify.mockResolvedValue({ error: { message: "secret" } });
    expect((await verifyRegistrationEmail({ error: null }, form)).error).toContain("expired");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("preserves sign in and sign out redirects", async () => {
    mocks.signIn.mockResolvedValue({ error: null });
    await expect(signInWithEmail({ error: null }, registration())).rejects.toThrow("REDIRECT:/dashboard");
    await expect(signOutAction()).rejects.toThrow("REDIRECT:/auth/sign-in");
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});
