import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
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
  const search = searchParams.get("search");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    let query = supabase
      .from("ai_conversations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(limit);

    // Visibility filtering
    if (visibility === "private") {
      query = query.eq("visibility", "private").eq("created_by", userId);
    } else if (visibility === "team") {
      query = query.eq("visibility", "team");
    } else {
      // Default: user's private + all team conversations
      query = query.or(
        `and(visibility.eq.private,created_by.eq.${userId}),visibility.eq.team`
      );
    }

    if (contentObjectId) {
      query = query.eq("content_object_id", parseInt(contentObjectId, 10));
    }

    if (search) {
      query = query.ilike("title", `%${search}%`);
    }

    const { data: conversations, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ conversations: conversations || [] });
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
      const { data: ws } = await supabase
        .from("workspaces")
        .select("ai_model")
        .eq("id", workspaceId)
        .single();
      aiModel = ws?.ai_model || "claude-sonnet-4-20250514";
    }

    const { data: conversation, error } = await supabase
      .from("ai_conversations")
      .insert({
        workspace_id: workspaceId,
        created_by: userId,
        title: title || "New Conversation",
        visibility: visibility || "private",
        content_object_id: contentObjectId
          ? parseInt(String(contentObjectId), 10)
          : null,
        model: aiModel,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ conversation });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
