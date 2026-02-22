import { NextRequest, NextResponse } from "next/server";
import { lateApiFetch } from "@/lib/late";

// GET /api/queue — list queue slots
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const profileId = searchParams.get("profileId");

  try {
    let endpoint = "/queue";
    if (profileId) endpoint += `?profileId=${profileId}`;
    const data = await lateApiFetch(endpoint);
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/queue — create a queue slot
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = await lateApiFetch("/queue", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
