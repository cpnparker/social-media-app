import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { processClientContext } from "@/lib/ai/client-context-extract";
import { assertNotKilled, ServiceControlError } from "@/lib/admin/service-control";

export const maxDuration = 300;

/**
 * GET /api/cron/client-context — Daily catch-all safety net
 *
 * Most processing happens in real-time via POST /api/ai/client-context
 * when assets are added/deleted. This cron catches:
 * - Assets added directly in the Engine app (bypassing our API)
 * - Asset deletions that changed the file count
 * - New clients that gained assets since last run
 * - Any missed updates
 *
 * Schedule: daily at 3am (0 3 * * *)
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await assertNotKilled("engine", "client-context");
  } catch (e) {
    if (e instanceof ServiceControlError && e.reason === "killed") {
      return NextResponse.json({ status: "disabled", reason: e.message });
    }
    throw e;
  }

  try {
    // 1. Get all clients and their current asset counts
    const { data: allAssets, error: assetsErr } = await supabase
      .from("app_assets_clients")
      .select("id_client, id_asset, date_created");

    if (assetsErr) throw assetsErr;

    // Build per-client stats: asset count + latest asset date
    const clientStats = new Map<number, { count: number; latestDate: string }>();
    for (const a of allAssets || []) {
      const existing = clientStats.get(a.id_client);
      if (!existing) {
        clientStats.set(a.id_client, { count: 1, latestDate: a.date_created });
      } else {
        existing.count++;
        if (a.date_created > existing.latestDate) {
          existing.latestDate = a.date_created;
        }
      }
    }

    // 2. Get existing context records
    const { data: existingContexts } = await intelligenceDb
      .from("ai_client_context")
      .select("id_client, units_asset_count, date_last_processed");

    const contextMap = new Map(
      (existingContexts || []).map((c: any) => [
        c.id_client,
        { count: c.units_asset_count, lastProcessed: c.date_last_processed },
      ])
    );

    // 3. Determine which clients need reprocessing
    const clientsToProcess: number[] = [];

    clientStats.forEach((stats, clientId) => {
      const existing = contextMap.get(clientId);

      if (!existing) {
        // New client with assets — never processed
        clientsToProcess.push(clientId);
      } else if (stats.count !== existing.count) {
        // Asset count changed (added or deleted)
        clientsToProcess.push(clientId);
      } else if (stats.latestDate > existing.lastProcessed) {
        // New asset added since last processing
        clientsToProcess.push(clientId);
      }
    });

    // 4. Clean up context for clients that no longer have any assets
    const activeClientIds = new Set(Array.from(clientStats.keys()));
    const orphanedContexts = (existingContexts || []).filter(
      (c: any) => !activeClientIds.has(c.id_client)
    );

    for (const orphan of orphanedContexts) {
      await intelligenceDb
        .from("ai_client_context")
        .delete()
        .eq("id_client", orphan.id_client);
      console.log(`[ClientContext Cron] Cleaned up context for removed client ${orphan.id_client}`);
    }

    if (clientsToProcess.length === 0) {
      return NextResponse.json({
        message: "All clients up to date",
        totalClients: clientStats.size,
        cleaned: orphanedContexts.length,
      });
    }

    // 5. Get workspace ID and client names
    const { data: wsRow } = await intelligenceDb
      .from("ai_settings")
      .select("id_workspace")
      .limit(1)
      .maybeSingle();

    if (!wsRow?.id_workspace) {
      return NextResponse.json({ error: "No workspace found" }, { status: 500 });
    }

    const { data: clients } = await supabase
      .from("app_clients")
      .select("id_client, name_client")
      .in("id_client", clientsToProcess);

    const clientNameMap = new Map(
      (clients || []).map((c: any) => [c.id_client, c.name_client])
    );

    // 6. Process changed clients (max 5 per run to stay within timeout)
    const MAX_PER_RUN = 5;
    const results: { clientId: number; name: string; status: string; files?: number }[] = [];
    let processedCount = 0;

    for (const clientId of clientsToProcess) {
      if (processedCount >= MAX_PER_RUN) {
        results.push({
          clientId,
          name: clientNameMap.get(clientId) || `Client ${clientId}`,
          status: "deferred",
        });
        continue;
      }

      const clientName = clientNameMap.get(clientId);
      const result = await processClientContext(wsRow.id_workspace, clientId, clientName);

      results.push({
        clientId,
        name: clientName || `Client ${clientId}`,
        status: result.error ? "error" : result.processed > 0 ? "processed" : "no-content",
        files: result.processed,
      });

      if (result.processed > 0) processedCount++;
    }

    return NextResponse.json({
      totalClients: clientStats.size,
      needsUpdate: clientsToProcess.length,
      processed: processedCount,
      cleaned: orphanedContexts.length,
      results,
    });
  } catch (error: any) {
    console.error("[ClientContext Cron] Fatal error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
