import { NextRequest, NextResponse } from "next/server";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { sendDigestNotifications } from "@/lib/rfp/notifications";
import type { DigestQueueItem } from "@/lib/rfp/notifications";

export const maxDuration = 120;

// GET /api/cron/rfp-digest — Vercel Cron handler
// Runs daily at 07:00 UTC. Sends daily digests every day, weekly digests on the user's chosen day.
export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Read unprocessed queue items
    const { data: queueItems, error: queueError } = await intelligenceDb
      .from("rfp_digest_queue")
      .select("*")
      .eq("flag_processed", 0)
      .order("date_created", { ascending: true });

    if (queueError) throw queueError;

    if (!queueItems || queueItems.length === 0) {
      return NextResponse.json({ message: "No items to digest", sent: 0 });
    }

    // 2. Group by workspace
    const byWorkspace: Record<string, DigestQueueItem[]> = {};
    for (const item of queueItems) {
      const ws = item.id_workspace;
      if (!byWorkspace[ws]) byWorkspace[ws] = [];
      byWorkspace[ws].push(item as DigestQueueItem);
    }

    // 3. Process each workspace
    let totalSent = 0;
    const results: { workspace: string; daily: number; weekly: number }[] = [];

    const workspaceIds = Object.keys(byWorkspace);
    for (const workspaceId of workspaceIds) {
      const items = byWorkspace[workspaceId];
      // Send daily digests
      const dailySent = await sendDigestNotifications(workspaceId, "daily", items);

      // Send weekly digests (sendDigestNotifications handles day-of-week filtering internally)
      const weeklySent = await sendDigestNotifications(workspaceId, "weekly", items);

      totalSent += dailySent + weeklySent;
      results.push({ workspace: workspaceId, daily: dailySent, weekly: weeklySent });
    }

    // 4. Mark all items as processed
    const queueIds = queueItems.map((item: any) => item.id_queue);
    if (queueIds.length > 0) {
      await intelligenceDb
        .from("rfp_digest_queue")
        .update({ flag_processed: 1 })
        .in("id_queue", queueIds);
    }

    // 5. Cleanup: delete processed items older than 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await intelligenceDb
      .from("rfp_digest_queue")
      .delete()
      .eq("flag_processed", 1)
      .lt("date_created", thirtyDaysAgo);

    return NextResponse.json({
      processed: queueItems.length,
      sent: totalSent,
      results,
    });
  } catch (error: any) {
    console.error("[RFP Digest Cron] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
