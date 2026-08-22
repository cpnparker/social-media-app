import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";

const VALID_PROVIDERS = new Set([
  "claude", "openai", "gemini", "gemini-pro", "mistral", "grok", "grok-4", "perplexity",
]);

interface PutBody {
  provider: string;
  dailyCapCents?: number | null;
  monthlyCapCents?: number | null;
  alertThresholdPct?: number | null;
  hardBlock?: boolean;
  /** When true, removes the row entirely (clears all caps for the provider). */
  clear?: boolean;
}

export async function PUT(req: NextRequest) {
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
  const role = await verifyWorkspaceMembership(userId, workspaceId);
  if (!role || (role !== "owner" && role !== "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json()) as PutBody;
  if (!body.provider) {
    return NextResponse.json({ error: "provider required" }, { status: 400 });
  }
  if (!VALID_PROVIDERS.has(body.provider)) {
    return NextResponse.json(
      { error: `Unknown provider ${body.provider}` },
      { status: 400 },
    );
  }

  if (body.clear) {
    const { error } = await intelligenceDb
      .from("provider_caps")
      .delete()
      .eq("provider", body.provider);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, cleared: true });
  }

  const update: Record<string, unknown> = {
    provider: body.provider,
    updated_at: new Date().toISOString(),
    updated_by: session.user.email ?? String(userId),
  };
  if (body.dailyCapCents !== undefined) update.daily_cap_cents = body.dailyCapCents;
  if (body.monthlyCapCents !== undefined) update.monthly_cap_cents = body.monthlyCapCents;
  if (body.alertThresholdPct !== undefined) update.alert_threshold_pct = body.alertThresholdPct;
  if (body.hardBlock !== undefined) update.hard_block = body.hardBlock;

  const { error } = await intelligenceDb
    .from("provider_caps")
    .upsert(update, { onConflict: "provider" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
