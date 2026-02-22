import { NextRequest, NextResponse } from "next/server";
import { lateApiFetch } from "@/lib/late";

// GET /api/inbox/[id] — get conversation messages
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const data = await lateApiFetch(
      `/inbox/conversations/${params.id}/messages`
    );
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/inbox/[id] — update conversation status (archive/activate)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const data = await lateApiFetch(`/inbox/conversations/${params.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
