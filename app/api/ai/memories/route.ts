import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiMemories, aiConversations } from "@/lib/db/schema";
import { eq, and, or, sql } from "drizzle-orm";

// GET /api/ai/memories?workspaceId=...
// Returns active memories: user's private + workspace team
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    const memories = await db
      .select()
      .from(aiMemories)
      .where(
        and(
          eq(aiMemories.workspaceId, workspaceId),
          eq(aiMemories.isActive, true),
          or(
            // User's private memories
            and(eq(aiMemories.scope, "private"), eq(aiMemories.userId, userId)),
            // Workspace team memories
            eq(aiMemories.scope, "team")
          )
        )
      )
      .orderBy(aiMemories.createdAt);

    return NextResponse.json({ memories });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/ai/memories
// Save a memory with privacy enforcement
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  try {
    const body = await req.json();
    const { workspaceId, content, category, scope, sourceConversationId } = body;

    if (!workspaceId || !content) {
      return NextResponse.json(
        { error: "workspaceId and content are required" },
        { status: 400 }
      );
    }

    // Privacy enforcement: check source conversation visibility
    let finalScope = scope || "private";
    let finalUserId: number | null = userId;

    if (sourceConversationId) {
      const [conv] = await db
        .select({ visibility: aiConversations.visibility })
        .from(aiConversations)
        .where(eq(aiConversations.id, sourceConversationId))
        .limit(1);

      if (conv?.visibility === "private") {
        // Private conversations can ONLY produce private memories
        finalScope = "private";
        finalUserId = userId;
      } else if (finalScope === "team") {
        // Team conversation → team memory (userId = null)
        finalUserId = null;
      } else {
        // Team conversation, user chose private
        finalUserId = userId;
      }
    }

    // Enforce 50-memory cap per user per workspace
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiMemories)
      .where(
        and(
          eq(aiMemories.workspaceId, workspaceId),
          eq(aiMemories.isActive, true),
          finalUserId !== null
            ? and(eq(aiMemories.scope, "private"), eq(aiMemories.userId, userId))
            : eq(aiMemories.scope, "team")
        )
      );

    if ((countResult?.count || 0) >= 50) {
      return NextResponse.json(
        { error: "Memory limit reached (50). Archive old memories to save new ones." },
        { status: 400 }
      );
    }

    const [memory] = await db
      .insert(aiMemories)
      .values({
        workspaceId,
        userId: finalUserId,
        scope: finalScope,
        category: category || "fact",
        content: content.slice(0, 500),
        sourceConversationId: sourceConversationId || null,
      })
      .returning();

    return NextResponse.json({ memory });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
