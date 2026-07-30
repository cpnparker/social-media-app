import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { requireAuth } from "@/lib/permissions";
import { processClientContext } from "@/lib/ai/client-context-extract";

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

/**
 * POST /api/ai/client-context
 *
 * Trigger an immediate re-processing of a client's context profile.
 * Called automatically when client assets are added or deleted.
 *
 * Body: { clientId: number }
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await req.json();
    const clientId = parseInt(body.clientId);

    if (!clientId || isNaN(clientId)) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    // Get workspace ID
    const { data: wsRow } = await intelligenceDb
      .from("ai_settings")
      .select("id_workspace")
      .limit(1)
      .maybeSingle();

    if (!wsRow?.id_workspace) {
      return NextResponse.json({ error: "No workspace found" }, { status: 500 });
    }

    // Get client name
    const { data: client } = await supabase
      .from("app_clients")
      .select("name_client")
      .eq("id_client", clientId)
      .maybeSingle();

    const result = await processClientContext(
      wsRow.id_workspace,
      clientId,
      client?.name_client
    );

    return NextResponse.json({
      clientId,
      name: client?.name_client || `Client ${clientId}`,
      filesProcessed: result.processed,
      filesTotal: result.total,
      skipped: result.skipped || [],
      error: result.error || null,
    });
  } catch (err: any) {
    console.error("[ClientContext Refresh] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
