"use server";

import { redirect } from "next/navigation";
import { getAuth, isAuthConfigured } from "@/lib/auth/server";

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
