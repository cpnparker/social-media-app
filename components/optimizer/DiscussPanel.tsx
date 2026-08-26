"use client";

/**
 * Talking to Engine AI about the draft, beside the draft.
 *
 * ── WHY IT IS HERE AND NOT IN A CHAT THREAD ─────────────────────────────────
 *
 * "Ask" used to navigate away to a conversation. That answered the question and
 * lost the point: the writer left the document to ask about the document, got
 * prose in another tab, and retyped it by hand. The discussion is the half of
 * the Writer that matters most, and a discussion held somewhere else is a
 * different product.
 *
 * ── WHAT MAKES IT WORTH USING ───────────────────────────────────────────────
 *
 * Three things this panel has that a chat tab cannot:
 *
 *   THE DRAFT, live. Every question carries what is on screen right now, not
 *   what was last saved — so "is that better?" is answered about the rewrite
 *   the writer just typed rather than the version before it.
 *
 *   THE SELECTION. Highlight a paragraph and the question is about THAT
 *   paragraph. Without it a model asked about "this bit" picks one, and
 *   answering confidently about the wrong paragraph is the failure that reads
 *   as stupidity rather than as missing information.
 *
 *   THE BUTTON. Words meant for the piece come back marked, and land in the
 *   document at one click — replacing the selection they were written for.
 *
 * The marking is the model's job, not a guess made here. Inferring "this looks
 * like a suggestion" from prose fails in both directions, and the expensive
 * direction pastes an explanation into somebody's article.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CornerDownLeft, Eraser, Loader2, Quote, Sparkles } from "lucide-react";
import { parseDiscussReply, type DiscussTurn } from "@/lib/optimizer/discuss";

interface Props {
  sessionId: string;
  workspaceId: string | null;
  /** Read at submit time, so the model sees what is on screen — not the last save. */
  getDraftHtml: () => string;
  /** Can this quoted passage still be found in the draft as it stands? */
  resolveQuote: (quote: string) => boolean;
  /** Jump to it. Returns false if it could not be found. */
  onRevealQuote: (quote: string) => boolean;
  /**
   * Every passage the conversation has pointed at, in order, so the page can
   * draw a margin marker beside each.
   *
   * Lifted rather than drawn here because the marks live in the DOCUMENT and
   * the conversation lives in the panel — and the panel is unmounted whenever
   * the writer switches to Background or Suggestions, which would take the
   * markers with it.
   */
  onAnchorsChanged: (anchors: { quote: string; turn: number }[]) => void;
  /** A margin marker was clicked: scroll to what was said about that passage.
   *  Carries a nonce so clicking the same marker twice still scrolls. */
  focusTurn: { turn: number; nonce: number } | null;
  /** The selected passage, for showing the writer what they are asking about. */
  selection: string;
  /**
   * Whether ANYTHING is selected. Separate from `selection` on purpose: a
   * selection over an image yields no text, and deciding the button's label
   * from the text made it promise "Add to the end" while the editor replaced.
   */
  hasSelection: boolean;
  /** Put text into the document. Returns what it actually did, so the report is true. */
  onApply: (text: string, anchor?: string) => "replaced" | "appended" | "failed";
}

/**
 * Split a streaming reply at an UNCLOSED draft fence.
 *
 * The parser treats an unclosed fence as commentary, which is right for a
 * finished reply — but mid-stream that is every draft block for the second or
 * two it takes to arrive, and it would render the literal ```draft marker into
 * the prose and then snap. Handled here rather than in the parser because it is
 * a display concern: the stored reply is always parsed the strict way.
 */
function splitLive(text: string): { settled: string; partial: string | null } {
  const open = text.lastIndexOf("```draft");
  if (open < 0) return { settled: text, partial: null };
  const close = text.indexOf("```", open + 8);
  if (close >= 0) return { settled: text, partial: null };
  return { settled: text.slice(0, open), partial: text.slice(open + 8).replace(/^\n/, "") };
}

/**
 * The passage a point is about, as a link into the document.
 *
 * Resolution is attempted up front rather than on click, so a passage the
 * writer has since rewritten reads as unavailable instead of inviting a click
 * that does nothing. That distinction is the whole point: a dead link that
 * looks live is worse than a link that says it is dead.
 */
function AnchorChip({
  quote,
  resolveQuote,
  onRevealQuote,
  onFix,
}: {
  quote: string;
  resolveQuote: (q: string) => boolean;
  onRevealQuote: (q: string) => boolean;
  /** Absent when this point already carries a rewrite of its own. */
  onFix?: (quote: string) => void;
}) {
  const found = resolveQuote(quote);
  const short = quote.length > 90 ? `${quote.slice(0, 90)}…` : quote;

  if (!found) {
    return (
      <p className="text-[11px] text-muted-foreground/70 italic leading-snug mb-1">
        &ldquo;{short}&rdquo; — couldn&rsquo;t find that passage in the draft as it stands.
      </p>
    );
  }

  return (
    <div className="group/anchor mb-1 rounded-md border-l-2 border-primary/40 bg-muted/40 pl-2 pr-2 py-1">
      <button
        onClick={() => onRevealQuote(quote)}
        className="block w-full text-left"
        title="Show me this passage"
      >
        <span className="text-[11px] text-muted-foreground leading-snug">&ldquo;{short}&rdquo;</span>
      </button>
      <div className="mt-1 flex items-center gap-2.5">
        <button
          onClick={() => onRevealQuote(quote)}
          className="text-[10.5px] font-medium text-primary hover:underline underline-offset-2"
        >
          Show me
        </button>
        {onFix && (
          // Only where the point does NOT already carry a rewrite. A reply that
          // identifies six problems is not made to write six replacements
          // nobody asked for — that is six times the output tokens, and it
          // presumes the writer wants the model's words rather than their own.
          // The button is the offer; the click is the request.
          <button
            onClick={() => onFix(quote)}
            className="text-[10.5px] font-medium text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
          >
            Suggest a fix
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * One point of prose, with an action.
 *
 * The most useful criticism in a reply is often the kind with NOTHING to
 * underline — "the structure follows your CV, not the job", "the AuthorityOn.ai
 * paragraph is buried sixth", "you never say what you think their challenge
 * is". Those carry no anchor by design: inventing a passage for a point about
 * the shape of the whole piece would send the writer somewhere confidently
 * wrong. But having no anchor was leaving them with no action either, which
 * left the best observations in the reply as the only ones you could not do
 * anything about.
 *
 * So the action is offered per POINT rather than per anchor. Asking for a fix
 * routes back through the anchored path, so whatever comes back is applicable
 * even though the point that prompted it was not.
 *
 * Hover-revealed, and only on substantial paragraphs: a button under every line
 * of a six-point reply is clutter, and clutter is what the owner objected to in
 * the first place.
 */
const MIN_ACTIONABLE_POINT = 60;

function PointParagraph({ text, onFix }: { text: string; onFix?: (point: string) => void }) {
  const actionable = !!onFix && text.trim().length >= MIN_ACTIONABLE_POINT && !/\?\s*$/.test(text.trim());
  return (
    <div className="group/point">
      <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{text}</p>
      {actionable && (
        <button
          onClick={() => onFix!(text)}
          className="mt-0.5 text-[10.5px] font-medium text-muted-foreground opacity-0 group-hover/point:opacity-100 focus:opacity-100 hover:text-foreground hover:underline underline-offset-2"
        >
          Suggest a fix
        </button>
      )}
    </div>
  );
}

function DraftBlock({
  text,
  hasSelection,
  onApply,
  pending,
  anchor,
  anchorFound,
}: {
  text: string;
  hasSelection: boolean;
  onApply: (text: string, anchor?: string) => "replaced" | "appended" | "failed";
  pending?: boolean;
  /** The passage this rewrite was written for, if the model named one. */
  anchor?: string;
  anchorFound?: boolean;
}) {
  // Confirmed ON the block rather than in a toast. The rail's composer is
  // bottom-right and so is sonner, so a toast fired from here covers the input
  // the writer is about to type in — proven by elementFromPoint, not guessed.
  // It also reads better: the confirmation sits on the thing that was applied.
  const [applied, setApplied] = useState<null | "replaced" | "appended">(null);

  return (
    <div className="mt-2 rounded-lg border border-primary/30 bg-primary/[0.04] overflow-hidden">
      <div className="px-2.5 py-1.5 border-b border-primary/20 flex items-center gap-1.5">
        <Quote className="h-3 w-3 text-primary/70" />
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-primary/80">
          For the piece
        </span>
      </div>
      <p className="px-2.5 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap">{text}</p>
      {!pending && (
        <div className="px-2.5 pb-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11.5px]"
            onClick={() => {
              const what = onApply(text, anchorFound ? anchor : undefined);
              // Reported from what actually happened. A confirmation shown
              // before the fact is how a writer comes to believe text landed in
              // a document it never reached. An outright failure still toasts:
              // that one is not redundant, and it is worth interrupting for.
              if (what === "failed") toast.error("Could not place that — the editor is not ready");
              else setApplied(what);
            }}
          >
            {/* The label says what will happen, which depends on whether
                anything is selected RIGHT NOW. A button reading "Replace
                selection" that appends instead is a small lie the writer only
                catches after it has moved their text. */}
            {/* A rewrite the model wrote FOR a passage replaces that passage,
                whatever happens to be selected — the writer clicked Show me,
                read it, and came back; their cursor is not the instruction. */}
            {anchorFound ? "Replace that passage" : hasSelection ? "Replace selection" : "Add to the end"}
          </Button>
          {applied && (
            <span className="ml-2 text-[11px] text-muted-foreground">
              {applied === "replaced"
                ? anchorFound ? "Replaced that passage" : "Replaced your selection"
                : "Added to the end"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function DiscussPanel({ sessionId, workspaceId, getDraftHtml, resolveQuote, onRevealQuote, onAnchorsChanged, focusTurn, selection, hasSelection, onApply }: Props) {
  const [turns, setTurns] = useState<DiscussTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [streamed, setStreamed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /**
   * Which run's tokens are allowed to reach the screen.
   *
   * A stream takes seconds, and three things can happen inside that window —
   * the writer opens a different piece, clears the conversation, or asks again.
   * With nothing tracking WHICH run is current, all three end badly: piece A's
   * reply is appended to piece B's conversation (and Apply then inserts A's
   * text into B's document), a Clear the writer watched succeed silently fills
   * back up, and a second question's tokens interleave with the first's.
   *
   * Every commit below is gated on this token still being the live one. It is
   * bumped on unmount, on a session change, on Clear, and at the start of each
   * ask — so a superseded run finishes quietly and writes nothing.
   */
  const runRef = useRef(0);
  /** The last marker click acted on, so a new reply cannot re-trigger an old one. */
  const handledNonce = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abandon anything in flight when the piece changes or the panel goes away.
  // Without the abort the request keeps running to completion, which also means
  // the SERVER still writes the answer to the row it belongs to — correct, and
  // the reason this only has to silence the CLIENT.
  useEffect(() => {
    return () => {
      runRef.current++;
      if (abortRef.current) abortRef.current.abort();
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !workspaceId) { setLoaded(true); return; }
    let cancelled = false;
    // Cleared FIRST, not when the fetch resolves: otherwise the previous
    // piece's conversation stays on screen against the new document for as
    // long as the round trip takes, and anything applied from it during that
    // window lands in the wrong article.
    setTurns([]);
    setStreamed(null);
    setLoaded(false);
    fetch(`/api/optimizer/sessions/${encodeURIComponent(sessionId)}/discuss?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d.turns) setTurns(d.turns); })
      .catch(() => { /* an unreachable history is an empty one, not an error state */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [sessionId, workspaceId]);

  /**
   * Publish the conversation's anchors upward whenever the thread changes.
   *
   * Derived from the STORED turns only, never from the streaming buffer: a
   * half-arrived quote resolves to nothing, and a marker that appears, moves
   * and vanishes while tokens land is worse than one that appears when the
   * reply is finished.
   */
  useEffect(() => {
    const out: { quote: string; turn: number }[] = [];
    for (let i = 0; i < turns.length; i++) {
      if (turns[i].role !== "assistant") continue;
      const segs = parseDiscussReply(turns[i].content).segments;
      const seen: { [q: string]: true } = {};
      for (let j = 0; j < segs.length; j++) {
        const a = segs[j].anchor;
        if (!a || seen[a]) continue;
        seen[a] = true;
        out.push({ quote: a, turn: i });
      }
    }
    onAnchorsChanged(out);
  }, [turns, onAnchorsChanged]);

  // Pinned to the newest message, including as tokens arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, streamed]);

  /**
   * Scroll to the reply a margin marker points at, and flash it.
   *
   * The flash matters: the writer clicked something in the DOCUMENT and the
   * answer arrives in a panel they may not have been looking at, several
   * paragraphs of prose long. Landing them beside it silently leaves them
   * hunting for what changed.
   *
   * DEPENDS ON `turns`, and that is the whole correctness of it. The panel is
   * unmounted whenever the rail is on Background or Suggestions — which is
   * exactly when a margin marker is most useful — so a click mounts it fresh
   * and this effect first runs before the conversation has been fetched. The
   * turn element does not exist yet, the effect bails, and with `focusTurn`
   * alone in the dependencies it would never run again: the scroll silently
   * did nothing in the main case. Re-running when the turns arrive is the
   * retry.
   *
   * The nonce is then recorded as handled so a later reply landing in `turns`
   * cannot drag the writer back to an old marker they clicked minutes ago.
   */
  useEffect(() => {
    if (!focusTurn) return;
    if (handledNonce.current === focusTurn.nonce) return;
    const root = scrollRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-turn="${focusTurn.turn}"]`) as HTMLElement | null;
    if (!el) return; // not loaded yet — `turns` will bring us back
    handledNonce.current = focusTurn.nonce;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-primary/40", "rounded-lg");
    const t = setTimeout(() => el.classList.remove("ring-2", "ring-primary/40", "rounded-lg"), 1400);
    return () => clearTimeout(t);
  }, [focusTurn, turns]);

  const ask = useCallback(async (explicit?: string) => {
    // An explicit question comes from a button, not the box. Passed as an
    // argument rather than via setQuestion-then-send: state is not readable in
    // the same tick, so that shape sends the PREVIOUS question every time.
    const q = (typeof explicit === "string" ? explicit : question).trim();
    if (!q || busy) return;
    if (!workspaceId) { toast.error("Select a workspace first"); return; }

    // The question joins the thread immediately. Waiting for the round trip
    // leaves the writer looking at an input that just emptied itself.
    const asked: DiscussTurn = { role: "user", content: q, at: new Date().toISOString() };
    setTurns((t) => t.concat([asked]));
    setQuestion("");
    setStreamed("");
    setBusy(true);

    // This run's ticket. Every write below checks it is still the live one.
    const myRun = ++runRef.current;
    const live = () => runRef.current === myRun;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/optimizer/sessions/${encodeURIComponent(sessionId)}/discuss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          workspaceId,
          question: q,
          draftHtml: getDraftHtml(),
          selection: selection || null,
        }),
      });

      if (!live()) return;
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Could not answer just now");
        // The question is rolled back off the thread. Leaving it there with no
        // reply reads as an answer that is still coming and never arrives.
        setTurns((t) => t.filter((x) => x !== asked));
        setQuestion(q);
        return;
      }

      // Frames are `data: {...}\n\n` with a bare `data: [DONE]` that is not
      // JSON. Splitting the buffer on "\n\n" is load-bearing — a frame can
      // arrive split across two reads.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Superseded mid-stream: stop reading and write nothing. The server
        // still finishes and stores the answer against its own piece.
        if (!live()) return;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") continue;
            try {
              const data = JSON.parse(payload);
              if (typeof data.token === "string") {
                full += data.token;
                if (live()) setStreamed(full);
              } else if (data.error) {
                toast.error(String(data.error));
              }
            } catch { /* a malformed frame is not worth failing the stream over */ }
          }
        }
      }

      if (!live()) return;
      if (full.trim()) {
        setTurns((t) => t.concat([{ role: "assistant", content: full, at: new Date().toISOString() }]));
      } else {
        toast.error("That came back empty");
        setTurns((t) => t.filter((x) => x !== asked));
        setQuestion(q);
      }
    } catch (e: any) {
      // An abort is this component tidying up after itself, not a failure the
      // writer needs to be told about.
      if (e && e.name === "AbortError") return;
      if (!live()) return;
      toast.error("Could not answer just now");
      setTurns((t) => t.filter((x) => x !== asked));
      setQuestion(q);
    } finally {
      if (live()) {
        setStreamed(null);
        setBusy(false);
      }
    }
  }, [question, busy, workspaceId, sessionId, getDraftHtml, selection]);

  /**
   * Ask for a rewrite of one passage.
   *
   * Offered as a BUTTON rather than baked into the prompt, so a reply that
   * identifies six problems is not forced to write six rewrites nobody asked
   * for — six rewrites is six times the output tokens and presumes the writer
   * wants the model's words rather than their own. The button is the offer; the
   * click is the request.
   */
  const askForFix = useCallback(
    (quote: string) => {
      ask(
        `Rewrite this passage to fix what you just said about it:\n\n"${quote}"\n\n` +
          `Put the passage in an anchor block and the replacement in a draft block, so I can apply it in place.`
      );
    },
    [ask]
  );

  /**
   * Act on a point that has no passage to point at.
   *
   * Routed back through the anchored path on purpose: the point may be about
   * the shape of the whole piece, but whatever comes back should still land in
   * the document at one click rather than being another paragraph of advice.
   */
  const askForPointFix = useCallback(
    (point: string) => {
      ask(
        `Act on this point:\n\n${point}\n\n` +
          `Show me the concrete change in the draft. Where it replaces something that is already ` +
          `there, quote that in an anchor block and put the replacement in a draft block so I can ` +
          `apply it in place. If it is something to add, say exactly where it goes.`
      );
    },
    [ask]
  );

  const clear = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(
        `/api/optimizer/sessions/${encodeURIComponent(sessionId)}/discuss?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) { toast.error("Could not clear that"); return; }
      // Bumped so an answer already in flight cannot fill the conversation back
      // up the moment it lands — which is exactly what a Clear during a stream
      // used to do, silently, after the writer had watched it succeed.
      runRef.current++;
      if (abortRef.current) abortRef.current.abort();
      setTurns([]);
      setStreamed(null);
      setBusy(false);
    } catch {
      toast.error("Could not clear that");
    }
  }, [sessionId, workspaceId]);

  const live = streamed !== null ? splitLive(streamed) : null;
  const liveParsed = live ? parseDiscussReply(live.settled) : null;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {loaded && turns.length === 0 && streamed === null && (
          <div className="rounded-xl border bg-card p-3.5">
            <h3 className="text-[13px] font-semibold mb-1.5">Talk it through</h3>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Engine AI can see the draft as it stands, the brief and everything you have attached.
              Select a passage first to ask about that passage. Anything it offers for the piece
              lands in the document at one click.
            </p>
            <div className="mt-2.5 space-y-1">
              {["Is the opening doing its job?", "This paragraph is flabby — tighten it", "What is this piece missing?"].map((s) => (
                <button
                  key={s}
                  onClick={() => { setQuestion(s); inputRef.current?.focus(); }}
                  className="block w-full text-left text-[12px] text-muted-foreground hover:text-foreground rounded-md px-2 py-1 hover:bg-muted/60"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-xl rounded-br-sm bg-muted px-2.5 py-1.5 text-[12.5px] leading-relaxed whitespace-pre-wrap">
                {t.content}
              </p>
            </div>
          ) : (
            <AssistantTurn key={i} turnIndex={i} content={t.content} hasSelection={hasSelection} onApply={onApply} resolveQuote={resolveQuote} onRevealQuote={onRevealQuote} onFix={askForFix} onPointFix={askForPointFix} />
          )
        )}

        {live && (
          <div className="space-y-1.5">
            {liveParsed && liveParsed.segments.map((seg, i) => (
              <div key={i}>
                {seg.anchor && seg.anchor !== liveParsed.segments[i - 1]?.anchor && (
                  <AnchorChip quote={seg.anchor} resolveQuote={resolveQuote} onRevealQuote={onRevealQuote} />
                )}
                {seg.type === "draft" ? (
                  <DraftBlock
                    text={seg.text}
                    hasSelection={hasSelection}
                    onApply={onApply}
                    anchor={seg.anchor}
                    anchorFound={!!seg.anchor && resolveQuote(seg.anchor)}
                  />
                ) : (
                  <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{seg.text}</p>
                )}
              </div>
            ))}
            {live.partial !== null && (
              <DraftBlock text={live.partial} hasSelection={hasSelection} onApply={onApply} pending />
            )}
            {!streamed && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Reading your draft
              </span>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t p-2.5">
        {selection && (
          // Shown because it changes the question. A writer who thinks nothing
          // is selected, and asks "make this shorter", should be able to see
          // what "this" is before they send it.
          <div className="mb-1.5 flex items-start gap-1.5 rounded-md bg-muted/60 px-2 py-1.5">
            <Quote className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
            <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
              {selection.length > 160 ? `${selection.slice(0, 160)}…` : selection}
            </p>
          </div>
        )}
        <div className="relative">
          <textarea
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); }
            }}
            placeholder={selection ? "Ask about the selected passage…" : "Ask about the draft…"}
            rows={2}
            disabled={busy}
            className="w-full text-[12.5px] bg-transparent border rounded-lg pl-2.5 pr-9 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
          <button
            onClick={() => ask()}
            disabled={busy || !question.trim()}
            className="absolute right-2 bottom-2 text-muted-foreground hover:text-foreground disabled:opacity-40"
            title="Ask"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CornerDownLeft className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[10.5px] text-muted-foreground inline-flex items-center gap-1">
            <Sparkles className="h-2.5 w-2.5" />
            Sees the draft, the brief and your background
          </span>
          {turns.length > 0 && (
            <button
              onClick={clear}
              className="text-[10.5px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              title="Clear this conversation — the piece is untouched"
            >
              <Eraser className="h-2.5 w-2.5" /> Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AssistantTurn({
  turnIndex,
  content,
  hasSelection,
  onApply,
  resolveQuote,
  onRevealQuote,
  onFix,
  onPointFix,
}: {
  turnIndex: number;
  content: string;
  hasSelection: boolean;
  onApply: (text: string, anchor?: string) => "replaced" | "appended" | "failed";
  resolveQuote: (q: string) => boolean;
  onRevealQuote: (q: string) => boolean;
  onFix: (q: string) => void;
  onPointFix: (point: string) => void;
}) {
  // Rendered from SEGMENTS, in the order the model wrote them. Rendering the
  // prose and then the blocks — which is what the flat shape invited — put a
  // sentence ending "delete the setup and you lose nothing:" above nothing, and
  // the sentence that followed the block above the block it referred back to.
  const parsed = parseDiscussReply(content);
  // Which anchors already have a rewrite. An anchor scopes a RUN, so a draft
  // block anywhere in that run means the point is already answered and the
  // offer would duplicate it.
  const answered: { [quote: string]: true } = {};
  for (let i = 0; i < parsed.segments.length; i++) {
    const seg = parsed.segments[i];
    if (seg.type === "draft" && seg.anchor) answered[seg.anchor] = true;
  }
  return (
    <div className="space-y-1.5 transition-shadow" data-turn={turnIndex}>
      {parsed.segments.map((seg, i) => (
        <div key={i}>
          {/* Once per RUN. An anchor now scopes every point until the next one,
              so showing it above each would repeat the writer's own sentence
              back at them two or three times in a row. */}
          {seg.anchor && seg.anchor !== parsed.segments[i - 1]?.anchor && (
            <AnchorChip
              quote={seg.anchor}
              resolveQuote={resolveQuote}
              onRevealQuote={onRevealQuote}
              onFix={answered[seg.anchor] ? undefined : onFix}
            />
          )}
          {seg.type === "draft" ? (
            <DraftBlock
              text={seg.text}
              hasSelection={hasSelection}
              onApply={onApply}
              anchor={seg.anchor}
              anchorFound={!!seg.anchor && resolveQuote(seg.anchor)}
            />
          ) : (
            // Split into paragraphs so each POINT carries its own action. One
            // action for a six-point reply would be an action for none of them.
            <div className="space-y-1.5">
              {seg.text.split(/\n{2,}/).map((para, k) =>
                para.trim() ? (
                  <PointParagraph
                    key={k}
                    text={para.trim()}
                    onFix={seg.anchor ? undefined : onPointFix}
                  />
                ) : null
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
