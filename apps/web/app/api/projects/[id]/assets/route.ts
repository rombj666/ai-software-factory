import { randomUUID } from "node:crypto";
import { put, del } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { projectAssets } from "@asf/db/schema";
import { ownedProject } from "@asf/agents/consultation";
import { projectIdSchema } from "@asf/agents/schema";
import { db } from "@/lib/db";
import { getSessionSafe } from "@/lib/auth/server";
import {
  boundedUploadForm,
  storageConfigured,
  validateReferenceImage,
} from "@/lib/reference-images";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Invalid upload origin." }, { status: 403 });
  const { data } = await getSessionSafe();
  if (!data?.user?.id)
    return Response.json(
      { error: "Sign in to upload a reference image." },
      { status: 401 },
    );
  const { id } = await params;
  if (!projectIdSchema.safeParse(id).success)
    return Response.json({ error: "Project not found." }, { status: 404 });
  const ownerId = data.user.id;
  async function checkProject(
    tx: Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0],
  ) {
    const project = await ownedProject(tx, id, ownerId);
    if (!["idea_submitted", "consultation"].includes(project.status))
      throw new Error("Uploads are closed.");
    const assets = await tx
      .select({ id: projectAssets.id })
      .from(projectAssets)
      .where(eq(projectAssets.projectId, id));
    if (assets.length >= 20) throw new Error("Maximum 20 reference images.");
  }
  try {
    await db().transaction(checkProject);
  } catch {
    return Response.json(
      { error: "Project not found, uploads closed, or image limit reached." },
      { status: 404 },
    );
  }
  if (!storageConfigured())
    return Response.json(
      {
        error:
          "Private storage is not configured. Ask the operator to connect a private Blob store.",
      },
      { status: 503 },
    );
  let file: File;
  let bytes: Uint8Array;
  let mimeType: string;
  try {
    const form = await boundedUploadForm(request);
    const value = form.get("file");
    if (!(value instanceof File)) throw new Error("Choose an image to upload.");
    file = value;
    bytes = new Uint8Array(await file.arrayBuffer());
    mimeType = validateReferenceImage(bytes, file.type);
  } catch {
    return Response.json(
      { error: "Upload a valid PNG, JPEG or WebP image no larger than 4 MiB." },
      { status: 400 },
    );
  }
  const filename =
    file.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 150) ||
    "reference-image";
  const assetId = randomUUID();
  const pathname = `projects/${id}/references/${assetId}`;
  let uploaded = false;
  try {
    await put(pathname, Buffer.from(bytes), {
      access: "private",
      contentType: mimeType,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    uploaded = true;
    await db().transaction(async (tx) => {
      await checkProject(tx);
      await tx
        .insert(projectAssets)
        .values({
          id: assetId,
          projectId: id,
          storageUri: pathname,
          filename,
          mimeType,
          kind: "reference_image",
        });
    });
    return Response.json({ id: assetId, filename }, { status: 201 });
  } catch {
    if (uploaded) {
      try {
        await del(pathname);
      } catch {
        /* Storage cleanup can be retried by the operator; never expose its token. */
      }
    }
    return Response.json(
      {
        error:
          "Private upload could not be saved. Check the private store configuration and retry.",
      },
      { status: 503 },
    );
  }
}
