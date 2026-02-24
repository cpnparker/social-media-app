import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// GET /api/workspace — get current workspace
export async function GET() {
  try {
    const { workspaceId } = await resolveWorkspaceAndUser();
    const { data: workspace, error } = await supabase
      .from("workspaces")
      .select("*")
      .eq("id", workspaceId)
      .single();

    if (error || !workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ workspace });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/workspace — update workspace
export async function PUT(req: NextRequest) {
  try {
    const { workspaceId } = await resolveWorkspaceAndUser();
    const body = await req.json();

    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.slug !== undefined) updateData.slug = body.slug;
    if (body.plan !== undefined) updateData.plan = body.plan;
    if (body.lateApiKey !== undefined) updateData.late_api_key = body.lateApiKey;

    const { data: updated, error } = await supabase
      .from("workspaces")
      .update(updateData)
      .eq("id", workspaceId)
      .select()
      .single();

    if (error || !updated) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ workspace: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
