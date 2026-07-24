import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";

/**
 * Design-mode session sharing — mirror of ai_shares for design_sessions.
 * Same constraints as ai_conversations:
 *   - Only the owner can share.
 *   - Can't share team sessions (everyone on the workspace already sees them).
 *   - Can't share incognito sessions.
 *   - Max 20 shares per session.
 */

const MAX_SHARES_PER_SESSION = 20;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);

  const { data: row } = await intelligenceDb
    .from("design_sessions")
    .select("user_created")
    .eq("id_session", params.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((row as any).user_created !== userId) {
    return NextResponse.json({ error: "Only the owner can see shares" }, { status: 403 });
  }

  const { data: shares } = await intelligenceDb
    .from("design_shares")
    .select("id_share, user_recipient, type_permission, date_created")
    .eq("id_session", params.id);

  // Resolve user names
  const recipientIds = Array.from(new Set((shares || []).map((s: any) => s.user_recipient)));
  let userMap = new Map<number, { name: string; email: string | null }>();
  if (recipientIds.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("id_user, name_user, email_user")
      .in("id_user", recipientIds);
    userMap = new Map((users || []).map((u: any) => [u.id_user, { name: u.name_user || u.email_user, email: u.email_user }]));
  }

  return NextResponse.json({
    shares: (shares || []).map((s: any) => ({
      id: s.id_share,
      userId: s.user_recipient,
      userName: userMap.get(s.user_recipient)?.name || `User ${s.user_recipient}`,
      userEmail: userMap.get(s.user_recipient)?.email || null,
      permission: s.type_permission,
      createdAt: s.date_created,
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);
  const body = await req.json();

  const { data: row } = await intelligenceDb
    .from("design_sessions")
    .select("user_created, type_visibility, flag_incognito, id_workspace")
    .eq("id_session", params.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((row as any).user_created !== userId) {
    return NextResponse.json({ error: "Only the owner can share" }, { status: 403 });
  }
  if ((row as any).type_visibility === "team") {
    return NextResponse.json({ error: "Team sessions are already visible to the workspace — no need to share." }, { status: 400 });
  }
  if ((row as any).flag_incognito === 1) {
    return NextResponse.json({ error: "Incognito sessions can't be shared." }, { status: 400 });
  }

  const recipientEmail: string | undefined = body.recipientEmail;
  const recipientId: number | undefined = body.recipientId;
  const permission: "view" | "collaborate" = body.permission === "collaborate" ? "collaborate" : "view";

  // Resolve recipient
  let resolvedRecipientId: number | null = null;
  if (typeof recipientId === "number") {
    resolvedRecipientId = recipientId;
  } else if (recipientEmail) {
    const { data: u } = await supabase
      .from("users")
      .select("id_user")
      .eq("email_user", recipientEmail)
      .maybeSingle();
    if (!u) return NextResponse.json({ error: `No user with email ${recipientEmail}` }, { status: 404 });
    resolvedRecipientId = (u as any).id_user;
  } else {
    return NextResponse.json({ error: "recipientEmail or recipientId required" }, { status: 400 });
  }

  if (resolvedRecipientId === userId) {
    return NextResponse.json({ error: "Can't share with yourself." }, { status: 400 });
  }

  // Verify recipient is in the same workspace (mirror ai_shares logic)
  const { data: membership } = await intelligenceDb
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", (row as any).id_workspace)
    .eq("user_id", resolvedRecipientId)
    .limit(1);
  if (!membership || membership.length === 0) {
    return NextResponse.json({ error: "Recipient isn't a member of this workspace." }, { status: 400 });
  }

  // Max-shares check
  const { count: existingCount } = await intelligenceDb
    .from("design_shares")
    .select("id_share", { count: "exact", head: true })
    .eq("id_session", params.id);
  if ((existingCount || 0) >= MAX_SHARES_PER_SESSION) {
    return NextResponse.json({ error: `Max ${MAX_SHARES_PER_SESSION} shares per session.` }, { status: 400 });
  }

  // Upsert (idempotent — re-sharing same recipient updates permission)
  const { data: created, error } = await intelligenceDb
    .from("design_shares")
    .upsert(
      {
        id_session: params.id,
        user_recipient: resolvedRecipientId,
        user_shared: userId,
        type_permission: permission,
      },
      { onConflict: "id_session,user_recipient" }
    )
    .select("id_share")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ share: { id: (created as any).id_share, recipientId: resolvedRecipientId, permission } });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);

  const { searchParams } = new URL(req.url);
  const shareId = searchParams.get("shareId");
  if (!shareId) return NextResponse.json({ error: "shareId required" }, { status: 400 });

  // Owner check
  const { data: row } = await intelligenceDb
    .from("design_sessions")
    .select("user_created")
    .eq("id_session", params.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((row as any).user_created !== userId) {
    return NextResponse.json({ error: "Only the owner can revoke shares" }, { status: 403 });
  }

  const { error } = await intelligenceDb
    .from("design_shares")
    .delete()
    .eq("id_share", shareId)
    .eq("id_session", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
