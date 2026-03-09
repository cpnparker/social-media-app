import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";

// PATCH /api/ai/memories/[id] — update a memory
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const { id } = await params;

  try {
    // Fetch memory and verify ownership
    const { data: memory } = await intelligenceDb
      .from("ai_memories")
      .select("*")
      .eq("id_memory", id)
      .maybeSingle();

    if (!memory) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    // Ownership check: private memories must belong to this user
    if (memory.type_scope === "private" && memory.user_memory !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Team memories require admin/owner role in the workspace
    if (memory.type_scope === "team") {
      const memberRole = await verifyWorkspaceMembership(userId, memory.id_workspace);
      if (!memberRole || !["owner", "admin"].includes(memberRole)) {
        return NextResponse.json({ error: "Admin access required to edit team memories" }, { status: 403 });
      }
    }

    const body = await req.json();
    const updateData: Record<string, any> = { date_updated: new Date().toISOString() };

    if (body.content !== undefined) updateData.information_content = body.content.slice(0, 500);
    if (body.category !== undefined) updateData.type_category = body.category;
    if (body.isActive !== undefined) updateData.flag_active = body.isActive ? 1 : 0;

    await intelligenceDb
      .from("ai_memories")
      .update(updateData)
      .eq("id_memory", id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/ai/memories/[id] — hard delete a memory
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const { id } = await params;

  try {
    const { data: memory } = await intelligenceDb
      .from("ai_memories")
      .select("*")
      .eq("id_memory", id)
      .maybeSingle();

    if (!memory) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    if (memory.type_scope === "private" && memory.user_memory !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Team memories require admin/owner role in the workspace
    if (memory.type_scope === "team") {
      const memberRole = await verifyWorkspaceMembership(userId, memory.id_workspace);
      if (!memberRole || !["owner", "admin"].includes(memberRole)) {
        return NextResponse.json({ error: "Admin access required to delete team memories" }, { status: 403 });
      }
    }

    await intelligenceDb
      .from("ai_memories")
      .delete()
      .eq("id_memory", id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
