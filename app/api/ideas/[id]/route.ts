import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ideas, contentObjects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// GET /api/ideas/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [idea] = await db.select().from(ideas).where(eq(ideas.id, id)).limit(1);

    if (!idea) {
      return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }

    // Count linked content objects
    const linkedContent = await db
      .select()
      .from(contentObjects)
      .where(eq(contentObjects.ideaId, id));

    return NextResponse.json({
      idea,
      contentObjectCount: linkedContent.length,
      contentObjects: linkedContent,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/ideas/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const updateData: any = { updatedAt: new Date() };
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.topicTags !== undefined) updateData.topicTags = body.topicTags;
    if (body.strategicTags !== undefined) updateData.strategicTags = body.strategicTags;
    if (body.eventTags !== undefined) updateData.eventTags = body.eventTags;
    if (body.imageUrl !== undefined) updateData.imageUrl = body.imageUrl;
    if (body.predictedEngagementScore !== undefined)
      updateData.predictedEngagementScore = body.predictedEngagementScore;
    if (body.authorityScore !== undefined) updateData.authorityScore = body.authorityScore;
    if (body.sourceType !== undefined) updateData.sourceType = body.sourceType;

    const [updated] = await db
      .update(ideas)
      .set(updateData)
      .where(eq(ideas.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }

    return NextResponse.json({ idea: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/ideas/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check for commissioned content objects
    const linkedContent = await db
      .select()
      .from(contentObjects)
      .where(eq(contentObjects.ideaId, id));

    if (linkedContent.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete idea with linked content objects" },
        { status: 400 }
      );
    }

    const [deleted] = await db.delete(ideas).where(eq(ideas.id, id)).returning();

    if (!deleted) {
      return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
