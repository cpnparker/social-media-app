import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ideas, contentObjects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createTasksFromTemplates } from "@/lib/task-template-utils";

// POST /api/ideas/[id]/commission — commission an idea into a content object
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    // Fetch the idea
    const [idea] = await db.select().from(ideas).where(eq(ideas.id, id)).limit(1);

    if (!idea) {
      return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }

    // Update idea status to commissioned
    await db
      .update(ideas)
      .set({ status: "commissioned", updatedAt: new Date() })
      .where(eq(ideas.id, id));

    // Create a content object linked to this idea
    const [contentObject] = await db
      .insert(contentObjects)
      .values({
        ideaId: id,
        workspaceId: idea.workspaceId,
        contentType: body.contentType || "article",
        workingTitle: idea.title,
        body: idea.description || "",
        status: "draft",
        formatTags: idea.topicTags || [],
        campaignTags: idea.strategicTags || [],
        createdBy: body.createdBy || idea.createdBy,
      })
      .returning();

    // Auto-create production tasks from templates for this content type
    const contentType = body.contentType || "article";
    await createTasksFromTemplates(
      contentObject.id,
      contentType,
      idea.workspaceId,
      body.createdBy || idea.createdBy
    );

    return NextResponse.json({ contentObject, idea: { ...idea, status: "commissioned" } });
  } catch (error: any) {
    console.error("Commission error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
