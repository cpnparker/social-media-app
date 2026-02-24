import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentUnitDefinitions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";
import { defaultContentUnitDefinitions } from "@/lib/seed-content-units";

// POST /api/content-unit-definitions/seed
export async function POST(req: NextRequest) {
  try {
    const resolved = await resolveWorkspaceAndUser();

    // Check if definitions already exist for this workspace
    const existing = await db
      .select()
      .from(contentUnitDefinitions)
      .where(eq(contentUnitDefinitions.workspaceId, resolved.workspaceId))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({ seeded: false, message: "Definitions already exist" });
    }

    // Insert all default definitions with the workspace ID
    const rows = defaultContentUnitDefinitions.map((def) => ({
      ...def,
      workspaceId: resolved.workspaceId,
    }));

    await db.insert(contentUnitDefinitions).values(rows);

    return NextResponse.json({ seeded: true, count: rows.length });
  } catch (error: any) {
    console.error("Content unit definitions seed error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
