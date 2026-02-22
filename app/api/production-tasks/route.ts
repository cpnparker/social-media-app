import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { productionTasks } from "@/lib/db/schema";
import { eq, desc, asc, and } from "drizzle-orm";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// GET /api/production-tasks
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contentObjectId = searchParams.get("contentObjectId");
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const assignedTo = searchParams.get("assignedTo");
  const limit = parseInt(searchParams.get("limit") || "100");

  try {
    const conditions: any[] = [];

    if (contentObjectId) conditions.push(eq(productionTasks.contentObjectId, contentObjectId));
    if (status) conditions.push(eq(productionTasks.status, status as any));
    if (priority) conditions.push(eq(productionTasks.priority, priority as any));
    if (assignedTo) conditions.push(eq(productionTasks.assignedTo, assignedTo));

    let query = db.select().from(productionTasks);

    if (conditions.length === 1) {
      query = query.where(conditions[0]) as any;
    } else if (conditions.length > 1) {
      query = query.where(and(...conditions)) as any;
    }

    const rows = await (query as any).orderBy(asc(productionTasks.sortOrder), desc(productionTasks.createdAt)).limit(limit);

    return NextResponse.json({ tasks: rows });
  } catch (error: any) {
    console.error("Production tasks GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/production-tasks
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.contentObjectId || !body.title) {
      return NextResponse.json(
        { error: "contentObjectId and title are required" },
        { status: 400 }
      );
    }

    const resolved = await resolveWorkspaceAndUser(body.workspaceId, body.createdBy);

    const [task] = await db
      .insert(productionTasks)
      .values({
        contentObjectId: body.contentObjectId,
        workspaceId: resolved.workspaceId,
        title: body.title,
        description: body.description || null,
        assignedTo: body.assignedTo || null,
        status: body.status || "todo",
        priority: body.priority || "medium",
        sortOrder: body.sortOrder ?? 0,
        templateId: body.templateId || null,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        createdBy: resolved.createdBy,
      })
      .returning();

    return NextResponse.json({ task });
  } catch (error: any) {
    console.error("Production tasks POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
