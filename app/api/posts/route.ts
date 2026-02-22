import { NextRequest, NextResponse } from "next/server";
import { lateApiFetch } from "@/lib/late";

// GET /api/posts — list posts
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const page = searchParams.get("page") || "1";
  const limit = searchParams.get("limit") || "20";

  try {
    let endpoint = `/posts?page=${page}&limit=${limit}`;
    if (status) endpoint += `&status=${status}`;

    const data = await lateApiFetch(endpoint);
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/posts — create a new post
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const postPayload: any = {
      content: body.content,
      platforms: body.platforms, // [{platform, accountId, content?}]
    };

    if (body.mediaUrls?.length) {
      postPayload.mediaUrls = body.mediaUrls;
    }

    if (body.publishNow) {
      postPayload.publishNow = true;
    } else if (body.scheduledFor) {
      postPayload.scheduledFor = body.scheduledFor;
      postPayload.timezone = body.timezone || "UTC";
    }

    const data = await lateApiFetch("/posts", {
      method: "POST",
      body: JSON.stringify(postPayload),
    });

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
