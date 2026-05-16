"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Sparkles, X, Send, Paperclip, Wand2, Film, Image as ImageIcon, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DesignShot } from "@/lib/design/types";

interface AIRailSideProps {
  currentShot: DesignShot | null;
  workspaceId: string | null;
  clientId: number | null;
  contentId: number | null;
  /** Design session id — when set, generated assets attach to the focused shot. */
  designSessionId?: string | null;
  /** All shots in the session — used to compose richer studio context. */
  allShots?: DesignShot[];
  /** Content brief excerpt for context. */
  briefExcerpt?: string | null;
  /** Brand summary for context. */
  brandSummary?: string | null;
  /** Called when the AI generates an image/video — host can refresh canvas/timeline. */
  onAssetReady?: () => void;
  onClose?: () => void;
}

type ProposalCard = { tag: string; summary: string };
type ResultCard = { source: "Artlist" | "Higgsfield" | "Runway"; title: string; thumbHue: number; url?: string };

type Turn =
  | { id: string; from: "ai"; kind: "text"; text: string; status?: string }
  | { id: string; from: "you"; kind: "text"; text: string }
  | { id: string; from: "ai"; kind: "proposal"; proposals: ProposalCard[] }
  | { id: string; from: "ai"; kind: "results"; results: ResultCard[] };

const SUGGESTIONS = [
  { label: "Animate this still",     icon: <Wand2 className="h-3 w-3" /> },
  { label: "Match style of S02",     icon: <ImageIcon className="h-3 w-3" /> },
  { label: "3 b-roll alternates",    icon: <Film className="h-3 w-3" /> },
  { label: "Tighten to 28s",         icon: <Search className="h-3 w-3" /> },
];

export function AIRailSide({ currentShot, workspaceId, clientId, contentId, designSessionId, allShots, briefExcerpt, brandSummary, onAssetReady, onClose }: AIRailSideProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, streaming]);

  const ensureConversation = useCallback(async (): Promise<string | null> => {
    if (conversationId) return conversationId;
    if (!workspaceId) return null;
    try {
      const res = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          mode: "design",
          visibility: "private",
          customerId: clientId ?? undefined,
          contentObjectId: contentId ?? undefined,
          title: "Design rail",
        }),
      });
      if (!res.ok) return null;
      const j = await res.json();
      const id = j?.conversation?.id;
      if (id) setConversationId(id);
      return id || null;
    } catch {
      return null;
    }
  }, [conversationId, workspaceId, clientId, contentId]);

  const send = useCallback(async (text: string) => {
    const v = text.trim();
    if (!v || streaming) return;
    const convId = await ensureConversation();
    if (!convId) return;

    const userTurn: Turn = { id: crypto.randomUUID(), from: "you", kind: "text", text: v };
    const aiTurn: Turn = { id: crypto.randomUUID(), from: "ai", kind: "text", text: "" };
    setTurns((prev) => [...prev, userTurn, aiTurn]);
    setInput("");
    setStreaming(true);
    setStatusLabel(null);

    // Compose a rich studio context block so Claude can reason about the
    // brief, brand, all shots, and the focused shot in one pass.
    const studioContext = buildStudioContext({ allShots: allShots || [], currentShot, briefExcerpt, brandSummary });

    abortRef.current = new AbortController();
    try {
      const res = await fetch(`/api/ai/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: v + studioContext,
          designSessionId: designSessionId ?? undefined,
          designFocusedShotId: currentShot?.id ?? undefined,
        }),
        signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n\n")) !== -1) {
          const event = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 2);
          for (const line of event.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") continue;
            try {
              const data = JSON.parse(payload);
              handleEvent(data, aiTurn.id);
            } catch { /* parse error */ }
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setTurns((prev) => prev.map((t) =>
          t.id === aiTurn.id && t.kind === "text" ? { ...t, text: `⚠️ ${err?.message || "Stream failed"}` } : t
        ));
      }
    } finally {
      setStreaming(false);
      setStatusLabel(null);
    }
  // handleEvent is a closure over setTurns/setStatusLabel/onAssetReady — those are stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, ensureConversation, currentShot, allShots, briefExcerpt, brandSummary, designSessionId, onAssetReady]);

  function handleEvent(data: any, aiTurnId: string) {
    if (typeof data.token === "string") {
      setTurns((prev) => prev.map((t) =>
        t.id === aiTurnId && t.kind === "text" ? { ...t, text: t.text + data.token } : t
      ));
    } else if (data.generating_image) {
      setStatusLabel("Generating image");
    } else if (data.generating_video) {
      setStatusLabel("Generating video");
    } else if (data.video_progress) {
      setStatusLabel(`Generating · ${data.video_progress.percent}%`);
    } else if (data.image_ready || data.video_ready) {
      setStatusLabel(null);
      onAssetReady?.();
      // Append a results turn so the user sees the generated asset
      const ready = data.image_ready || data.video_ready;
      const source: ResultCard["source"] = data.video_ready?.source === "artlist" ? "Artlist" : data.video_ready ? "Runway" : "Higgsfield";
      setTurns((prev) => [...prev, {
        id: crypto.randomUUID(),
        from: "ai",
        kind: "results",
        results: [{
          source,
          title: ready.prompt?.slice(0, 60) || "Generated",
          thumbHue: Math.floor(Math.random() * 360),
          url: ready.url,
        }],
      }]);
    } else if (data.design_shot_created || data.design_shot_updated || data.design_shot_generating || data.design_shot_generated || data.design_shot_committed) {
      onAssetReady?.();
      if (data.design_shot_generated) {
        setStatusLabel(null);
      } else if (data.design_shot_generating) {
        setStatusLabel("Generating shot");
      }
    } else if (data.design_shot_error) {
      setStatusLabel(null);
      onAssetReady?.();
    } else if (data.artlist_results) {
      const items: ResultCard[] = (data.artlist_results.items || []).slice(0, 4).map((it: any) => ({
        source: "Artlist" as const,
        title: it.title || "Artlist clip",
        thumbHue: 158,
      }));
      setTurns((prev) => [...prev, { id: crypto.randomUUID(), from: "ai", kind: "results", results: items }]);
    }
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
        {contentId && <ContextChip>Content</ContextChip>}
      </div>

      {/* Turn stream */}
      <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {turns.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <Sparkles className="h-5 w-5" style={{ color: "hsl(var(--design-accent))" }} />
            <div className="editorial-display text-[15px]">How shall we shape this?</div>
            <div className="text-[11px] text-muted-foreground">
              Ask for directions, b-roll, animations, or a rewrite of the focused shot.
            </div>
          </div>
        )}
        {turns.map((t) => <TurnView key={t.id} turn={t} />)}
        {streaming && statusLabel && (
          <div className="flex items-center gap-1.5 px-2 text-[10.5px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {statusLabel}
          </div>
        )}
      </div>

      {/* Suggestions */}
      <div className="flex flex-wrap gap-1.5 border-t px-3 py-2"
           style={{ borderColor: "hsl(var(--design-border))" }}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            onClick={() => setInput(s.label)}
            disabled={streaming}
            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] hover:border-[hsl(var(--design-accent))]/40 hover:bg-[hsl(var(--design-accent-soft))]/50 disabled:opacity-50"
            style={{ borderColor: "hsl(var(--design-border))" }}
          >
            <Sparkles className="h-2.5 w-2.5" style={{ color: "hsl(var(--design-accent))" }} />
            {s.label}
          </button>
        ))}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="border-t p-3"
        style={{ borderColor: "hsl(var(--design-border))" }}
      >
        <div className="rounded-lg border bg-[hsl(var(--design-bg))] p-2"
             style={{ borderColor: "hsl(var(--design-border))" }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Ask Engine AI · ⌘K to summon"
            rows={2}
            disabled={streaming}
            className="block w-full resize-none border-0 bg-transparent text-[12.5px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <div className="mt-1 flex items-center gap-1.5">
            <button type="button" className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:bg-[hsl(var(--design-border))]/40">
              <Paperclip className="h-3 w-3" /> Attach shot
            </button>
            <span className="pill pill-accent ml-auto">Claude</span>
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="rounded-full bg-[hsl(var(--design-accent))] p-1.5 text-white shadow-sm disabled:opacity-40"
              aria-label="Send"
            >
              {streaming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
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
          <Bubble>{turn.text || <span className="text-muted-foreground">…</span>}</Bubble>
        )}
        {turn.kind === "proposal" && (
          <Bubble>
            <div className="text-[12px] mb-1.5">Three directions:</div>
            <div className="space-y-1.5">
              {turn.proposals.map((p, i) => (
                <button
                  key={i}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left transition-colors",
                  )}
                  style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg))" }}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wider"
                        style={{ color: "hsl(var(--design-muted-strong))" }}>
                    {p.tag}
                  </span>
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
                  {r.url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.url} alt={r.title} className="absolute inset-0 h-full w-full object-cover" />
                  )}
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
      className="rounded-2xl rounded-tl-md border px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap"
      style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg))" }}
    >
      {children}
    </div>
  );
}

/**
 * Build the studio context block appended to every user message. Gives Claude
 * the brief, brand, all-shots overview, and the focused shot in a single
 * compact block so it can reason across the session without us having to
 * thread state through tool calls.
 */
function buildStudioContext(opts: {
  allShots: DesignShot[];
  currentShot: DesignShot | null;
  briefExcerpt?: string | null;
  brandSummary?: string | null;
}): string {
  const lines: string[] = [];
  lines.push("\n\n---");
  lines.push("[Design Mode session context — for your reasoning, not for the user to see]");

  if (opts.briefExcerpt) {
    const brief = opts.briefExcerpt.replace(/\s+/g, " ").trim().slice(0, 280);
    lines.push(`Brief: ${brief}${opts.briefExcerpt.length > 280 ? "…" : ""}`);
  }
  if (opts.brandSummary) {
    const b = opts.brandSummary.replace(/\s+/g, " ").trim().slice(0, 180);
    lines.push(`Brand: ${b}`);
  }

  if (opts.allShots.length > 0) {
    lines.push(`Shots (${opts.allShots.length}):`);
    for (const s of opts.allShots.slice(0, 12)) {
      const tag = s.id === opts.currentShot?.id ? "→ " : "  ";
      const status = s.status === "approved" ? "✓" : s.status === "drift" ? "⚠" : s.status;
      const v = s.versions.length > 0 ? ` (v${s.versions.length})` : "";
      lines.push(`${tag}S${String(s.idx).padStart(2, "0")} "${s.title}" [${s.beat || "—"}, ${s.duration}s, ${s.modelId || "no model"}${v}] ${status}`);
    }
    if (opts.allShots.length > 12) lines.push(`  … +${opts.allShots.length - 12} more`);
  }

  if (opts.currentShot) {
    const cs = opts.currentShot;
    lines.push(`Focused: S${String(cs.idx).padStart(2, "0")} — prompt: "${(cs.prompt || "(empty)").slice(0, 200)}"`);
  }

  return lines.join("\n");
}
