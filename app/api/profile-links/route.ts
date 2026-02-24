import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// Helper: snake_case → camelCase
function transformLink(row: any) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    url: row.url,
    description: row.description,
    icon: row.icon,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

// GET /api/profile-links — list all links for workspace
export async function GET() {
  try {
    const { workspaceId } = await resolveWorkspaceAndUser();

    const { data: links, error } = await supabase
      .from("profile_links")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    return NextResponse.json({
      links: (links || []).map(transformLink),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/profile-links — create a new link
export async function POST(req: NextRequest) {
  try {
    const { workspaceId } = await resolveWorkspaceAndUser();
    const body = await req.json();

    if (!body.title?.trim() || !body.url?.trim()) {
      return NextResponse.json(
        { error: "title and url are required" },
        { status: 400 }
      );
    }

    // Calculate next sortOrder
    const { data: maxRows } = await supabase
      .from("profile_links")
      .select("sort_order")
      .eq("workspace_id", workspaceId)
      .order("sort_order", { ascending: false })
      .limit(1);

    const nextOrder = ((maxRows?.[0]?.sort_order ?? -1) as number) + 1;

    const { data: link, error } = await supabase
      .from("profile_links")
      .insert({
        workspace_id: workspaceId,
        title: body.title.trim(),
        url: body.url.trim(),
        description: body.description?.trim() || null,
        icon: body.icon || null,
        sort_order: nextOrder,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ link: transformLink(link) }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
