/**
 * POST /api/optimizer/sessions/[id]/suggest — one rewrite for one finding.
 *
 * The deterministic layer deliberately never proposes prose: it knows a
 * sentence is forty words, not what the sentence should say. This is the
 * writer's way to ask for prose anyway — a single, explicit, per-finding
 * request, so the model call happens exactly when someone wants its output
 * and never as a side effect of typing.
 *
 * THE GATE IS NOT OPTIONAL. The rewrite passes the same preGate as judge
 * suggestions, because the failure it guards against is identical and is the
 * worst one this product can have: one click putting an invented figure or a
 * fabricated attribution into a client's published copy. A rewrite the gate
 * rejects is reported as rejected — not silently retried, which would be
 * paying for the same fabrication twice.
 *
 * The quote is re-anchored against the SAVED draft before any model call.
 * The client's copy can be ahead of the save (600ms debounce), and generating
 * a rewrite for text the server cannot see would bill for a suggestion that
 * cannot be verified against anything.
 */

import { NextRequest, NextResponse } from "next/server";
import { analysisAllowed, DEFAULT_CONTENT_TYPE } from "@/lib/optimizer/content-types";
import Anthropic from "@anthropic-ai/sdk";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { requireOptimizer, loadSessionForCaller } from "../../../_lib/access";
import { assertServiceAllowed } from "@/lib/admin/service-control";
import { logAiUsage } from "@/lib/ai/usage-logger";
import { parseDraft } from "@/lib/optimizer/parse";
import { findAnchor } from "@/lib/optimizer/anchors";
import { preGate } from "@/lib/optimizer/suggest-gate";
import { JUDGE_MODEL } from "@/lib/optimizer/judge";

export const maxDuration = 30;

const MAX_QUOTE = 400;
const CONTEXT_CHARS = 500;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const guard = await requireOptimizer(body.workspaceId || null);
  if (!guard.ok) return guard.response;

  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const quote = typeof body.quote === "string" ? body.quote.slice(0, MAX_QUOTE) : "";
  const criterion = typeof body.criterion === "string" ? body.criterion.slice(0, 80) : "";
  const explanation = typeof body.explanation === "string" ? body.explanation.slice(0, 500) : "";
  if (!quote.trim() || !criterion) {
    return NextResponse.json({ error: "Nothing to rewrite" }, { status: 400 });
  }

  // BEFORE the spend gate, and before the model call it guards.
  //
  // "Fix with AI" spent a JUDGE_MODEL call on documents whose registry entry has
  // every analysis switched off — the assess and coverage routes both refuse
  // those outright, and this one did not, so the one path that reached a model
  // per finding was the one path nobody had gated. Refusing here costs nothing
  // and is the same answer the sibling routes already give.
  if (!analysisAllowed(String((owned.session as any).type_content || DEFAULT_CONTENT_TYPE), "judge")) {
    return NextResponse.json({ error: "Rewrites are not available for this piece" }, { status: 400 });
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
  const draftBody = drafts && drafts.length ? (drafts[0] as any).document_body || "" : "";
  if (!draftBody.trim()) return NextResponse.json({ error: "No draft to rewrite" }, { status: 404 });

  const parsed = parseDraft({ body: draftBody, title: (owned.session as any).name_title || "" });
  const match = findAnchor(parsed.text, {
    quote,
    prefix: typeof body.prefix === "string" ? body.prefix.slice(0, 40) : "",
    suffix: typeof body.suffix === "string" ? body.suffix.slice(0, 40) : "",
  });
  if (!match.ok) {
    return NextResponse.json(
      { error: "The saved draft doesn't contain that passage yet — your latest edits may still be saving. Try again in a moment." },
      { status: 409 }
    );
  }

  const ctxStart = Math.max(0, (match.start as number) - CONTEXT_CHARS);
  const ctxEnd = Math.min(parsed.text.length, (match.end as number) + CONTEXT_CHARS);
  const context = parsed.text.slice(ctxStart, ctxEnd);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 350,
    thinking: { type: "disabled" } as any,
    system: [
      {
        type: "text",
        text:
          `You rewrite one marked span inside a writer's draft. You are given the span, its surrounding context, and what is wrong with it.\n\n` +
          `Return ONLY the replacement text for the span — no preamble, no quotes around it, no commentary. It must read naturally in place of the original.\n\n` +
          `HARD RULES:\n` +
          `- Never introduce a number, statistic, date, name, organisation or quotation that is not already in the context you were shown. If the fix requires information you do not have (a source, a figure, a speaker), rewrite to make the GAP explicit — "according to [source]" — rather than inventing one.\n` +
          `- Preserve the writer's meaning and register. This is their piece, not yours.\n` +
          `- Keep roughly the original length unless the problem IS the length.`,
        cache_control: { type: "ephemeral" },
      },
    ] as any,
    messages: [
      {
        role: "user",
        content:
          `The problem (${criterion}): ${explanation || "improve this span for AI citation-readiness"}\n\n` +
          `Context:\n…${context}…\n\n` +
          `The span to replace:\n${quote}`,
      },
    ],
  });

  logAiUsage({
    workspaceId: guard.caller.workspaceId,
    userId: guard.caller.userId,
    model: JUDGE_MODEL,
    source: "optimizer",
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    cacheReadTokens: (response.usage as any)?.cache_read_input_tokens,
    cacheWriteTokens: (response.usage as any)?.cache_creation_input_tokens,
  });

  if (response.stop_reason === "max_tokens") {
    return NextResponse.json(
      { error: "The rewrite ran out of room — this span is too long for a single suggestion.", retryable: false },
      { status: 502 }
    );
  }

  let edit = "";
  for (let i = 0; i < response.content.length; i++) {
    const block: any = response.content[i];
    if (block.type === "text") edit += block.text;
  }
  edit = edit.trim().replace(/^["'“]|["'”]$/g, "");
  if (!edit) return NextResponse.json({ error: "No rewrite came back. Try again." }, { status: 502 });

  // The same gate judge suggestions pass, for the same reason: a rewrite that
  // introduces a figure or an attribution the draft does not contain must die
  // here, visibly, not in a client's published copy.
  const gated = preGate({
    findings: [{ criterion, severity: "medium", quote, prefix: "", suffix: "", explanation, suggestedEdit: edit }],
    draftText: parsed.text,
    passingCriteria: [],
  });
  if (gated.length && gated[0].verdict !== "APPROVED") {
    return NextResponse.json(
      {
        error:
          "The rewrite was rejected by the safety gate: " +
          (gated[0].detail || gated[0].reason || "it introduced material not present in the draft") +
          ". Edit this one by hand.",
        gateRejected: true,
      },
      { status: 422 }
    );
  }

  return NextResponse.json({ suggestedEdit: edit });
}
