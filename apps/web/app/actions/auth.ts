"use server";

import { redirect } from "next/navigation";
import { getAuth, isAuthConfigured } from "@/lib/auth/server";
import { z } from "zod";

export interface SignUpResult {
  error: string | null;
  message: string | null;
  verificationEmail: string | null;
}

const registrationSchema = z.object({
  name: z.string().trim().min(1, "Full name is required.").max(200, "Full name must be at most 200 characters."),
  email: z.email("Enter a valid email address.").max(254, "Email address is too long."),
  password: z.string().min(8, "Password must contain at least 8 characters.").max(128, "Password must contain at most 128 characters."),
  confirmPassword: z.string().min(1, "Confirm your password."),
}).refine((value) => value.password === value.confirmPassword, {
  message: "Passwords do not match.",
  path: ["confirmPassword"],
});

function registrationError(code?: string): string {
  switch (code) {
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "An account with this email already exists. Please sign in.";
    case "PASSWORD_TOO_SHORT":
    case "PASSWORD_TOO_LONG":
      return "Your password does not meet the authentication provider's requirements. Use 8–128 characters.";
    case "INVALID_EMAIL":
      return "Enter a valid email address.";
    case "TOO_MANY_REQUESTS":
      return "Too many attempts. Please wait before trying again.";
    default:
      return "Unable to create your account. Please try again later or sign in if you already registered.";
  }
}

export async function signUpWithEmail(
  _prevState: SignUpResult,
  formData: FormData,
): Promise<SignUpResult> {
  const empty = { message: null, verificationEmail: null };
  for (const field of ["name", "email", "password", "confirmPassword"]) {
    const value = formData.get(field);
    if (typeof value !== "string" || !value.trim()) {
      return { ...empty, error: "Full name, email, password and password confirmation are required." };
    }
  }
  const parsed = registrationSchema.safeParse({
    name: formData.get("name"),
    email: typeof formData.get("email") === "string" ? String(formData.get("email")).trim() : "",
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { ...empty, error: parsed.error.issues[0]?.message ?? "Complete all required fields." };
  }
  if (!isAuthConfigured()) {
    return { ...empty, error: "Registration is currently unavailable. Please try again later." };
  }

  let hasSession = false;
  try {
    const { name, email, password } = parsed.data;
    const { data, error } = await getAuth().signUp.email({
      name, email, password, callbackURL: "/auth/sign-in",
    });
    if (error) return { ...empty, error: registrationError(error.code) };
    if (!data?.user) return { ...empty, error: registrationError() };
    // The SDK persists provider-issued cookies. A null token means registration
    // did not create a session (e.g. verification is required or auto-login is off).
    hasSession = Boolean(data.token);
    if (!hasSession) {
      return {
        error: null,
        message: "Registration received. If verification is required, follow the link or enter the code sent to your email. Then sign in. Check your spam folder too.",
        verificationEmail: data.user.emailVerified ? null : email,
      };
    }
  } catch {
    // Never return/log provider exceptions, credentials or session tokens.
    return { ...empty, error: registrationError() };
  }
  // Keep Next.js's redirect exception outside the provider error handler.
  if (hasSession) redirect("/dashboard");
  return { ...empty, error: registrationError() };
}

export async function verifyRegistrationEmail(
  _prevState: SignInResult,
  formData: FormData,
): Promise<SignInResult> {
  const parsed = z.object({ email: z.email(), otp: z.string().trim().regex(/^\d{6}$/, "Enter the six-digit code from your email.") }).safeParse({
    email: formData.get("email"), otp: formData.get("otp"),
  });
  if (!parsed.success) return { error: "Enter your email and the six-digit code from your email." };
  if (!isAuthConfigured()) return { error: "Email verification is currently unavailable." };
  try {
    const { error } = await getAuth().emailOtp.verifyEmail(parsed.data);
    if (error) return { error: "Unable to verify this code. It may be incorrect or expired. Check your email and try again." };
  } catch {
    return { error: "Email verification is currently unavailable. Please try again later." };
  }
  redirect("/auth/sign-in");
}

export interface SignInResult {
  error: string | null;
}

/**
 * Server action compatible with React `useActionState`:
 * `(prevState, formData) => Promise<State>`.
 */
export async function signInWithEmail(
  _prevState: SignInResult,
  formData: FormData,
): Promise<SignInResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  if (!isAuthConfigured()) {
    return { error: "Neon Auth is not configured. Set NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET." };
  }

  const { error } = await getAuth().signIn.email({ email, password });
  if (error) {
    return { error: error.message ?? "Sign in failed. Check your Neon Auth configuration." };
  }

  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  if (isAuthConfigured()) {
    await getAuth().signOut();
  }
  redirect("/auth/sign-in");
}
