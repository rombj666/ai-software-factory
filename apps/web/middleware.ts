import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAuth, isAuthConfigured } from "@/lib/auth/server";

/**
 * Protect the /dashboard area. Unauthenticated requests are redirected to the
 * sign-in page. Per-route ownership checks are performed separately in server
 * actions and page data loaders.
 *
 * When Neon Auth is not configured, requests pass through so the UI can show
 * the configuration warning instead of a 500.
 */
export default async function middleware(request: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.next();
  }
  return getAuth().middleware()(request);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
