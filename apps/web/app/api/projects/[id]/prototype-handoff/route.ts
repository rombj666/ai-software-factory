import { readPrototypeHandoff } from "@asf/agents/prototype";
import { getSessionSafe } from "@/lib/auth/server";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { data } = await getSessionSafe();
  if (!data?.user?.id) return new Response("Sign in to view this handoff.", { status: 401 });
  const { id } = await params;
  try { return Response.json(await readPrototypeHandoff(db(), data.user.id, id), { headers: { "cache-control": "private, no-store", "vary": "Cookie" } }); }
  catch { return new Response("Approved handoff not found.", { status: 404 }); }
}
