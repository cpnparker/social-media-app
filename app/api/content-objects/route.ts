import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentObjects, productionTasks } from "@/lib/db/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// GET /api/content-objects
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contentType = searchParams.get("contentType");
  const ideaId = searchParams.get("ideaId");
  const customerId = searchParams.get("customerId");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    const { workspaceId } = await resolveWorkspaceAndUser();

    const conditions: any[] = [];

    conditions.push(eq(contentObjects.workspaceId, workspaceId));

    if (contentType) conditions.push(eq(contentObjects.contentType, contentType as any));
    if (ideaId) conditions.push(eq(contentObjects.ideaId, ideaId));
    if (customerId) conditions.push(eq(contentObjects.customerId, customerId));

    // Query content objects with task progress counts via subqueries
    const totalTasksSq = sql<number>`(SELECT count(*) FROM production_tasks WHERE production_tasks.content_object_id = content_objects.id)`.as("total_tasks");
    const doneTasksSq = sql<number>`(SELECT count(*) FROM production_tasks WHERE production_tasks.content_object_id = content_objects.id AND production_tasks.status = 'done')`.as("done_tasks");

    // Customer name subquery
    const customerNameSq = sql<string>`(SELECT name FROM customers WHERE customers.id = content_objects.customer_id)`.as("customer_name");

    let query = db
      .select({
        id: contentObjects.id,
        ideaId: contentObjects.ideaId,
        workspaceId: contentObjects.workspaceId,
        contentType: contentObjects.contentType,
        workingTitle: contentObjects.workingTitle,
        finalTitle: contentObjects.finalTitle,
        status: contentObjects.status,
        formatTags: contentObjects.formatTags,
        campaignTags: contentObjects.campaignTags,
        evergreenFlag: contentObjects.evergreenFlag,
        createdAt: contentObjects.createdAt,
        updatedAt: contentObjects.updatedAt,
        customerId: contentObjects.customerId,
        contractId: contentObjects.contractId,
        contentUnits: contentObjects.contentUnits,
        totalTasks: totalTasksSq,
        doneTasks: doneTasksSq,
        customerName: customerNameSq,
      })
      .from(contentObjects);

    if (conditions.length === 1) {
      query = query.where(conditions[0]) as any;
    } else if (conditions.length > 1) {
      query = query.where(and(...conditions)) as any;
    }

    const rows = await (query as any).orderBy(desc(contentObjects.updatedAt)).limit(limit).offset(offset);

    return NextResponse.json({ contentObjects: rows });
  } catch (error: any) {
    console.error("Content objects GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/content-objects
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.ideaId) {
      return NextResponse.json(
        { error: "ideaId is required — content must be commissioned from an idea" },
        { status: 400 }
      );
    }

    const resolved = await resolveWorkspaceAndUser(body.workspaceId, body.createdBy);

    const [obj] = await db
      .insert(contentObjects)
      .values({
        ideaId: body.ideaId,
        workspaceId: resolved.workspaceId,
        contentType: body.contentType || "article",
        workingTitle: body.workingTitle || body.title || "Untitled",
        finalTitle: body.finalTitle || null,
        body: body.body || "",
        externalDocUrl: body.externalDocUrl || null,
        socialCopyDocUrl: body.socialCopyDocUrl || null,
        status: body.status || "draft",
        assignedWriterId: body.assignedWriterId || null,
        assignedEditorId: body.assignedEditorId || null,
        assignedProducerId: body.assignedProducerId || null,
        formatTags: body.formatTags || [],
        campaignTags: body.campaignTags || [],
        evergreenFlag: body.evergreenFlag || false,
        createdBy: resolved.createdBy,
        customerId: body.customerId || null,
        contractId: body.contractId || null,
        contentUnits: body.contentUnits ? parseFloat(body.contentUnits) : null,
      })
      .returning();

    return NextResponse.json({ contentObject: obj });
  } catch (error: any) {
    console.error("Content objects POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
