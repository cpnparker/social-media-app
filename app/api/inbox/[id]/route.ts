import { NextRequest, NextResponse } from "next/server";
import { lateApiFetch } from "@/lib/late";
import { auth } from "@/lib/auth";

// GET /api/inbox/[id] — get conversation messages
export async function GET(
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
  // This route had NO authentication: it reads (or writes) connected client
  // social accounts via the Late API. Same class of hole as /api/analytics/export.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
