import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { profileLinks } from "@/lib/db/schema";
import { eq, asc, sql } from "drizzle-orm";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// GET /api/profile-links — list all links for workspace
export async function GET() {
  try {
    const { workspaceId } = await resolveWorkspaceAndUser();

    const links = await db
      .select()
      .from(profileLinks)
      .where(eq(profileLinks.workspaceId, workspaceId))
      .orderBy(asc(profileLinks.sortOrder));

    return NextResponse.json({ links });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/profile-links — create a new link
export async function POST(req: NextRequest) {
  try {
    const { workspaceId } = await resolveWorkspaceAndUser();
    const body = await req.json();

    if (!body.title?.trim() || !body.url?.trim()) {
      return NextResponse.json(
        { error: "title and url are required" },
        { status: 400 }
      );
    }

    // Calculate next sortOrder
    const [maxResult] = await db
      .select({ maxOrder: sql<number>`coalesce(max(${profileLinks.sortOrder}), -1)` })
      .from(profileLinks)
      .where(eq(profileLinks.workspaceId, workspaceId));

    const nextOrder = (maxResult?.maxOrder ?? -1) + 1;

    const [link] = await db
      .insert(profileLinks)
      .values({
        workspaceId,
        title: body.title.trim(),
        url: body.url.trim(),
        description: body.description?.trim() || null,
        icon: body.icon || null,
        sortOrder: nextOrder,
      })
      .returning();

    return NextResponse.json({ link }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
