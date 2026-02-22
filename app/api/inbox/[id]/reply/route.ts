import { NextRequest, NextResponse } from "next/server";
import { lateApiFetch } from "@/lib/late";

// POST /api/inbox/[id]/reply — send a reply to a conversation
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();

    const data = await lateApiFetch(`/inbox/conversations/${params.id}/messages`, {
      method: "POST",
      body: JSON.stringify({
        text: body.text,
        attachments: body.attachments,
      }),
    });

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
