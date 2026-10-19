import { NextResponse } from "next/server";
import { getAuth, isAuthConfigured } from "@/lib/auth/server";

type RouteContext = { params: Promise<{ path: string[] }> };

async function dispatch(
  request: Request,
  ctx: RouteContext,
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: "Neon Auth is not configured. Set NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET." },
      { status: 500 },
    );
  }
  const handler = getAuth().handler();
  return handler[method](request, ctx);
}

export const GET = (request: Request, ctx: RouteContext) => dispatch(request, ctx, "GET");
export const POST = (request: Request, ctx: RouteContext) => dispatch(request, ctx, "POST");
export const PUT = (request: Request, ctx: RouteContext) => dispatch(request, ctx, "PUT");
export const DELETE = (request: Request, ctx: RouteContext) => dispatch(request, ctx, "DELETE");
export const PATCH = (request: Request, ctx: RouteContext) => dispatch(request, ctx, "PATCH");
