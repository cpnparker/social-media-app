import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { processClientContext } from "@/lib/ai/client-context-extract";

export const maxDuration = 300;

/**
 * GET /api/cron/client-context — Vercel Cron handler
 *
 * Scans all clients with asset files and processes those whose assets
 * have changed since the last processing run. Creates/updates the
 * consolidated AI client context profile in intelligence.ai_client_context.
 *
 * Schedule: every 2 hours (0 *​/2 * * *)
 */
export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Get all clients that have at least one asset file
    const { data: clientsWithAssets, error: clientsErr } = await supabase
      .from("app_assets_clients")
      .select("id_client")
      .not("id_file", "is", null);

    if (clientsErr) throw clientsErr;
    if (!clientsWithAssets || clientsWithAssets.length === 0) {
      return NextResponse.json({ message: "No clients with assets" });
    }

    // Deduplicate client IDs
    const clientIds = Array.from(new Set(clientsWithAssets.map((r: any) => r.id_client)));

    // 2. Get client names for better logging and profile generation
    const { data: clients } = await supabase
      .from("app_clients")
      .select("id_client, name_client")
      .in("id_client", clientIds);

    const clientNameMap = new Map(
      (clients || []).map((c: any) => [c.id_client, c.name_client])
    );

    // 3. Get existing context records to check freshness
    const { data: existingContexts } = await intelligenceDb
      .from("ai_client_context")
      .select("id_client, date_last_processed");

    const lastProcessedMap = new Map(
      (existingContexts || []).map((c: any) => [
        c.id_client,
        new Date(c.date_last_processed),
      ])
    );

    // 4. For each client, check if assets have been updated since last processing
    const results: { clientId: number; name: string; status: string; files?: number }[] = [];
    let processedCount = 0;

    // Get the workspace ID from ai_settings (there's typically one workspace)
    const { data: wsRow } = await intelligenceDb
      .from("ai_settings")
      .select("id_workspace")
      .limit(1)
      .maybeSingle();

    const workspaceId = wsRow?.id_workspace;
    if (!workspaceId) {
      return NextResponse.json({ error: "No workspace found" }, { status: 500 });
    }

    for (const clientId of clientIds) {
      const lastProcessed = lastProcessedMap.get(clientId);

      // Check if any assets are newer than last processing
      if (lastProcessed) {
        const { data: newerAssets } = await supabase
          .from("app_assets_clients")
          .select("id_asset")
          .eq("id_client", clientId)
          .gt("date_created", lastProcessed.toISOString())
          .limit(1);

        if (!newerAssets || newerAssets.length === 0) {
          results.push({
            clientId,
            name: clientNameMap.get(clientId) || `Client ${clientId}`,
            status: "fresh",
          });
          continue;
        }
      }

      // Process this client
      const clientName = clientNameMap.get(clientId) || undefined;
      const result = await processClientContext(workspaceId, clientId, clientName);

      results.push({
        clientId,
        name: clientNameMap.get(clientId) || `Client ${clientId}`,
        status: result.error ? "error" : result.processed > 0 ? "processed" : "no-content",
        files: result.processed,
      });

      if (result.processed > 0) processedCount++;
    }

    return NextResponse.json({
      totalClients: clientIds.length,
      processed: processedCount,
      results,
    });
  } catch (error: any) {
    console.error("[ClientContext Cron] Fatal error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
