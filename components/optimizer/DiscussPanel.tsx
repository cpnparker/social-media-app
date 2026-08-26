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
  /** The selected passage, reactive so the Apply button can say what it will do. */
  selection: string;
  /** Put text into the document. Returns what it actually did, so the toast is true. */
  onApply: (text: string) => "replaced" | "appended" | "failed";
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

function DraftBlock({
  text,
  selection,
  onApply,
  pending,
}: {
  text: string;
  selection: string;
  onApply: (text: string) => "replaced" | "appended" | "failed";
  pending?: boolean;
}) {
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
              const what = onApply(text);
              // Reported from what actually happened. A success toast fired
              // before the fact is how a writer comes to believe text landed
              // in a document it never reached.
              if (what === "failed") toast.error("Could not place that — the editor is not ready");
              else toast.success(what === "replaced" ? "Replaced your selection" : "Added to the end");
            }}
          >
            {/* The label says what will happen, which depends on whether
                anything is selected RIGHT NOW. A button reading "Replace
                selection" that appends instead is a small lie the writer only
                catches after it has moved their text. */}
            {selection ? "Replace selection" : "Add to the end"}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function DiscussPanel({ sessionId, workspaceId, getDraftHtml, selection, onApply }: Props) {
  const [turns, setTurns] = useState<DiscussTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [streamed, setStreamed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!sessionId || !workspaceId) { setLoaded(true); return; }
    let cancelled = false;
    fetch(`/api/optimizer/sessions/${encodeURIComponent(sessionId)}/discuss?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d.turns) setTurns(d.turns); })
      .catch(() => { /* an unreachable history is an empty one, not an error state */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [sessionId, workspaceId]);

  // Pinned to the newest message, including as tokens arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, streamed]);

  const ask = useCallback(async () => {
    const q = question.trim();
    if (!q || busy) return;
    if (!workspaceId) { toast.error("Select a workspace first"); return; }

    // The question joins the thread immediately. Waiting for the round trip
    // leaves the writer looking at an input that just emptied itself.
    const asked: DiscussTurn = { role: "user", content: q, at: new Date().toISOString() };
    setTurns((t) => t.concat([asked]));
    setQuestion("");
    setStreamed("");
    setBusy(true);

    try {
      const res = await fetch(`/api/optimizer/sessions/${encodeURIComponent(sessionId)}/discuss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          question: q,
          draftHtml: getDraftHtml(),
          selection: selection || null,
        }),
      });

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
                setStreamed(full);
              } else if (data.error) {
                toast.error(String(data.error));
              }
            } catch { /* a malformed frame is not worth failing the stream over */ }
          }
        }
      }

      if (full.trim()) {
        setTurns((t) => t.concat([{ role: "assistant", content: full, at: new Date().toISOString() }]));
      } else {
        toast.error("That came back empty");
        setTurns((t) => t.filter((x) => x !== asked));
        setQuestion(q);
      }
    } catch {
      toast.error("Could not answer just now");
      setTurns((t) => t.filter((x) => x !== asked));
      setQuestion(q);
    } finally {
      setStreamed(null);
      setBusy(false);
    }
  }, [question, busy, workspaceId, sessionId, getDraftHtml, selection]);

  const clear = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(
        `/api/optimizer/sessions/${encodeURIComponent(sessionId)}/discuss?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) { toast.error("Could not clear that"); return; }
      setTurns([]);
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
            <AssistantTurn key={i} content={t.content} selection={selection} onApply={onApply} />
          )
        )}

        {live && (
          <div>
            {liveParsed && liveParsed.commentary && (
              <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{liveParsed.commentary}</p>
            )}
            {liveParsed && liveParsed.drafts.map((d, i) => (
              <DraftBlock key={i} text={d} selection={selection} onApply={onApply} />
            ))}
            {live.partial !== null && (
              <DraftBlock text={live.partial} selection={selection} onApply={onApply} pending />
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
            onClick={ask}
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
  content,
  selection,
  onApply,
}: {
  content: string;
  selection: string;
  onApply: (text: string) => "replaced" | "appended" | "failed";
}) {
  const parsed = parseDiscussReply(content);
  return (
    <div>
      {parsed.commentary && (
        <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{parsed.commentary}</p>
      )}
      {parsed.drafts.map((d, i) => (
        <DraftBlock key={i} text={d} selection={selection} onApply={onApply} />
      ))}
    </div>
  );
}
