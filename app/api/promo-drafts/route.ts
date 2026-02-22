import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promoDrafts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// GET /api/promo-drafts?contentObjectId=xxx
export async function GET(req: NextRequest) {
  try {
    const contentObjectId = req.nextUrl.searchParams.get("contentObjectId");

    if (!contentObjectId) {
      return NextResponse.json(
        { error: "contentObjectId is required" },
        { status: 400 }
      );
    }

    const { workspaceId } = await resolveWorkspaceAndUser();

    const drafts = await db
      .select()
      .from(promoDrafts)
      .where(
        and(
          eq(promoDrafts.contentObjectId, contentObjectId),
          eq(promoDrafts.workspaceId, workspaceId)
        )
      );

    return NextResponse.json({ drafts });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/promo-drafts — batch insert drafts
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { contentObjectId, drafts: draftItems } = body;

    if (!contentObjectId || !draftItems?.length) {
      return NextResponse.json(
        { error: "contentObjectId and drafts array are required" },
        { status: 400 }
      );
    }

    const { workspaceId } = await resolveWorkspaceAndUser(body.workspaceId);

    const rows = draftItems.map((d: any) => ({
      contentObjectId,
      workspaceId,
      platform: d.platform,
      content: d.content,
      mediaUrls: d.mediaUrls || null,
      generatedByAi: d.generatedByAi ?? true,
    }));

    const inserted = await db.insert(promoDrafts).values(rows).returning();

    return NextResponse.json({ drafts: inserted });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
