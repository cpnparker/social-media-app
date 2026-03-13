import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { searchForRfps } from "@/lib/rfp/search";

export const maxDuration = 120; // Web search can take a while

// POST /api/rfp/discover
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  try {
    const body = await req.json();
    const { workspaceId, query, sectors, regions, provider, sources } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await searchForRfps({ query, sectors, regions, sources, provider });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[RFP Discover] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
