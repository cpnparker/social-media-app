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

    // Never expose the API key in responses — only indicate if one is set
    const { late_api_key, ...safeWorkspace } = workspace;
    return NextResponse.json({
      workspace: {
        ...safeWorkspace,
        hasLateApiKey: !!late_api_key,
      },
    });
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

    // Never expose the API key in responses
    const { late_api_key: _key, ...safeUpdated } = updated;
    return NextResponse.json({
      workspace: {
        ...safeUpdated,
        hasLateApiKey: !!_key,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
