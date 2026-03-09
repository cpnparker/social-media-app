import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { Resend } from "resend";
import { mapShare } from "@/lib/ai/response-mappers";

// GET /api/ai/conversations/[id]/shares — list shares for a conversation
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const conversationId = params.id;

  try {
    // Fetch conversation and verify ownership
    const { data: conversation } = await intelligenceDb
      .from("ai_conversations")
      .select("user_created, type_visibility")
      .eq("id_conversation", conversationId)
      .maybeSingle();

    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Only owner can list shares
    if (conversation.user_created !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch shares
    const { data: shares, error } = await intelligenceDb
      .from("ai_shares")
      .select("*")
      .eq("id_conversation", conversationId);

    if (error) throw error;

    // Resolve user names from Supabase
    const userIds = (shares || []).map((s: any) => s.user_recipient);
    let userNameMap = new Map<number, { name: string; email: string }>();
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id_user, name_user, email_user")
        .in("id_user", userIds);
      if (users) {
        userNameMap = new Map(
          users.map((u: any) => [
            u.id_user,
            { name: u.name_user, email: u.email_user },
          ])
        );
      }
    }

    const enriched = (shares || []).map((s: any) => ({
      ...mapShare(s),
      userName: userNameMap.get(s.user_recipient)?.name || null,
      userEmail: userNameMap.get(s.user_recipient)?.email || null,
    }));

    return NextResponse.json({ shares: enriched });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/ai/conversations/[id]/shares — add a share
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const conversationId = params.id;

  try {
    const body = await req.json();
    const { userId: targetUserId, permission = "view", notify = false } = body;

    if (!targetUserId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    if (!["view", "collaborate"].includes(permission)) {
      return NextResponse.json({ error: "Invalid permission" }, { status: 400 });
    }

    // Fetch conversation
    const { data: conversation } = await intelligenceDb
      .from("ai_conversations")
      .select("user_created, type_visibility, id_workspace, flag_incognito")
      .eq("id_conversation", conversationId)
      .maybeSingle();

    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Only owner can share
    if (conversation.user_created !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Cannot share with yourself
    if (targetUserId === userId) {
      return NextResponse.json({ error: "Cannot share with yourself" }, { status: 400 });
    }

    // Cannot share team conversations
    if (conversation.type_visibility === "team") {
      return NextResponse.json(
        { error: "Team conversations are already accessible to all members" },
        { status: 400 }
      );
    }

    // Cannot share incognito conversations
    if (conversation.flag_incognito) {
      return NextResponse.json(
        { error: "Cannot share incognito conversations" },
        { status: 400 }
      );
    }

    // Verify target user is a workspace member
    const { data: membership } = await intelligenceDb
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", conversation.id_workspace)
      .eq("user_id", targetUserId)
      .limit(1);

    if (!membership || membership.length === 0) {
      return NextResponse.json(
        { error: "User is not a workspace member" },
        { status: 400 }
      );
    }

    // Check EngineGPT access
    const { data: access } = await intelligenceDb
      .from("users_access")
      .select("flag_access_enginegpt")
      .eq("id_workspace", conversation.id_workspace)
      .eq("user_target", targetUserId)
      .maybeSingle();

    // If no access row, default is true; if row exists, check flag
    if (access && !access.flag_access_enginegpt) {
      return NextResponse.json(
        { error: "User does not have EngineGPT access" },
        { status: 400 }
      );
    }

    // Cap at 20 shares per conversation
    const { count: shareCount } = await intelligenceDb
      .from("ai_shares")
      .select("*", { count: "exact", head: true })
      .eq("id_conversation", conversationId);

    if ((shareCount || 0) >= 20) {
      return NextResponse.json(
        { error: "Maximum 20 shares per conversation" },
        { status: 400 }
      );
    }

    // Upsert: insert or update if already shared
    const { data: existing } = await intelligenceDb
      .from("ai_shares")
      .select("id_share")
      .eq("id_conversation", conversationId)
      .eq("user_recipient", targetUserId)
      .maybeSingle();

    let share;
    if (existing) {
      const { data: updated, error: updateErr } = await intelligenceDb
        .from("ai_shares")
        .update({ type_permission: permission })
        .eq("id_share", existing.id_share)
        .select()
        .single();
      if (updateErr) throw updateErr;
      share = updated;
    } else {
      const { data: inserted, error: insertErr } = await intelligenceDb
        .from("ai_shares")
        .insert({
          id_conversation: conversationId,
          user_recipient: targetUserId,
          type_permission: permission,
          user_shared: userId,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;
      share = inserted;
    }

    // Resolve user names for response + notification
    const { data: targetUser } = await supabase
      .from("users")
      .select("name_user, email_user")
      .eq("id_user", targetUserId)
      .single();

    // Send email notification if requested
    if (notify && targetUser?.email_user && process.env.RESEND_API_KEY) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);

        // Get sharer's name
        const { data: sharerUser } = await supabase
          .from("users")
          .select("name_user")
          .eq("id_user", userId)
          .single();

        const sharerName = sharerUser?.name_user || "Someone";
        const recipientName = targetUser.name_user || "there";
        const threadUrl = `${process.env.NEXTAUTH_URL || "https://ai.thecontentengine.com"}/enginegpt?thread=${conversationId}`;

        const { data: convoData } = await intelligenceDb
          .from("ai_conversations")
          .select("name_conversation")
          .eq("id_conversation", conversationId)
          .maybeSingle();
        const convoTitle = convoData?.name_conversation || "Untitled conversation";

        await resend.emails.send({
          from: "EngineGPT <noreply@tasks.thecontentengine.com>",
          to: targetUser.email_user,
          subject: `${sharerName} shared a conversation with you`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 0;">
              <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 16px;">
                Hi ${recipientName},
              </p>
              <p style="font-size: 15px; color: #333; line-height: 1.6; margin: 0 0 24px;">
                <strong>${sharerName}</strong> shared an EngineGPT conversation with you:
              </p>
              <div style="background: #f7f7f8; border-radius: 12px; padding: 16px 20px; margin: 0 0 24px;">
                <p style="font-size: 15px; font-weight: 600; color: #111; margin: 0 0 4px;">
                  ${convoTitle}
                </p>
                <p style="font-size: 13px; color: #666; margin: 0;">
                  ${permission === "collaborate" ? "You can view and edit" : "You can view"}
                </p>
              </div>
              <a href="${threadUrl}" style="display: inline-block; background: #111; color: #fff; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 500; text-decoration: none;">
                Open conversation
              </a>
              <p style="font-size: 12px; color: #999; margin: 24px 0 0; line-height: 1.5;">
                You received this because ${sharerName} shared an EngineGPT thread with you.
              </p>
            </div>
          `,
        });
      } catch (emailErr) {
        // Don't fail the share if email fails — log and continue
        console.error("Failed to send share notification email:", emailErr);
      }
    }

    return NextResponse.json({
      share: {
        ...mapShare(share),
        userName: targetUser?.name_user || null,
        userEmail: targetUser?.email_user || null,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/ai/conversations/[id]/shares — update a share's permission
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const conversationId = params.id;

  try {
    const body = await req.json();
    const { shareId, permission } = body;

    if (!shareId || !permission) {
      return NextResponse.json({ error: "shareId and permission are required" }, { status: 400 });
    }

    if (!["view", "collaborate"].includes(permission)) {
      return NextResponse.json({ error: "Invalid permission" }, { status: 400 });
    }

    // Verify ownership
    const { data: conversation } = await intelligenceDb
      .from("ai_conversations")
      .select("user_created")
      .eq("id_conversation", conversationId)
      .maybeSingle();

    if (!conversation || conversation.user_created !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: updated, error } = await intelligenceDb
      .from("ai_shares")
      .update({ type_permission: permission })
      .eq("id_share", shareId)
      .eq("id_conversation", conversationId)
      .select()
      .maybeSingle();

    if (error) throw error;

    if (!updated) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    return NextResponse.json({ share: mapShare(updated) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/ai/conversations/[id]/shares — remove a share
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const conversationId = params.id;

  const { searchParams } = new URL(req.url);
  const shareId = searchParams.get("shareId");

  if (!shareId) {
    return NextResponse.json({ error: "shareId is required" }, { status: 400 });
  }

  try {
    // Verify ownership
    const { data: conversation } = await intelligenceDb
      .from("ai_conversations")
      .select("user_created")
      .eq("id_conversation", conversationId)
      .maybeSingle();

    if (!conversation || conversation.user_created !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await intelligenceDb
      .from("ai_shares")
      .delete()
      .eq("id_share", shareId)
      .eq("id_conversation", conversationId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
