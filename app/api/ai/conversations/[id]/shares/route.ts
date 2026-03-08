import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConversations, aiConversationShares, userAccess } from "@/lib/db/schema";
import { eq, and, count } from "drizzle-orm";
import { supabase } from "@/lib/supabase";
import { Resend } from "resend";

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
    const [conversation] = await db
      .select({
        createdBy: aiConversations.createdBy,
        visibility: aiConversations.visibility,
      })
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1);

    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Only owner can list shares
    if (conversation.createdBy !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch shares
    const shares = await db
      .select({
        id: aiConversationShares.id,
        conversationId: aiConversationShares.conversationId,
        userId: aiConversationShares.userId,
        permission: aiConversationShares.permission,
        sharedBy: aiConversationShares.sharedBy,
        createdAt: aiConversationShares.createdAt,
      })
      .from(aiConversationShares)
      .where(eq(aiConversationShares.conversationId, conversationId));

    // Resolve user names from Supabase
    const userIds = shares.map((s) => s.userId);
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

    const enriched = shares.map((s) => ({
      ...s,
      userName: userNameMap.get(s.userId)?.name || null,
      userEmail: userNameMap.get(s.userId)?.email || null,
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
    const [conversation] = await db
      .select({
        createdBy: aiConversations.createdBy,
        visibility: aiConversations.visibility,
        workspaceId: aiConversations.workspaceId,
        isIncognito: aiConversations.isIncognito,
      })
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1);

    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Only owner can share
    if (conversation.createdBy !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Cannot share with yourself
    if (targetUserId === userId) {
      return NextResponse.json({ error: "Cannot share with yourself" }, { status: 400 });
    }

    // Cannot share team conversations
    if (conversation.visibility === "team") {
      return NextResponse.json(
        { error: "Team conversations are already accessible to all members" },
        { status: 400 }
      );
    }

    // Cannot share incognito conversations
    if (conversation.isIncognito) {
      return NextResponse.json(
        { error: "Cannot share incognito conversations" },
        { status: 400 }
      );
    }

    // Verify target user is a workspace member
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", conversation.workspaceId)
      .eq("user_id", targetUserId)
      .limit(1);

    if (!membership || membership.length === 0) {
      return NextResponse.json(
        { error: "User is not a workspace member" },
        { status: 400 }
      );
    }

    // Check EngineGPT access
    const [access] = await db
      .select({ accessEngineGpt: userAccess.accessEngineGpt })
      .from(userAccess)
      .where(
        and(
          eq(userAccess.workspaceId, conversation.workspaceId),
          eq(userAccess.userId, targetUserId)
        )
      )
      .limit(1);

    // If no access row, default is true; if row exists, check flag
    if (access && !access.accessEngineGpt) {
      return NextResponse.json(
        { error: "User does not have EngineGPT access" },
        { status: 400 }
      );
    }

    // Cap at 20 shares per conversation
    const [shareCount] = await db
      .select({ total: count() })
      .from(aiConversationShares)
      .where(eq(aiConversationShares.conversationId, conversationId));

    if (shareCount && shareCount.total >= 20) {
      return NextResponse.json(
        { error: "Maximum 20 shares per conversation" },
        { status: 400 }
      );
    }

    // Upsert: insert or update if already shared
    const existing = await db
      .select({ id: aiConversationShares.id })
      .from(aiConversationShares)
      .where(
        and(
          eq(aiConversationShares.conversationId, conversationId),
          eq(aiConversationShares.userId, targetUserId)
        )
      )
      .limit(1);

    let share;
    if (existing.length > 0) {
      [share] = await db
        .update(aiConversationShares)
        .set({ permission })
        .where(eq(aiConversationShares.id, existing[0].id))
        .returning();
    } else {
      [share] = await db
        .insert(aiConversationShares)
        .values({
          conversationId,
          userId: targetUserId,
          permission,
          sharedBy: userId,
        })
        .returning();
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
        const convoTitle = (await db
          .select({ title: aiConversations.title })
          .from(aiConversations)
          .where(eq(aiConversations.id, conversationId))
          .limit(1)
        )[0]?.title || "Untitled conversation";

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
        ...share,
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
    const [conversation] = await db
      .select({ createdBy: aiConversations.createdBy })
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1);

    if (!conversation || conversation.createdBy !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [updated] = await db
      .update(aiConversationShares)
      .set({ permission })
      .where(
        and(
          eq(aiConversationShares.id, shareId),
          eq(aiConversationShares.conversationId, conversationId)
        )
      )
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    return NextResponse.json({ share: updated });
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
    const [conversation] = await db
      .select({ createdBy: aiConversations.createdBy })
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1);

    if (!conversation || conversation.createdBy !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await db
      .delete(aiConversationShares)
      .where(
        and(
          eq(aiConversationShares.id, shareId),
          eq(aiConversationShares.conversationId, conversationId)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
