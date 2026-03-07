import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiMemories } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

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
    const [memory] = await db
      .select()
      .from(aiMemories)
      .where(eq(aiMemories.id, id))
      .limit(1);

    if (!memory) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    // Ownership check: private memories must belong to this user
    if (memory.scope === "private" && memory.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const updateData: Record<string, any> = { updatedAt: new Date() };

    if (body.content !== undefined) updateData.content = body.content.slice(0, 500);
    if (body.category !== undefined) updateData.category = body.category;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    await db
      .update(aiMemories)
      .set(updateData)
      .where(eq(aiMemories.id, id));

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
    const [memory] = await db
      .select()
      .from(aiMemories)
      .where(eq(aiMemories.id, id))
      .limit(1);

    if (!memory) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    if (memory.scope === "private" && memory.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await db.delete(aiMemories).where(eq(aiMemories.id, id));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
