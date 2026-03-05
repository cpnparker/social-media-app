import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConversations, workspaces } from "@/lib/db/schema";
import { eq, and, or, like, desc, sql } from "drizzle-orm";

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
  const search = searchParams.get("search");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    // Build conditions
    const conditions = [eq(aiConversations.workspaceId, workspaceId)];

    if (visibility === "private") {
      conditions.push(eq(aiConversations.visibility, "private"));
      conditions.push(eq(aiConversations.createdBy, userId));
    } else if (visibility === "team") {
      conditions.push(eq(aiConversations.visibility, "team"));
    } else {
      // Default: user's private + all team conversations
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

    if (contentObjectId) {
      conditions.push(eq(aiConversations.contentObjectId, parseInt(contentObjectId, 10)));
    }

    if (search) {
      conditions.push(like(aiConversations.title, `%${search}%`));
    }

    const conversations = await db
      .select()
      .from(aiConversations)
      .where(and(...conditions))
      .orderBy(desc(aiConversations.updatedAt))
      .limit(limit);

    return NextResponse.json({ conversations });
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
    const { workspaceId, title, visibility, contentObjectId, model } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    // Get workspace default model if not specified
    let aiModel = model;
    if (!aiModel) {
      const ws = await db
        .select({ aiModel: workspaces.aiModel })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      aiModel = ws[0]?.aiModel || "claude-sonnet-4-20250514";
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
        model: aiModel,
      })
      .returning();

    return NextResponse.json({ conversation });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
