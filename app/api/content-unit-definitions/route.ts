import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentUnitDefinitions } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// GET /api/content-unit-definitions?category=blogs
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");

    const resolved = await resolveWorkspaceAndUser();

    const conditions = [eq(contentUnitDefinitions.workspaceId, resolved.workspaceId)];
    if (category) {
      conditions.push(eq(contentUnitDefinitions.category, category as any));
    }

    const definitions = await db
      .select()
      .from(contentUnitDefinitions)
      .where(and(...conditions))
      .orderBy(asc(contentUnitDefinitions.category), asc(contentUnitDefinitions.sortOrder));

    return NextResponse.json({ definitions });
  } catch (error: any) {
    console.error("Content unit definitions GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/content-unit-definitions
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.category || !body.formatName || body.defaultContentUnits === undefined) {
      return NextResponse.json(
        { error: "category, formatName, and defaultContentUnits are required" },
        { status: 400 }
      );
    }

    const resolved = await resolveWorkspaceAndUser(body.workspaceId);

    const [definition] = await db
      .insert(contentUnitDefinitions)
      .values({
        workspaceId: resolved.workspaceId,
        category: body.category,
        formatName: body.formatName,
        description: body.description || null,
        defaultContentUnits: body.defaultContentUnits,
        isActive: body.isActive ?? true,
        sortOrder: body.sortOrder ?? 0,
      })
      .returning();

    return NextResponse.json({ definition });
  } catch (error: any) {
    console.error("Content unit definitions POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
