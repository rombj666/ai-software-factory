import { and, eq } from "drizzle-orm";
import { prototypeVersions } from "@asf/db/schema";
import { ownedProject } from "@asf/agents/consultation";
import { projectIdSchema } from "@asf/agents/schema";
import { get } from "@vercel/blob";
import { db } from "@/lib/db";
import { getSessionSafe } from "@/lib/auth/server";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { data } = await getSessionSafe();
  if (!data?.user?.id) return new Response("Sign in to view this image.", { status: 401 });
  const { id, versionId } = await params;
  if (![id, versionId].every(value => projectIdSchema.safeParse(value).success)) return new Response("Not found", { status: 404 });
  let version;
  try {
    version = await db().transaction(async tx => {
      await ownedProject(tx, id, data.user!.id);
      const [row] = await tx.select().from(prototypeVersions).where(and(eq(prototypeVersions.id, versionId), eq(prototypeVersions.projectId, id)));
      return row;
    });
  } catch { return new Response("Not found", { status: 404 }); }
  if (!version) return new Response("Not found", { status: 404 });
  try {
    const image = await get(version.imageStorageUri, { access: "private", useCache: false, abortSignal: AbortSignal.timeout(15000) });
    if (!image || image.statusCode !== 200) return new Response("Not found", { status: 404 });
    return new Response(image.stream, { headers: { "content-type": "image/png", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": "inline", "vary": "Cookie" } });
  } catch { return new Response("Private image is temporarily unavailable.", { status: 503 }); }
}
