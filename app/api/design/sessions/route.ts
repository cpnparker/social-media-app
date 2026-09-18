import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { verifyWorkspaceMembership } from "@/lib/permissions";

/**
 * GET /api/design/sessions?workspaceId=...&clientId=...&contentId=...&limit=50
 *
 * Returns design sessions in the workspace the user has access to:
 * own private + team + shared-with-me (mirrors ai_conversations). Always
 * excludes incognito sessions.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const clientId = searchParams.get("clientId");
  const contentId = searchParams.get("contentId");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
  if (!memberRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Build the accessible-conversations OR clause (private+owner, private+shared, team)
  const { data: shared } = await intelligenceDb
    .from("design_shares")
    .select("id_session, user_shared, type_permission")
    .eq("user_recipient", userId);
  const sharedIds = (shared || []).map((s: any) => s.id_session as string);
  const sharedByMap = new Map(
    (shared || []).map((s: any) => [s.id_session, { sharedBy: s.user_shared, permission: s.type_permission }])
  );

  let query = intelligenceDb
    .from("design_sessions")
    .select("*")
    .eq("id_workspace", workspaceId)
    .eq("flag_incognito", 0);

  if (sharedIds.length > 0) {
    query = query.or(
      `and(type_visibility.eq.private,user_created.eq.${userId}),and(type_visibility.eq.private,id_session.in.(${sharedIds.join(",")})),type_visibility.eq.team`
    );
  } else {
    query = query.or(
      `and(type_visibility.eq.private,user_created.eq.${userId}),type_visibility.eq.team`
    );
  }

  if (clientId) query = query.eq("id_client", parseInt(clientId, 10));
  if (contentId) query = query.eq("id_content", parseInt(contentId, 10));

  const { data, error } = await query
    .order("date_updated", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Resolve client names
  const clientIds = Array.from(new Set((data || []).map((s: any) => s.id_client).filter(Boolean)));
  let clientNameMap = new Map<number, string>();
  if (clientIds.length > 0) {
    const { data: clients } = await supabase
      .from("app_clients")
      .select("id_client, name_client")
      .in("id_client", clientIds);
    clientNameMap = new Map((clients || []).map((c: any) => [c.id_client, c.name_client]));
  }

  const sessions = (data || []).map((s: any) => ({
    id: s.id_session,
    workspaceId: s.id_workspace,
    clientId: s.id_client,
    clientName: s.id_client ? clientNameMap.get(s.id_client) || null : null,
    contentId: s.id_content,
    userCreated: s.user_created,
    name: s.name_session,
    visibility: s.type_visibility,
    isIncognito: !!s.flag_incognito,
    timelineShape: s.type_timeline_shape,
    currentShotId: s.current_shot_id,
    brandKitSnapshotId: s.id_brand_kit_snapshot,
    sharedWithMe: !!sharedByMap.get(s.id_session) && s.user_created !== userId,
    myPermission: s.user_created === userId ? "owner" :
      sharedByMap.get(s.id_session)?.permission ?? (s.type_visibility === "team" ? "collaborate" : null),
    createdAt: s.date_created,
    updatedAt: s.date_updated,
  }));

  return NextResponse.json({ sessions });
}

/**
 * POST /api/design/sessions
 * Body: { workspaceId, name?, clientId?, contentId?, visibility?, isIncognito? }
 *
 * Creates a session, snapshots the client's visual_identity into design_brand_kits,
 * and seeds default tracks (Titles / V1 Shots / V2 Overlay / A1 VO / A2 Score / A3 Ambience).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const body = await req.json();
  const { workspaceId, name, clientId, contentId, visibility, isIncognito } = body;

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
  if (!memberRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Snapshot brand kit if a client is set + visual_identity exists
  let brandKitId: string | null = null;
  if (clientId) {
    const { data: ctx } = await intelligenceDb
      .from("ai_client_context")
      .select("visual_identity, document_context, date_last_processed")
      .eq("id_workspace", workspaceId)
      .eq("id_client", parseInt(String(clientId), 10))
      .maybeSingle();
    if (ctx?.visual_identity || ctx?.document_context) {
      const { data: kit } = await intelligenceDb
        .from("design_brand_kits")
        .insert({
          id_client: parseInt(String(clientId), 10),
          version_tag: `auto · ${new Date(ctx.date_last_processed || Date.now()).toISOString().slice(0, 10)}`,
          visual_identity: ctx.visual_identity || { fallback_prose: ctx.document_context },
        })
        .select("id_brand_kit")
        .single();
      brandKitId = (kit as any)?.id_brand_kit || null;
    }
  }

  // Default session name — date-stamped so the sessions list isn't a wall
  // of identical "New design session" rows. Users can rename later.
  const defaultName = (() => {
    const d = new Date();
    const month = d.toLocaleString("en-US", { month: "short" });
    const day = d.getDate();
    // e.g. "Untitled · May 17 · 14:32"
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `Untitled · ${month} ${day} · ${hh}:${mm}`;
  })();

  const { data: created, error } = await intelligenceDb
    .from("design_sessions")
    .insert({
      id_workspace: workspaceId,
      id_client: clientId ? parseInt(String(clientId), 10) : null,
      id_content: contentId ? parseInt(String(contentId), 10) : null,
      user_created: userId,
      name_session: (name && name.trim()) || defaultName,
      type_visibility: visibility === "team" ? "team" : "private",
      flag_incognito: isIncognito ? 1 : 0,
      type_timeline_shape: "tracks",
      id_brand_kit_snapshot: brandKitId,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Seed default tracks
  const tracks = [
    { kind: "title", idx: 0, label: "Titles" },
    { kind: "video", idx: 1, label: "V1 · Shots" },
    { kind: "overlay", idx: 2, label: "V2 · Overlay" },
    { kind: "voice", idx: 3, label: "A1 · VO" },
    { kind: "music", idx: 4, label: "A2 · Score" },
    { kind: "ambience", idx: 5, label: "A3 · Ambience" },
  ].map((t) => ({ ...t, id_session: (created as any).id_session }));
  await intelligenceDb.from("design_tracks").insert(tracks);

  return NextResponse.json({ session: mapSession(created) });
}

function mapSession(s: any) {
  if (!s) return null;
  return {
    id: s.id_session,
    workspaceId: s.id_workspace,
    clientId: s.id_client,
    contentId: s.id_content,
    userCreated: s.user_created,
    name: s.name_session,
    visibility: s.type_visibility,
    isIncognito: !!s.flag_incognito,
    timelineShape: s.type_timeline_shape,
    currentShotId: s.current_shot_id,
    brandKitSnapshotId: s.id_brand_kit_snapshot,
    myPermission: "owner",
    createdAt: s.date_created,
    updatedAt: s.date_updated,
  };
}
