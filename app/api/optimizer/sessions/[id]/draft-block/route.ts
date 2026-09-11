/**
 * Draft one missing block — a TL;DR, a byline, a definition sentence.
 *
 * The sibling of /suggest, which rewrites a span that EXISTS. Half the criteria
 * in the "Not done" list have no span at all because the thing is absent, and
 * asking a span-rewriter to improve a passage that is not there is not a
 * degraded answer, it is a category error.
 *
 * Same order as every other paid route in this directory, and the order
 * matters: analysisAllowed (is this even scoreable), then assertServiceAllowed
 * (is spending permitted), then the call, then logAiUsage BEFORE anything that
 * can throw.
 */
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { requireOptimizer, loadSessionForCaller } from "../../../_lib/access";
import { assertServiceAllowed } from "@/lib/admin/service-control";
import { logAiUsage } from "@/lib/ai/usage-logger";
import { anthropicCallParams } from "@/lib/ai/anthropic-params";
import { SUGGEST_MODEL } from "@/lib/optimizer/models";
import { analysisAllowed, DEFAULT_CONTENT_TYPE } from "@/lib/optimizer/content-types";
import { addSpecFor, buildAddPrompt } from "@/lib/optimizer/fix-actions";
import { parseDraft } from "@/lib/optimizer/parse";

export const maxDuration = 60;

/** The draft is context, not the subject. Capped so a long piece cannot make
 *  this the most expensive call in the product. */
const MAX_CONTEXT = 12000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const guard = await requireOptimizer(body?.workspaceId || null);
  if (!guard.ok) return guard.response;
  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });
  const session = owned.session as any;

  const criterion = String(body?.criterion || "").slice(0, 80);
  const criterionName = String(body?.criterionName || criterion).slice(0, 160);
  const spec = addSpecFor(criterion);
  if (!spec) {
    // Not a criterion this route drafts for. Refused rather than guessed at:
    // the registry is the contract, and a criterion missing from it is a
    // decision nobody has made, not a licence to improvise.
    return NextResponse.json({ error: "There is nothing to draft for that check." }, { status: 400 });
  }

  if (!analysisAllowed(String(session.type_content || DEFAULT_CONTENT_TYPE), "judge")) {
    return NextResponse.json({ error: "Not available for this piece" }, { status: 400 });
  }
  try {
    await assertServiceAllowed("engine", "optimizer");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "The optimizer is temporarily unavailable" }, { status: 503 });
  }

  const { data: drafts } = await intelligenceDb
    .from("optimizer_drafts")
    .select("document_body")
    .eq("id_session", id)
    .order("units_version", { ascending: false })
    .limit(1);
  const html = drafts && drafts.length > 0 ? String((drafts[0] as any).document_body || "") : "";
  if (!html.trim()) {
    return NextResponse.json({ error: "There is no draft to work from yet." }, { status: 400 });
  }

  let context = "";
  try {
    context = parseDraft({ body: html, title: session.name_title || "" }).text.slice(0, MAX_CONTEXT);
  } catch {
    context = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, MAX_CONTEXT);
  }

  const canon = session.config_canon || {};
  const brand = canon.brandName ? `The client is ${canon.brandName}. Refer to them by that name, never "we".` : "";

  let block = "";
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res: any = await client.messages.create({
      model: SUGGEST_MODEL,
      max_tokens: 700,
      ...anthropicCallParams(SUGGEST_MODEL, 0.3),
      system: buildAddPrompt(spec, criterionName) + (brand ? `\n\n${brand}` : ""),
      messages: [{ role: "user", content: `Title: ${session.name_title || "(untitled)"}\n\nThe draft:\n\n${context}` }],
    });

    // Logged BEFORE parsing, like every sibling: the tokens were spent whether
    // or not the answer is usable, and an unlogged call is invisible to the cap.
    logAiUsage({
      workspaceId: guard.caller.workspaceId,
      userId: guard.caller.userId,
      model: SUGGEST_MODEL,
      source: "optimizer",
      inputTokens: res?.usage?.input_tokens || 0,
      outputTokens: res?.usage?.output_tokens || 0,
      cacheReadTokens: res?.usage?.cache_read_input_tokens || 0,
      cacheWriteTokens: res?.usage?.cache_creation_input_tokens || 0,
    });

    block = (res?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
  } catch (e: any) {
    console.error("[optimizer] draft-block failed:", e?.message || e);
    return NextResponse.json({ error: "Could not draft that just now" }, { status: 502 });
  }

  if (!block) return NextResponse.json({ error: "That came back empty" }, { status: 502 });

  return NextResponse.json({ block, where: spec.where, criterion });
}
