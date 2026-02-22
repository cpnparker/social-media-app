import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ideas } from "@/lib/db/schema";
import { eq, desc, asc, sql } from "drizzle-orm";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// GET /api/ideas — list ideas
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const topic = searchParams.get("topic");
  const sortBy = searchParams.get("sortBy") || "date";
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    let query = db.select().from(ideas);
    const conditions: any[] = [];

    if (status) {
      conditions.push(eq(ideas.status, status as any));
    }

    if (topic) {
      conditions.push(sql`${ideas.topicTags} @> ARRAY[${topic}]::text[]`);
    }

    if (conditions.length > 0) {
      query = query.where(conditions.length === 1 ? conditions[0] : sql`${conditions[0]} AND ${conditions[1]}`) as any;
    }

    const orderCol =
      sortBy === "score"
        ? desc(ideas.predictedEngagementScore)
        : sortBy === "status"
        ? asc(ideas.status)
        : desc(ideas.createdAt);

    const rows = await (query as any).orderBy(orderCol).limit(limit).offset(offset);

    return NextResponse.json({ ideas: rows });
  } catch (error: any) {
    console.error("Ideas GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/ideas — create idea
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, description, sourceType, topicTags, strategicTags, createdBy, workspaceId } = body;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const resolved = await resolveWorkspaceAndUser(workspaceId, createdBy);

    const [idea] = await db
      .insert(ideas)
      .values({
        workspaceId: resolved.workspaceId,
        title,
        description: description || null,
        sourceType: sourceType || "manual",
        topicTags: topicTags || [],
        strategicTags: strategicTags || [],
        createdBy: resolved.createdBy,
      })
      .returning();

    return NextResponse.json({ idea });
  } catch (error: any) {
    console.error("Ideas POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
