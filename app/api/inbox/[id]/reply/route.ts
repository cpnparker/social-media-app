import { NextRequest, NextResponse } from "next/server";
import { lateApiFetch } from "@/lib/late";
import { auth } from "@/lib/auth";

// POST /api/inbox/[id]/reply — send a reply to a conversation
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // This route had NO authentication: it reads (or writes) connected client
  // social accounts via the Late API. Same class of hole as /api/analytics/export.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
