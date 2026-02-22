import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { profileLinks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// POST /api/profile-links/reorder — bulk update sort order
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

    // Update each link's sortOrder to match its position in the array
    await Promise.all(
      orderedIds.map((id: string, index: number) =>
        db
          .update(profileLinks)
          .set({ sortOrder: index })
          .where(eq(profileLinks.id, id))
      )
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
