"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, X, Send, Paperclip, Wand2, Film, Image as ImageIcon, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DesignShot } from "@/lib/design/types";

interface AIRailSideProps {
  currentShot: DesignShot | null;
  onClose?: () => void;
}

type Turn =
  | { id: string; from: "ai"; kind: "text"; text: string }
  | { id: string; from: "you"; kind: "text"; text: string }
  | { id: string; from: "ai"; kind: "proposal"; proposals: Array<{ tag: string; summary: string }> }
  | { id: string; from: "ai"; kind: "results"; results: Array<{ source: "Artlist" | "Higgsfield"; title: string; thumbHue: number }> }
  | { id: string; from: "ai"; kind: "ack"; text: string };

const SEED_TURNS: Turn[] = [
  {
    id: "t1", from: "ai", kind: "proposal",
    proposals: [
      { tag: "A · Foundation-led", summary: "Open with landscape — Muscat at first light. Patient cuts." },
      { tag: "B · Conviction-led", summary: "Chairman first. Portrait, hand on table, eye contact." },
      { tag: "C · Horizon-led",    summary: "Open at the port. Long take. Slow crane unison." },
    ],
  },
  { id: "t2", from: "you", kind: "text", text: "Going with Foundation-led. Lock the chairman to shot 3 like the script says." },
  { id: "t3", from: "ai", kind: "ack", text: "Locked. Shot list updated to 6 beats. S05 is drifting 4pts above the gold threshold — flagged it on the shot, not blocking." },
];

const SUGGESTIONS = [
  { label: "Animate this still",     icon: <Wand2 className="h-3 w-3" /> },
  { label: "Match style of S02",     icon: <ImageIcon className="h-3 w-3" /> },
  { label: "3 b-roll alternates",    icon: <Film className="h-3 w-3" /> },
  { label: "Tighten to 28s",         icon: <Search className="h-3 w-3" /> },
];

export function AIRailSide({ currentShot, onClose }: AIRailSideProps) {
  const [turns, setTurns] = useState<Turn[]>(SEED_TURNS);
  const [input, setInput] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length]);

  function send() {
    const v = input.trim();
    if (!v) return;
    setTurns((prev) => [...prev, { id: crypto.randomUUID(), from: "you", kind: "text", text: v }]);
    setInput("");
    // Placeholder ack — real impl would stream via /api/ai/conversations/<id>/messages
    setTimeout(() => {
      setTurns((prev) => [...prev, { id: crypto.randomUUID(), from: "ai", kind: "ack", text: "Working on it…" }]);
    }, 200);
  }

  return (
    <aside
      className="flex w-[360px] flex-shrink-0 flex-col border-l"
      style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg-elev))" }}
    >
      {/* Head */}
      <div className="flex items-center gap-2 border-b px-3 py-2.5"
           style={{ borderColor: "hsl(var(--design-border))" }}>
        <span className="h-2 w-2 rounded-full" style={{ background: "hsl(var(--design-accent))" }} />
        <span className="text-[12.5px] font-semibold">Engine AI</span>
        <span className="text-[10px] text-muted-foreground">
          scoped · {currentShot ? `S${String(currentShot.idx).padStart(2, "0")}` : "session"} · auto context
        </span>
        <div className="flex-1" />
        <span className="pill pill-accent">Claude · auto</span>
        {onClose && (
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-[hsl(var(--design-border))]/40">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Context chips */}
      <div className="flex flex-wrap gap-1 border-b px-3 py-2"
           style={{ borderColor: "hsl(var(--design-border))" }}>
        <ContextChip>Brief</ContextChip>
        <ContextChip>Brand kit</ContextChip>
        <ContextChip>{currentShot ? `S${String(currentShot.idx).padStart(2, "0")}` : "All shots"}</ContextChip>
        <ContextChip>VO track</ContextChip>
        <ContextChip>Meeting · May 12</ContextChip>
      </div>

      {/* Turn stream */}
      <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {turns.map((t) => <TurnView key={t.id} turn={t} />)}
      </div>

      {/* Suggestions */}
      <div className="flex flex-wrap gap-1.5 border-t px-3 py-2"
           style={{ borderColor: "hsl(var(--design-border))" }}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            onClick={() => setInput(s.label)}
            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] hover:border-[hsl(var(--design-accent))]/40 hover:bg-[hsl(var(--design-accent-soft))]/50"
            style={{ borderColor: "hsl(var(--design-border))" }}
          >
            <Sparkles className="h-2.5 w-2.5" style={{ color: "hsl(var(--design-accent))" }} />
            {s.label}
          </button>
        ))}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="border-t p-3"
        style={{ borderColor: "hsl(var(--design-border))" }}
      >
        <div className="rounded-lg border bg-[hsl(var(--design-bg))] p-2"
             style={{ borderColor: "hsl(var(--design-border))" }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask Engine AI · ⌘K to summon"
            rows={2}
            className="block w-full resize-none border-0 bg-transparent text-[12.5px] leading-relaxed outline-none placeholder:text-muted-foreground"
          />
          <div className="mt-1 flex items-center gap-1.5">
            <button type="button" className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:bg-[hsl(var(--design-border))]/40">
              <Paperclip className="h-3 w-3" /> Attach shot
            </button>
            <span className="pill pill-accent ml-auto">Claude</span>
            <button
              type="submit"
              disabled={!input.trim()}
              className="rounded-full bg-[hsl(var(--design-accent))] p-1.5 text-white shadow-sm disabled:opacity-40"
              aria-label="Send"
            >
              <Send className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div className="mt-1 px-1 text-[10px] text-muted-foreground">
          ⌘K to summon · Enter to send · ⇧Enter newline
        </div>
      </form>
    </aside>
  );
}

function ContextChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]"
          style={{ borderColor: "hsl(var(--design-border))", color: "hsl(var(--design-muted-strong))" }}>
      {children}
    </span>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.from === "you") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-2xl rounded-tr-md px-3 py-2 text-[12.5px] leading-relaxed text-white"
          style={{ background: "hsl(var(--design-fg))" }}
        >
          {turn.text}
        </div>
      </div>
    );
  }

  // AI turns get an avatar + bubble with rounded-top-right corner
  return (
    <div className="flex gap-2">
      <div
        className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
        style={{ background: "hsl(var(--design-accent-soft))" }}
      >
        <Sparkles className="h-3 w-3" style={{ color: "hsl(var(--design-accent))" }} />
      </div>
      <div className="min-w-0 flex-1">
        {turn.kind === "text" && (
          <Bubble>{turn.text}</Bubble>
        )}
        {turn.kind === "ack" && (
          <Bubble>{turn.text}</Bubble>
        )}
        {turn.kind === "proposal" && (
          <Bubble>
            <div className="text-[12px] mb-1.5">Three directions for the brief:</div>
            <div className="space-y-1.5">
              {turn.proposals.map((p, i) => (
                <button
                  key={i}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left transition-colors",
                    i === 0 && "ring-1",
                  )}
                  style={i === 0
                    ? { borderColor: "hsl(var(--design-accent))", background: "hsl(var(--design-accent-soft))" }
                    : { borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg))" }
                  }
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider"
                          style={{ color: i === 0 ? "hsl(var(--design-accent))" : "hsl(var(--design-muted-strong))" }}>
                      {p.tag}
                    </span>
                  </div>
                  <span className="text-[11.5px] leading-snug">{p.summary}</span>
                </button>
              ))}
            </div>
          </Bubble>
        )}
        {turn.kind === "results" && (
          <Bubble>
            <div className="grid grid-cols-2 gap-1.5">
              {turn.results.map((r, i) => (
                <div key={i} className="thumb thumb-stripe relative aspect-[16/9] overflow-hidden rounded-md"
                     style={{ ['--th' as any]: String(r.thumbHue) }}>
                  <span className={cn("pill", r.source === "Artlist" ? "pill-artlist" : "pill-runway", "absolute right-1 top-1")}>
                    {r.source}
                  </span>
                  <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1 text-[9px] text-white/90">
                    {r.title}
                  </div>
                </div>
              ))}
            </div>
          </Bubble>
        )}
      </div>
    </div>
  );
}

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl rounded-tl-md border px-3 py-2 text-[12.5px] leading-relaxed"
      style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg))" }}
    >
      {children}
    </div>
  );
}
