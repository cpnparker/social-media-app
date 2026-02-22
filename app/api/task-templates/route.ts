import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { taskTemplates } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// GET /api/task-templates?contentType=article
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contentType = searchParams.get("contentType");

  if (!contentType) {
    return NextResponse.json(
      { error: "contentType query param is required" },
      { status: 400 }
    );
  }

  try {
    const resolved = await resolveWorkspaceAndUser();

    const templates = await db
      .select()
      .from(taskTemplates)
      .where(
        and(
          eq(taskTemplates.contentType, contentType as any),
          eq(taskTemplates.workspaceId, resolved.workspaceId)
        )
      )
      .orderBy(asc(taskTemplates.sortOrder));

    return NextResponse.json({ templates });
  } catch (error: any) {
    console.error("Task templates GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/task-templates
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.contentType || !body.title) {
      return NextResponse.json(
        { error: "contentType and title are required" },
        { status: 400 }
      );
    }

    const resolved = await resolveWorkspaceAndUser(body.workspaceId);

    // Get current max sortOrder for this content type
    const existing = await db
      .select()
      .from(taskTemplates)
      .where(
        and(
          eq(taskTemplates.contentType, body.contentType as any),
          eq(taskTemplates.workspaceId, resolved.workspaceId)
        )
      )
      .orderBy(asc(taskTemplates.sortOrder));

    const maxOrder = existing.length > 0
      ? Math.max(...existing.map((t) => t.sortOrder))
      : -1;

    const [template] = await db
      .insert(taskTemplates)
      .values({
        workspaceId: resolved.workspaceId,
        contentType: body.contentType,
        title: body.title,
        description: body.description || null,
        defaultRole: body.defaultRole || "other",
        sortOrder: body.sortOrder ?? maxOrder + 1,
      })
      .returning();

    return NextResponse.json({ template });
  } catch (error: any) {
    console.error("Task templates POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
