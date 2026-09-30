import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkSessionAccess } from "@/lib/ai/access";

/**
 * POST /api/design/sessions/[id]/shots/[shotId]/refs
 *
 * Accepts either:
 *   - multipart/form-data with a `file` field (image upload)
 *   - JSON { externalUrl, caption?, seedLocked? } for already-hosted images
 *   - JSON { assetId, caption?, seedLocked? } to reference an existing canvas asset
 *
 * Returns the created reference row.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; shotId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const sessionId = params.id;
  const shotId = params.shotId;

  // Access check (mutation)
  const { data: sessionRow } = await intelligenceDb
    .from("design_sessions")
    .select("type_visibility, user_created, id_workspace")
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!sessionRow) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const access = await checkSessionAccess(sessionId, userId, {
    visibility: (sessionRow as any).type_visibility,
    userCreated: (sessionRow as any).user_created,
    workspaceId: (sessionRow as any).id_workspace,
  });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (access.permission === "view") return NextResponse.json({ error: "Read-only" }, { status: 403 });

  // Find next idx
  const { data: existing } = await intelligenceDb
    .from("design_shot_references")
    .select("idx")
    .eq("id_shot", shotId)
    .order("idx", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextIdx = ((existing as any)?.idx || 0) + 1;

  const contentType = req.headers.get("content-type") || "";

  let externalUrl: string | null = null;
  let assetId: string | null = null;
  let caption: string | null = null;
  let seedLocked = 0;

  if (contentType.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
    if (!file.type.startsWith("image/")) return NextResponse.json({ error: "Only image references for now" }, { status: 400 });
    if (file.size > 12 * 1024 * 1024) return NextResponse.json({ error: "File over 12MB limit" }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    const ext = (file.name.split(".").pop() || "png").toLowerCase().slice(0, 4);
    const filename = `design/refs/${sessionId.slice(0, 8)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const blob = await put(filename, buf, { access: "private", contentType: file.type });
    externalUrl = `/api/media/file?path=${encodeURIComponent(blob.pathname)}`;
    caption = (form.get("caption") as string) || file.name || null;
    seedLocked = form.get("seedLocked") === "true" || form.get("seedLocked") === "1" ? 1 : 0;
  } else {
    // JSON body
    const body = await req.json().catch(() => ({}));
    if (body.externalUrl) externalUrl = body.externalUrl;
    if (body.assetId) assetId = body.assetId;
    caption = body.caption ?? null;
    seedLocked = body.seedLocked ? 1 : 0;
    if (!externalUrl && !assetId) {
      return NextResponse.json({ error: "Provide a file, externalUrl, or assetId" }, { status: 400 });
    }
  }

  const { data: row, error } = await intelligenceDb
    .from("design_shot_references")
    .insert({
      id_shot: shotId,
      idx: nextIdx,
      id_asset: assetId,
      external_url: externalUrl,
      seed_locked: seedLocked,
      caption,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    reference: {
      id: (row as any).id_reference,
      idx: nextIdx,
      assetId,
      assetUrl: assetId ? null : null,
      externalUrl,
      seedLocked: !!seedLocked,
      caption,
    },
  });
}

/**
 * DELETE /api/design/sessions/[id]/shots/[shotId]/refs?refId=...
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string; shotId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const sessionId = params.id;
  const refId = new URL(req.url).searchParams.get("refId");
  if (!refId) return NextResponse.json({ error: "refId required" }, { status: 400 });

  const { data: sessionRow } = await intelligenceDb
    .from("design_sessions")
    .select("type_visibility, user_created, id_workspace")
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!sessionRow) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const access = await checkSessionAccess(sessionId, userId, {
    visibility: (sessionRow as any).type_visibility,
    userCreated: (sessionRow as any).user_created,
    workspaceId: (sessionRow as any).id_workspace,
  });
  if (!access.allowed || access.permission === "view") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await intelligenceDb
    .from("design_shot_references")
    .delete()
    .eq("id_reference", refId)
    .eq("id_shot", params.shotId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
