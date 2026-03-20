import { NextRequest, NextResponse } from "next/server";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { requireAuth } from "@/lib/permissions";

/**
 * GET /api/ai/client-context?clientId=123
 *
 * Returns the AI client context for a specific client.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");

  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  try {
    const { data, error } = await intelligenceDb
      .from("ai_client_context")
      .select("*")
      .eq("id_client", parseInt(clientId))
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ context: data });
  } catch (err: any) {
    console.error("[ClientContext API] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
