import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConversations, aiConversationShares, workspaces } from "@/lib/db/schema";
import { eq, and, or, like, desc, sql, inArray } from "drizzle-orm";
import { supabase } from "@/lib/supabase";

// GET /api/ai/conversations — list conversations
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const visibility = searchParams.get("visibility"); // 'private' | 'team' | null
  const contentObjectId = searchParams.get("contentObjectId");
  const customerId = searchParams.get("customerId");
  const search = searchParams.get("search");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    // Get conversation IDs shared with this user (for private conversations they don't own)
    const sharedWithMe = await db
      .select({
        conversationId: aiConversationShares.conversationId,
        sharedBy: aiConversationShares.sharedBy,
        permission: aiConversationShares.permission,
      })
      .from(aiConversationShares)
      .where(eq(aiConversationShares.userId, userId));

    const sharedConvoIds = sharedWithMe.map((s) => s.conversationId);
    const sharedByMap = new Map(
      sharedWithMe.map((s) => [s.conversationId, { sharedBy: s.sharedBy, permission: s.permission }])
    );

    // Build conditions — always exclude incognito conversations
    const conditions = [
      eq(aiConversations.workspaceId, workspaceId),
      eq(aiConversations.isIncognito, false),
    ];

    if (visibility === "private") {
      // User's own private conversations + shared-with-me private conversations
      if (sharedConvoIds.length > 0) {
        conditions.push(
          or(
            and(
              eq(aiConversations.visibility, "private"),
              eq(aiConversations.createdBy, userId)
            ),
            and(
              eq(aiConversations.visibility, "private"),
              inArray(aiConversations.id, sharedConvoIds)
            )
          )!
        );
      } else {
        conditions.push(eq(aiConversations.visibility, "private"));
        conditions.push(eq(aiConversations.createdBy, userId));
      }
    } else if (visibility === "team") {
      conditions.push(eq(aiConversations.visibility, "team"));
    } else {
      // Default: user's private + shared-with-me + all team conversations
      if (sharedConvoIds.length > 0) {
        conditions.push(
          or(
            and(
              eq(aiConversations.visibility, "private"),
              eq(aiConversations.createdBy, userId)
            ),
            and(
              eq(aiConversations.visibility, "private"),
              inArray(aiConversations.id, sharedConvoIds)
            ),
            eq(aiConversations.visibility, "team")
          )!
        );
      } else {
        conditions.push(
          or(
            and(
              eq(aiConversations.visibility, "private"),
              eq(aiConversations.createdBy, userId)
            ),
            eq(aiConversations.visibility, "team")
          )!
        );
      }
    }

    if (contentObjectId) {
      conditions.push(eq(aiConversations.contentObjectId, parseInt(contentObjectId, 10)));
    }

    if (customerId) {
      conditions.push(eq(aiConversations.customerId, parseInt(customerId, 10)));
    }

    if (search) {
      conditions.push(like(aiConversations.title, `%${search}%`));
    }

    const conversations = await db
      .select({
        id: aiConversations.id,
        workspaceId: aiConversations.workspaceId,
        createdBy: aiConversations.createdBy,
        title: aiConversations.title,
        visibility: aiConversations.visibility,
        contentObjectId: aiConversations.contentObjectId,
        customerId: aiConversations.customerId,
        model: aiConversations.model,
        createdAt: aiConversations.createdAt,
        updatedAt: aiConversations.updatedAt,
      })
      .from(aiConversations)
      .where(and(...conditions))
      .orderBy(desc(aiConversations.updatedAt))
      .limit(limit);

    // Resolve customer names from Supabase
    const customerIds = Array.from(
      new Set(
        conversations
          .map((c) => c.customerId)
          .filter((id): id is number => id !== null)
      )
    );

    let customerNameMap = new Map<number, string>();
    if (customerIds.length > 0) {
      const { data: clients } = await supabase
        .from("app_clients")
        .select("id_client, name_client")
        .in("id_client", customerIds);
      if (clients) {
        customerNameMap = new Map(
          clients.map((c: any) => [c.id_client, c.name_client])
        );
      }
    }

    // Resolve sharer names for shared-with-me conversations
    const sharerIds = Array.from(
      new Set(
        conversations
          .filter((c) => c.createdBy !== userId && sharedByMap.has(c.id))
          .map((c) => sharedByMap.get(c.id)!.sharedBy)
      )
    );

    let sharerNameMap = new Map<number, string>();
    if (sharerIds.length > 0) {
      const { data: sharers } = await supabase
        .from("users")
        .select("id_user, name_user")
        .in("id_user", sharerIds);
      if (sharers) {
        sharerNameMap = new Map(
          sharers.map((u: any) => [u.id_user, u.name_user])
        );
      }
    }

    const enriched = conversations.map((c) => {
      const isSharedWithMe = c.createdBy !== userId && sharedByMap.has(c.id);
      const shareInfo = sharedByMap.get(c.id);
      return {
        ...c,
        customerName: c.customerId ? customerNameMap.get(c.customerId) || null : null,
        sharedWithMe: isSharedWithMe || undefined,
        myPermission: c.createdBy === userId
          ? ("owner" as const)
          : isSharedWithMe
          ? (shareInfo!.permission as "view" | "collaborate")
          : undefined,
        sharedByName: isSharedWithMe
          ? sharerNameMap.get(shareInfo!.sharedBy) || null
          : undefined,
      };
    });

    return NextResponse.json({ conversations: enriched });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/ai/conversations — create a new conversation
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  try {
    const body = await req.json();
    const { workspaceId, title, visibility, contentObjectId, customerId, model, isIncognito } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    // Ensure workspace exists in Neon (sync from Supabase if needed)
    const existingWs = await db
      .select({ id: workspaces.id, aiModel: workspaces.aiModel })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    if (existingWs.length === 0) {
      const { data: supaWs } = await supabase
        .from("workspaces")
        .select("id, name, slug, plan")
        .eq("id", workspaceId)
        .single();

      if (!supaWs) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }

      await db.insert(workspaces).values({
        id: supaWs.id,
        name: supaWs.name,
        slug: supaWs.slug,
        plan: supaWs.plan || "free",
      }).onConflictDoNothing();
    }

    // Get workspace default model if not specified
    let aiModel = model;
    if (!aiModel) {
      aiModel = existingWs[0]?.aiModel || "claude-sonnet-4-20250514";
    }

    const [conversation] = await db
      .insert(aiConversations)
      .values({
        workspaceId,
        createdBy: userId,
        title: title || "New Conversation",
        visibility: visibility || "private",
        contentObjectId: contentObjectId
          ? parseInt(String(contentObjectId), 10)
          : null,
        customerId: customerId
          ? parseInt(String(customerId), 10)
          : null,
        model: aiModel,
        isIncognito: isIncognito || false,
      })
      .returning();

    return NextResponse.json({ conversation });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
