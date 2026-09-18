import { NextRequest, NextResponse } from "next/server";
import { lateApiFetch } from "@/lib/late";
import { auth } from "@/lib/auth";

// GET /api/inbox — list conversations, comments, and reviews
export async function GET(req: NextRequest) {
  // This route had NO authentication: it reads (or writes) connected client
  // social accounts via the Late API. Same class of hole as /api/analytics/export.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "conversations";
  const limit = searchParams.get("limit") || "30";
  const status = searchParams.get("status");

  try {
    let data;

    switch (type) {
      case "conversations": {
        const endpoint = `/inbox/conversations?limit=${limit}${status ? `&status=${status}` : ""}`;
        data = await lateApiFetch(endpoint);
        break;
      }
      case "comments": {
        const endpoint = `/inbox/comments?limit=${limit}`;
        data = await lateApiFetch(endpoint);
        break;
      }
      case "reviews": {
        const endpoint = `/inbox/reviews?limit=${limit}`;
        data = await lateApiFetch(endpoint);
        break;
      }
      default:
        return NextResponse.json(
          { error: "Invalid type. Use: conversations, comments, or reviews" },
          { status: 400 }
        );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
