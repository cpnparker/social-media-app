import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentObjects, productionTasks, posts, contentPerformance, ideas, promoDrafts, customers, contracts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// GET /api/content-objects/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [obj] = await db.select().from(contentObjects).where(eq(contentObjects.id, id)).limit(1);

    if (!obj) {
      return NextResponse.json({ error: "Content object not found" }, { status: 404 });
    }

    // Fetch linked data
    const [linkedIdea] = obj.ideaId
      ? await db.select().from(ideas).where(eq(ideas.id, obj.ideaId)).limit(1)
      : [null];

    const tasks = await db
      .select()
      .from(productionTasks)
      .where(eq(productionTasks.contentObjectId, id));

    const linkedPosts = await db
      .select()
      .from(posts)
      .where(eq(posts.contentObjectId, id));

    const [perf] = await db
      .select()
      .from(contentPerformance)
      .where(eq(contentPerformance.contentObjectId, id))
      .limit(1);

    const drafts = await db
      .select()
      .from(promoDrafts)
      .where(eq(promoDrafts.contentObjectId, id));

    // Fetch customer and contract if assigned
    let customer = null;
    if (obj.customerId) {
      const [c] = await db.select().from(customers).where(eq(customers.id, obj.customerId)).limit(1);
      customer = c || null;
    }

    let contract = null;
    if (obj.contractId) {
      const [ct] = await db.select().from(contracts).where(eq(contracts.id, obj.contractId)).limit(1);
      contract = ct || null;
    }

    return NextResponse.json({
      contentObject: obj,
      idea: linkedIdea || null,
      customer,
      contract,
      tasks,
      posts: linkedPosts,
      performance: perf || null,
      promoDrafts: drafts,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/content-objects/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const updateData: any = { updatedAt: new Date() };
    const fields = [
      "workingTitle", "finalTitle", "body", "contentType", "status",
      "assignedWriterId", "assignedEditorId", "assignedProducerId",
      "formatTags", "campaignTags", "evergreenFlag",
      "externalDocUrl", "socialCopyDocUrl",
      "customerId", "contractId", "contentUnits",
    ];

    for (const field of fields) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }

    if (body.status === "published" && !body.publishedAt) {
      updateData.publishedAt = new Date();
    }

    const [updated] = await db
      .update(contentObjects)
      .set(updateData)
      .where(eq(contentObjects.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Content object not found" }, { status: 404 });
    }

    return NextResponse.json({ contentObject: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/content-objects/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Tasks cascade-delete via FK
    const [deleted] = await db
      .delete(contentObjects)
      .where(eq(contentObjects.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Content object not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
