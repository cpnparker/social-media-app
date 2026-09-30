import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";

// GET /api/rfp/searches/:id
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  try {
    const { data, error } = await intelligenceDb
      .from("rfp_searches")
      .select("*")
      .eq("id_search", params.id)
      .single();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Search not found" }, { status: 404 });
    }

    // Verify workspace membership
    const memberRole = await verifyWorkspaceMembership(userId, data.id_workspace);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ search: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
