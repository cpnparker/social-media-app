import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promoDrafts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// PUT /api/promo-drafts/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const updateData: any = { updatedAt: new Date() };

    if (body.content !== undefined) updateData.content = body.content;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.mediaUrls !== undefined) updateData.mediaUrls = body.mediaUrls;

    const [updated] = await db
      .update(promoDrafts)
      .set(updateData)
      .where(eq(promoDrafts.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "Promo draft not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ draft: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/promo-drafts/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [deleted] = await db
      .delete(promoDrafts)
      .where(eq(promoDrafts.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { error: "Promo draft not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
