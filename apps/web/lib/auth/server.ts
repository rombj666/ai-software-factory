import { createNeonAuth } from "@neondatabase/auth/next/server";

/**
 * Real Neon Auth integration (M1.4). The SDK is built on Better Auth and is
 * configured through the Neon Console; only the base URL and cookie secret are
 * required here.
 *
 * Required environment variables:
 *   NEON_AUTH_BASE_URL      - your Neon Auth base URL (e.g. https://<project>.neon.auth.us-west-2.aws.neon.tech)
 *   NEON_AUTH_COOKIE_SECRET - a long random secret (>= 32 chars) used to sign session cookies
 *
 * API routes mount the handler at /api/auth/[...path]; the middleware is
 * created in middleware.ts via `auth.middleware()`. The catch-all segment is
 * named `path` because the SDK handler's route params type expects
 * `{ path: string[] }`.
 *
 * The instance is created lazily so builds and pages can run without Neon Auth
 * credentials. When credentials are missing, pages degrade gracefully and any
 * attempt to actually sign in / access protected data fails with a clear
 * "not configured" error instead of pretending auth works.
 */
export function isAuthConfigured(): boolean {
  return Boolean(process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET);
}

export function getAuth() {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl || !cookieSecret) {
    throw new Error(
      "Neon Auth is not configured. Set NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET (see .env.example).",
    );
  }
  return createNeonAuth({
    baseUrl,
    cookies: {
      secret: cookieSecret,
    },
  });
}

export type SafeSessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
};

export type SafeSessionResult = {
  data: { user: SafeSessionUser | null } | null;
  error: unknown;
};

/**
 * Session helper for pages and server actions. Returns `{ data: null }`
 * without throwing when Neon Auth is not configured, so the UI can show the
 * sign-in page / a configuration warning instead of crashing.
 */
export async function getSessionSafe(): Promise<SafeSessionResult> {
  if (!isAuthConfigured()) {
    return { data: null, error: null };
  }
  const { data, error } = await getAuth().getSession();
  return {
    data: data ? { user: (data.user ?? null) as SafeSessionUser | null } : null,
    error,
  };
}
