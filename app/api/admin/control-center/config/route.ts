import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { findService } from "@/lib/admin/service-registry";

interface PatchBody {
  app: string;
  typeSource: string;
  killed?: boolean;
  killedReason?: string | null;
  dailyCapCents?: number | null;
  monthlyCapCents?: number | null;
  alertThresholdPct?: number | null;
  hardBlock?: boolean;
  scheduleEnabled?: boolean;
  scheduleIntervalMinutes?: number | null;
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  const userId = parseInt(session.user.id, 10);
  const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
  if (!memberRole || (memberRole !== "owner" && memberRole !== "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json()) as PatchBody;
  if (!body.app || !body.typeSource) {
    return NextResponse.json({ error: "app and typeSource required" }, { status: 400 });
  }
  // Allow only registered services to be configured. Prevents fat-fingering
  // arbitrary (app, typeSource) pairs into the table.
  if (!findService(body.app, body.typeSource)) {
    return NextResponse.json(
      { error: `Unknown service ${body.app}/${body.typeSource}. Add it to lib/admin/service-registry.ts first.` },
      { status: 400 },
    );
  }

  // Build the upsert payload — only include fields the client actually sent so
  // partial updates don't clobber unrelated values.
  const update: Record<string, unknown> = {
    app: body.app,
    type_source: body.typeSource,
    updated_at: new Date().toISOString(),
    updated_by: session.user.email ?? String(userId),
  };
  if (body.killed !== undefined) {
    update.killed = body.killed;
    update.killed_at = body.killed ? new Date().toISOString() : null;
    if (body.killedReason !== undefined) update.killed_reason = body.killedReason;
  }
  if (body.dailyCapCents !== undefined) update.daily_cap_cents = body.dailyCapCents;
  if (body.monthlyCapCents !== undefined) update.monthly_cap_cents = body.monthlyCapCents;
  if (body.alertThresholdPct !== undefined) update.alert_threshold_pct = body.alertThresholdPct;
  if (body.hardBlock !== undefined) update.hard_block = body.hardBlock;
  if (body.scheduleEnabled !== undefined) update.schedule_enabled = body.scheduleEnabled;
  if (body.scheduleIntervalMinutes !== undefined) {
    update.schedule_interval_minutes = body.scheduleIntervalMinutes;
  }

  const { error } = await intelligenceDb
    .from("service_config")
    .upsert(update, { onConflict: "app,type_source" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Append to the alerts log for audit trail.
  if (body.killed !== undefined) {
    await intelligenceDb.from("service_alerts").insert({
      app: body.app,
      type_source: body.typeSource,
      kind: body.killed ? "kill_on" : "kill_off",
      detail: { reason: body.killedReason ?? null, by: session.user.email ?? userId },
    });
  }

  return NextResponse.json({ ok: true });
}
