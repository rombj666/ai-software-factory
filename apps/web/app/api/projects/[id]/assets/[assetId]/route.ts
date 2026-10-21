import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { projectAssets } from "@asf/db/schema";
import { ownedProject } from "@asf/agents/consultation";
import { projectIdSchema } from "@asf/agents/schema";
import { db } from "@/lib/db";
import { getSessionSafe } from "@/lib/auth/server";
import { storageConfigured } from "@/lib/reference-images";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> },
) {
  const { data } = await getSessionSafe();
  if (!data?.user?.id)
    return new Response("Sign in to view this image.", { status: 401 });
  const { id, assetId } = await params;
  if (![id, assetId].every((value) => projectIdSchema.safeParse(value).success))
    return new Response("Not found", { status: 404 });
  const ownerId = data.user.id;
  let asset;
  try {
    asset = await db().transaction(async (tx) => {
      await ownedProject(tx, id, ownerId);
      const [row] = await tx
        .select()
        .from(projectAssets)
        .where(
          and(eq(projectAssets.id, assetId), eq(projectAssets.projectId, id)),
        );
      return row;
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!asset) return new Response("Not found", { status: 404 });
  if (!storageConfigured())
    return new Response("Private storage is unavailable.", { status: 503 });
  try {
    const blob = await get(asset.storageUri, {
      access: "private",
      useCache: false,
    });
    if (!blob || blob.statusCode !== 200)
      return new Response("Not found", { status: 404 });
    return new Response(blob.stream, {
      headers: {
        "content-type": asset.mimeType ?? "application/octet-stream",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-disposition": "inline",
      },
    });
  } catch {
    return new Response("Private image is temporarily unavailable.", {
      status: 503,
    });
  }
}
