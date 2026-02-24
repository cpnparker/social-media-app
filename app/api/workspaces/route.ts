import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { auth } from "@/lib/auth";

// POST /api/workspaces — create a new workspace
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name } = await req.json();

    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    const baseSlug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

    const { data: workspace, error: createErr } = await supabase
      .from("workspaces")
      .insert({
        name,
        slug: baseSlug,
      })
      .select()
      .single();

    if (createErr) throw createErr;

    // Update slug with id prefix
    const slug = `${baseSlug}-${workspace.id.slice(0, 8)}`;

    const { data: updatedWorkspace, error: updateErr } = await supabase
      .from("workspaces")
      .update({ slug })
      .eq("id", workspace.id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Add the current user as owner
    await supabase.from("workspace_members").insert({
      workspace_id: workspace.id,
      user_id: parseInt(session.user.id, 10),
      role: "owner",
      joined_at: new Date().toISOString(),
    });

    return NextResponse.json({ workspace: updatedWorkspace }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
