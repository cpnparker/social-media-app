/**
 * Client style — GET reads the card, POST derives or edits it.
 *
 * GET is free and never calls a model: the studio hits it whenever the client
 * selector changes, so it must stay cheap enough to be reflexive.
 *
 * POST is the only path here that spends, and it spends because a PERSON
 * clicked Refresh (or the studio found no card at all on an explicit client
 * selection). That is what keeps it inside the manual `optimizer` service row
 * instead of needing one of the automatic rows — and what keeps the promise
 * that this stage adds no background spend.
 *
 * The guard order is copied from the canon route deliberately, including its
 * comment about being written deny-unless-allowed: the style card is derived
 * from a client's own writing, so it is exactly as sensitive as the canon and
 * gets the same client-access check rather than a bespoke one.
 */
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireOptimizer } from "../_lib/access";
import { canAccessClient, requireAuth } from "@/lib/permissions";
import { assertServiceAllowed } from "@/lib/admin/service-control";
import { logAiUsage } from "@/lib/ai/usage-logger";
import { anthropicCallParams } from "@/lib/ai/anthropic-params";
import { JUDGE_MODEL } from "@/lib/optimizer/judge";
import {
  loadClientStyle,
  saveClientStyle,
  gatherStyleSamples,
  STYLE_SYSTEM,
  STYLE_MAX_CHARS,
  isStale,
} from "@/lib/optimizer/client-style";

export const maxDuration = 60;

/** One constant used to CALL, to NAME in the ledger, and to PRICE. */
const STYLE_MODEL = JUDGE_MODEL;

async function gateClient(req: NextRequest, clientId: number) {
  const authed = await requireAuth();
  if (!("userId" in authed)) return authed;
  const ok = await canAccessClient(authed.userId, authed.role, clientId);
  if (!ok) return NextResponse.json({ error: "No access to that client" }, { status: 403 });
  return null;
}

export async function GET(req: NextRequest) {
  const guard = await requireOptimizer(req.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;

  const clientId = Number(req.nextUrl.searchParams.get("clientId"));
  if (!clientId || Number.isNaN(clientId)) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }
  const denied = await gateClient(req, clientId);
  if (denied) return denied;

  const clientName = String(req.nextUrl.searchParams.get("clientName") || `Client ${clientId}`);
  const style = await loadClientStyle(guard.caller.workspaceId, clientId, clientName);
  return NextResponse.json({ style, stale: isStale(style.refreshedAt) });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const guard = await requireOptimizer(body?.workspaceId || null);
  if (!guard.ok) return guard.response;

  const clientId = Number(body?.clientId);
  if (!clientId || Number.isNaN(clientId)) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }
  const denied = await gateClient(req, clientId);
  if (denied) return denied;

  const clientName = String(body?.clientName || `Client ${clientId}`);
  const workspaceId = guard.caller.workspaceId;

  // ── Hand-edited card: a write, no model, no spend ──────────────────────
  //
  // Handled before the spend gate because saving text a person typed must work
  // even when the optimizer is killed or over its cap. Refusing to save an edit
  // because a BUDGET is exhausted would lose the writer's work to an unrelated
  // condition.
  if (typeof body?.text === "string") {
    const text = body.text.slice(0, STYLE_MAX_CHARS);
    const saved = await saveClientStyle(workspaceId, clientId, text, true);
    if (!saved.ok) {
      return NextResponse.json({ error: saved.error || "Could not save" }, { status: 500 });
    }
    const style = await loadClientStyle(workspaceId, clientId, clientName);
    return NextResponse.json({ style, derived: false });
  }

  // ── Derivation: the only paid path ────────────────────────────────────
  const existing = await loadClientStyle(workspaceId, clientId, clientName);

  // A hand-tuned card is never replaced without saying so. `force` is the
  // writer answering "yes, overwrite my edit" — the confirmation happens in the
  // UI, and this is the server refusing to do it silently either way.
  if (existing.edited && !body?.force) {
    return NextResponse.json(
      {
        style: existing,
        derived: false,
        needsConfirm: "This style card was edited by hand. Refreshing replaces it.",
      },
      { status: 409 }
    );
  }

  try {
    await assertServiceAllowed("engine", "optimizer");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "The optimizer is temporarily unavailable" }, { status: 503 });
  }

  const { samples, gap } = await gatherStyleSamples(workspaceId, clientId);
  if (!samples.length) {
    // Nothing to read. Recorded as a gap rather than an invented voice — the
    // canon's own rule: a thin style must LOOK thin, not look complete.
    return NextResponse.json({
      style: { ...existing, text: "", gap: gap || "No past work to read." },
      derived: false,
    });
  }

  const user =
    `Client: ${clientName}\n\n` +
    samples.map((s, i) => `--- SAMPLE ${i + 1} ---\n${s}`).join("\n\n");

  let text = "";
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res: any = await client.messages.create({
      model: STYLE_MODEL,
      max_tokens: 700,
      ...anthropicCallParams(STYLE_MODEL, 0.2),
      system: STYLE_SYSTEM,
      messages: [{ role: "user", content: user }],
    });

    // LOGGED BEFORE PARSING, and before anything that can throw. The tokens
    // were consumed whether or not the card is usable — the house rule every
    // optimizer route already follows.
    logAiUsage({
      workspaceId,
      userId: guard.caller.userId,
      model: STYLE_MODEL,
      source: "optimizer",
      inputTokens: res?.usage?.input_tokens || 0,
      outputTokens: res?.usage?.output_tokens || 0,
      cacheReadTokens: res?.usage?.cache_read_input_tokens || 0,
      cacheWriteTokens: res?.usage?.cache_creation_input_tokens || 0,
    });

    text = (res?.content || [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("")
      .trim();
  } catch (e: any) {
    console.error("[optimizer] style derivation failed:", e?.message || e);
    return NextResponse.json(
      { style: { ...existing, gap: "Could not read this client's voice just now." }, derived: false },
      { status: 502 }
    );
  }

  if (!text) {
    return NextResponse.json(
      { style: { ...existing, gap: "Nothing conclusive in the samples." }, derived: false },
      { status: 200 }
    );
  }

  const saved = await saveClientStyle(workspaceId, clientId, text, false);
  if (!saved.ok) {
    // The card was paid for; return it even if it could not be stored, rather
    // than losing a derivation to a schema problem.
    return NextResponse.json({
      style: { ...existing, text: text.slice(0, STYLE_MAX_CHARS), edited: false, gap: null },
      derived: true,
      stored: false,
    });
  }

  const style = await loadClientStyle(workspaceId, clientId, clientName);
  return NextResponse.json({ style, derived: true, stored: true });
}
