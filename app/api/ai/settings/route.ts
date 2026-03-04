import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getAvailableModels } from "@/lib/ai/providers";

// GET /api/ai/settings — get workspace AI settings
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    const { data: workspace, error } = await supabase
      .from("workspaces")
      .select("ai_model")
      .eq("id", workspaceId)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      currentModel: workspace?.ai_model || "claude-sonnet-4-20250514",
      availableModels: getAvailableModels(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/ai/settings — update workspace AI model
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { workspaceId, model } = body;

    if (!workspaceId || !model) {
      return NextResponse.json(
        { error: "workspaceId and model are required" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("workspaces")
      .update({ ai_model: model, updated_at: new Date().toISOString() })
      .eq("id", workspaceId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, model });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
