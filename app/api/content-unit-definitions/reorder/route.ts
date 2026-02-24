import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentUnitDefinitions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// POST /api/content-unit-definitions/reorder
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderedIds } = body;

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return NextResponse.json(
        { error: "orderedIds array is required" },
        { status: 400 }
      );
    }

    // Update sortOrder for each definition to match its index
    await Promise.all(
      orderedIds.map((id: string, index: number) =>
        db
          .update(contentUnitDefinitions)
          .set({ sortOrder: index })
          .where(eq(contentUnitDefinitions.id, id))
      )
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Content unit definitions reorder error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
