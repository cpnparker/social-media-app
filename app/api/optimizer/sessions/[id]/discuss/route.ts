/**
 * The conversation about a draft. GET reads it, POST asks a question.
 *
 * ── WHY THE DRAFT COMES FROM THE CLIENT ─────────────────────────────────────
 *
 * The editor autosaves on a 600ms debounce, so the stored draft is always at
 * least slightly behind what is on screen — and after a burst of typing, or a
 * failed save, it can be a great deal behind. A writer who rewrites a paragraph
 * and immediately asks "is that better?" must not be answered about the version
 * before the rewrite: that produces a confident, wrong answer with nothing on
 * either side showing why. So the browser sends what it is displaying, and the
 * stored draft is only the fallback for when it sends nothing.
 *
 * This is the writer's own document either way — the same bytes they can read,
 * edit and export — so accepting it from them grants no access they lack. It is
 * bounded here regardless, because size is a cost question rather than a trust
 * one.
 *
 * ── SPEND ───────────────────────────────────────────────────────────────────
 *
 * POST calls a model, so it carries the gate and logs usage in onComplete,
 * before anything that can throw. GET does neither because it does neither:
 * it reads a jsonb column.
 */
import { NextRequest, NextResponse } from "next/server";
import { markPolicyFor, normaliseLens, type Lens } from "@/lib/optimizer/mark-policy";
import { DEFAULT_CONTENT_TYPE } from "@/lib/optimizer/content-types";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { createStreamingResponse } from "@/lib/ai/providers";
import { assertServiceAllowed } from "@/lib/admin/service-control";
import { logAiUsage } from "@/lib/ai/usage-logger";
import { DISCUSS_MODEL } from "@/lib/optimizer/models";
import { requireOptimizer, loadSessionForCaller } from "../../../_lib/access";
import { buildGroundingBlock } from "@/lib/optimizer/briefs";
import { loadClientStyle } from "@/lib/optimizer/client-style";
import { listSources } from "@/lib/optimizer/sources";
import { parseDraft } from "@/lib/optimizer/parse";
import {
  readTurns,
  trimForPrompt,
  trimForStorage,
  buildDiscussSystem,
  buildDiscussTurn,
  DISCUSS_MAX_QUESTION,
  DISCUSS_MAX_DRAFT_CHARS,
  type DiscussTurn,
} from "@/lib/optimizer/discuss";

export const maxDuration = 120;

/**
 * The draft as ONE string, shared with everything that anchors into it.
 *
 * This was a private htmlToText regex chain — a THIRD reconstruction of "the
 * plain text of this document", distinct from both ParsedDraft.text and
 * DocIndex.text. Harmless while the model only read the draft; not harmless now
 * that it quotes it. Every quote it returned was a quote of a string nothing
 * else in the system uses, so re-anchoring in the browser was matching against
 * text derived a different way — a class of missed anchor with no symptom
 * except quotes that mysteriously fail to resolve.
 *
 * parseDraft is what the score, the marks and the doc index all read, and
 * DocIndex.text is documented byte-identical to it. One string, one set of
 * offsets, one thing to be wrong about.
 */
function draftText_(html: string, title: string): string {
  try {
    return parseDraft({ body: html, title }).text;
  } catch {
    // A parse failure must not cost the writer their question. Degrades to the
    // crude strip, which is worse for anchoring and fine for reading.
    return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireOptimizer(req.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;
  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

  return NextResponse.json({ turns: readTurns((owned.session as any).config_chat) });
}

/**
 * Clear the conversation.
 *
 * Its own method rather than a flag on POST, and that is not style. It was
 * written as `if (body.clear === true)` BELOW the "ask a question first" check,
 * which made it unreachable: clearing required sending a question, and sending
 * a question meant it was never a clear. The branch existed, type-checked and
 * read correctly — the failure this repo keeps finding, where code is written
 * but never actually run. A verb cannot be shadowed by another parameter.
 *
 * No spend gate: it calls no model. Deliberately no gate, in fact, for the
 * reason the style route gives — refusing to clear a conversation because a
 * BUDGET is exhausted would block a free action on an unrelated condition.
 *
 * The draft is untouched. This clears the talk ABOUT the piece, never the piece.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireOptimizer(req.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;
  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const { error } = await intelligenceDb
    .from("optimizer_sessions")
    .update({ config_chat: [] })
    .eq("id_session", id);
  if (error) return NextResponse.json({ error: "Could not clear that" }, { status: 500 });
  return NextResponse.json({ turns: [] });
}

/**
 * PATCH: mark one suggested block dismissed, or bring it back.
 *
 * Addressed by the turn's `at` rather than its position. The stored
 * conversation is capped, so the oldest turn falls off the front the moment it
 * passes the cap, and every index the client held would then point one turn
 * earlier: a writer dismissing today's suggestion would silently hide one from
 * last week.
 *
 * Calls no model, so no spend gate. Refusing to hide a suggestion because a
 * budget is exhausted would block a free action on an unrelated condition,
 * which is the reasoning the clear route already records.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const guard = await requireOptimizer(body.workspaceId || null);
  if (!guard.ok) return guard.response;
  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const at = String(body.at || "");
  /** "segment.paragraph" — a POINT inside a reply, rather than a whole block. */
  const point = typeof body.point === "string" && /^\d+\.\d+$/.test(body.point) ? body.point : "";
  const index = Number(body.index);
  const dismissed = body.dismissed === true;
  if (!at || (!point && (!Number.isInteger(index) || index < 0))) {
    return NextResponse.json({ error: "A turn, and a block or a point, are required" }, { status: 400 });
  }

  const turns = readTurns((owned.session as any).config_chat);
  const target = turns.filter((t) => t.role === "assistant" && t.at === at);
  if (target.length !== 1) {
    // Zero means the turn has been trimmed away or never had a timestamp; more
    // than one means two turns share a millisecond. Either way the write would
    // land somewhere nobody chose, so it does not happen.
    return NextResponse.json({ error: "That reply is no longer here" }, { status: 404 });
  }

  const next = turns.map((t) => {
    if (t !== target[0]) return t;

    // A point being marked done, which is the finer of the two addresses.
    if (point) {
      const current = t.donePoints || [];
      const updated = dismissed
        ? (current.indexOf(point) < 0 ? current.concat([point]) : current)
        : current.filter((p) => p !== point);
      const { donePoints: _dropPoints, ...rest } = t;
      return updated.length ? { ...rest, donePoints: updated } : rest;
    }

    const current = t.dismissed || [];
    const updated = dismissed
      ? (current.indexOf(index) < 0 ? current.concat([index]) : current)
      : current.filter((n) => n !== index);
    const { dismissed: _drop, ...rest } = t;
    return updated.length ? { ...rest, dismissed: updated } : rest;
  });

  const { error } = await intelligenceDb
    .from("optimizer_sessions")
    .update({ config_chat: next })
    .eq("id_session", id);
  if (error) return NextResponse.json({ error: "Could not save that" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const guard = await requireOptimizer(body.workspaceId || null);
  if (!guard.ok) return guard.response;
  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });
  const session = owned.session as any;

  const question = String(body.question || "").trim().slice(0, DISCUSS_MAX_QUESTION);
  if (!question) return NextResponse.json({ error: "Ask a question first" }, { status: 400 });

  // ── The column has to exist before we spend anything ─────────────────────
  //
  // This ships in a migration run by hand. Without it the conversation would
  // still STREAM — the writer would read a perfectly good answer — and then
  // vanish on reload, because the write of config_chat fails with 42703 inside
  // onComplete, long after the response has been handed back. That is the
  // shape of failure this codebase keeps finding: something that looks like it
  // worked, costs money, and quietly kept nothing. Checked BEFORE the model
  // call so nothing is paid for a conversation that cannot be saved.
  //
  // `select("*")` simply omits a column that does not exist, so undefined is
  // the signal. An existing but empty column is [].
  if (typeof session.config_chat === "undefined") {
    return NextResponse.json(
      { error: "This deployment's database has not been migrated for the writing conversation yet. Run supabase/migrations/20260826_writer_chat.sql." },
      { status: 503 }
    );
  }

  try {
    await assertServiceAllowed("engine", "optimizer");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Engine AI is temporarily unavailable" }, { status: 503 });
  }

  // What is on the writer's screen, falling back to what was last saved.
  let draftText = "";
  if (typeof body.draftHtml === "string" && body.draftHtml.trim()) {
    draftText = draftText_(body.draftHtml, session.name_title || "").slice(0, DISCUSS_MAX_DRAFT_CHARS * 2);
  } else {
    const { data: drafts } = await intelligenceDb
      .from("optimizer_drafts")
      .select("document_body")
      .eq("id_session", id)
      .order("units_version", { ascending: false })
      .limit(1);
    if (drafts && drafts.length > 0) draftText = draftText_((drafts[0] as any).document_body || "", session.name_title || "");
  }

  const clientStyle = session.id_client
    ? await loadClientStyle(
        guard.caller.workspaceId,
        session.id_client,
        (session.config_canon && session.config_canon.clientName) || `Client ${session.id_client}`
      )
    : null;
  const sources = await listSources(id);

  // The SAME grounding that produced the draft. Not a paraphrase of it.
  const grounding = buildGroundingBlock({
    title: session.name_title,
    format: session.type_format,
    platform: session.type_platform,
    brief: session.config_brief || { targetQueries: [], audience: "", goal: "", lengthBand: "800-1500", voice: "" },
    canon: session.config_canon && session.config_canon.clientName ? session.config_canon : null,
    style: clientStyle,
    sources,
  } as any);

  /**
   * The lens the CONVERSATION works under, and it must be the one the marks are
   * already using or the two surfaces contradict each other on the same piece.
   *
   * Taken from the client when it sends one, because the client holds the
   * authoritative policy: `surface` is a property of the page the writer has
   * open, not of the row, so the server cannot derive it alone. Validated
   * through normaliseLens, so an unknown value falls back rather than reaching
   * the prompt.
   *
   * The fallback derives what it can. `type_surface` is the American spelling
   * in the database and markPolicyFor takes the British one, which is exactly
   * the sort of near-miss that silently routes every optimiser session down the
   * Writer branch; mapped explicitly rather than passed through.
   */
  /**
   * The point this exchange answers, if it answers one.
   *
   * Bounded and shape-checked rather than trusted: it is written onto a stored
   * turn and read back as a selector, so an unbounded string here is a way to
   * bloat the row and a way to make a turn unreachable.
   */
  const rawPoint = typeof body.pointKey === "string" ? body.pointKey.trim() : "";
  const pointKey = /^[0-9TZ:.\-]{10,40}#\d+\.\d+$/.test(rawPoint) ? rawPoint : "";

  const clientLens = normaliseLens(body.lens);
  const brief = (session.config_brief || {}) as any;
  const lens: Lens =
    clientLens ||
    markPolicyFor({
      surface: String(session.type_surface) === "writer" ? "writer" : "optimiser",
      contentTypeId: String(session.type_content || DEFAULT_CONTENT_TYPE),
      override: normaliseLens(brief.lens),
      hasTargetQueries: Array.isArray(brief.targetQueries) && brief.targetQueries.length > 0,
    }).lens;

  const systemPrompt = buildDiscussSystem({
    title: session.name_title,
    format: session.type_format,
    grounding,
    lens,
  });

  const history = readTurns(session.config_chat);
  const now = new Date().toISOString();
  /**
   * The assistant turn's identity, decided HERE and told to the browser.
   *
   * It used to be stamped twice: once by the server when the turn was stored,
   * and once by the browser when the stream finished. Two clocks, one identity,
   * and nothing compared them until a feature needed to address a single turn.
   * Dismissing a suggestion then 404'd every time until the page was reloaded,
   * because the browser was asking about a turn that does not exist under that
   * timestamp. One source, sent in a header the client reads before the first
   * token arrives.
   */
  const assistantAt = new Date(Date.parse(now) + 1).toISOString();

  // History carries the writer's words only — never the copy of the draft that
  // rode with them. Ten turns each holding their own snapshot would grow the
  // prompt by the length of the article per question asked, and would invite an
  // answer about a version since rewritten.
  const promptTurns = trimForPrompt(history).map((t) => ({ role: t.role, content: t.content }));
  const selection = typeof body.selection === "string" ? body.selection : null;
  promptTurns.push({
    role: "user",
    content: buildDiscussTurn({ draftText, selection, question }),
  });

  try {
    const stream = createStreamingResponse(
      promptTurns as any,
      {
        model: DISCUSS_MODEL,
        systemPrompt,
        // 2000 truncated a requested rewrite mid-fence: the reply stops inside
        // a ```draft block, the parser correctly refuses to offer an unclosed
        // fence as insertable, and the writer is left looking at a literal
        // marker with no button — having paid for the whole call. 4000 is
        // roughly 3000 words of prose, comfortably past any single passage a
        // discussion rewrites.
        maxTokens: 4000,
        webSearch: false,
        imageGeneration: false,
        preserveLinks: true,
        source: "optimizer",
      } as any,
      // No inline annotation: inference gives the real StreamResult, where
      // modelUsed is required. A hand-written shape here is how every generate
      // row came to name Sonnet regardless of which model answered.
      async (result) => {
        logAiUsage({
          workspaceId: guard.caller.workspaceId,
          userId: guard.caller.userId,
          model: result.modelUsed,
          source: "optimizer",
          inputTokens: result.inputTokens || 0,
          outputTokens: result.outputTokens || 0,
          cacheReadTokens: result.cacheReadTokens,
          cacheWriteTokens: result.cacheWriteTokens,
        });

        const reply = (result.fullText || "").trim();
        // An empty reply is not recorded. A stored blank assistant turn would
        // render as a silent bubble the writer cannot interpret, and would then
        // be sent back as context on every later turn.
        if (!reply) return;

        // ── RE-READ, do not reuse the snapshot ────────────────────────────
        //
        // `history` was read BEFORE the model was called, and a stream takes
        // seconds. Writing snapshot+new is a read-modify-write across that
        // whole window, and it loses every change made inside it:
        //
        //   Clear the conversation while an answer is arriving, and the
        //   completion writes the pre-clear history straight back. Forty turns
        //   the writer deliberately deleted reappear, and the DELETE they
        //   watched succeed is silently undone.
        //
        //   Ask two questions in quick succession and the second completion
        //   overwrites the first exchange, which vanishes from a conversation
        //   the writer watched arrive.
        //
        // Re-reading here narrows the window to the write itself. It is not a
        // transaction — Postgres could still interleave two completions landing
        // in the same instant — but it removes the seconds-long window that
        // made both failures ordinary rather than rare. A true fix needs the
        // append pushed into the database; this is deliberately the smaller
        // change, and the residual race is recorded rather than implied away.
        const { data: fresh, error: reReadError } = await intelligenceDb
          .from("optimizer_sessions")
          .select("config_chat")
          .eq("id_session", id)
          .maybeSingle();

        // ── A FAILED READ IS NOT AN EMPTY CONVERSATION ────────────────────
        //
        // This destructured the error away and fell through to readTurns(null),
        // which is []. So a transient read failure did not lose ONE exchange —
        // it replaced the entire conversation with the exchange that had just
        // happened, and reported success. The version of this code it replaced
        // used a stale snapshot, which is wrong in a small way; ignoring the
        // error made it wrong in a way that destroys the thing being written.
        //
        // The fallback is the pre-call snapshot: seconds out of date at worst,
        // and never empty when the conversation was not. A concurrent clear can
        // still be undone by it, which is the race documented above — losing a
        // clear is recoverable, losing the conversation is not.
        const current =
          reReadError || !fresh
            ? (console.error(
                "[optimizer] discuss: could not re-read the conversation, falling back to the pre-call snapshot:",
                reReadError?.message || "no row returned"
              ),
              history)
            : readTurns((fresh as any).config_chat);

        const next: DiscussTurn[] = trimForStorage(
          current.concat([
            { role: "user", content: question, at: now, ...(pointKey ? { pointKey } : {}) },
            { role: "assistant", content: reply, at: assistantAt, ...(pointKey ? { pointKey } : {}) },
          ])
        );
        const { error: writeError } = await intelligenceDb
          .from("optimizer_sessions")
          .update({ config_chat: next })
          .eq("id_session", id);
        // Logged rather than discarded. This runs after the response has been
        // handed back, so there is no way left to tell the writer — which is
        // exactly why it must reach the server log. A dropped error here means
        // an answer that was paid for, read, and then gone on reload, with
        // nothing anywhere saying why.
        if (writeError) {
          console.error("[optimizer] discuss: storing the conversation failed:", writeError.message);
        }
      }
    );

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        // Read before the first token arrives, so the turn the browser appends
        // carries the same identity as the one that gets stored.
        "X-Discuss-At": assistantAt,
      },
    });
  } catch (error: any) {
    console.error("[optimizer] discuss failed:", error?.message);
    return NextResponse.json({ error: error?.message || "Could not answer just now" }, { status: 500 });
  }
}
