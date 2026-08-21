"use client";

/**
 * The Content Optimizer studio.
 *
 * Sits inside the EngineAI shell (app/engineai/layout.tsx), so it must render
 * as a flex CHILD of a `flex h-dvh overflow-hidden` row — not as a top-level
 * scroll container. No optimizer/layout.tsx: the auth guard, providers and the
 * engine-ai-scope class all come from the parent.
 *
 * M2 covers Phase 1 (brief and draft) and the live deterministic score panel.
 * Phase 2's inline highlights and Phase 3's report land in later milestones —
 * the score panel here is engine-only, which is what makes it safe to run on
 * every keystroke.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "@/lib/contexts/WorkspaceContext";
import { useCustomer } from "@/lib/contexts/CustomerContext";
import TiptapEditor from "@/components/content/TiptapEditor";
import ScorePanel from "@/components/optimizer/ScorePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ArrowRight, Loader2, Sparkles, X } from "lucide-react";
import type { Editor } from "@tiptap/react";
import type { DraftInput } from "@/lib/optimizer/engine";
import type { ClientCanon } from "@/lib/optimizer/client-canon";

const FORMATS = ["explainer", "ranked list", "FAQ", "data brief", "op-ed"];
const PLATFORMS: { id: string; label: string }[] = [
  { id: "balanced", label: "Balanced" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "aio", label: "AI Overviews" },
  { id: "perplexity", label: "Perplexity" },
];

export default function OptimizerPage() {
  const { selectedWorkspace } = useWorkspace();
  const { selectedCustomer } = useCustomer();
  const workspaceId = selectedWorkspace?.id || null;

  const [phase, setPhase] = useState<"brief" | "studio">("brief");
  const [title, setTitle] = useState("");
  const [queries, setQueries] = useState<string[]>([]);
  const [queryDraft, setQueryDraft] = useState("");
  const [format, setFormat] = useState("explainer");
  const [platform, setPlatform] = useState("balanced");
  const [audience, setAudience] = useState("");
  const [goal, setGoal] = useState("");

  const [canon, setCanon] = useState<ClientCanon | null>(null);
  const [canonLoading, setCanonLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);

  // Probed once on mount rather than discovered on submit. Without this the
  // writer fills in an entire brief, hits Generate, and gets a toast — the
  // work is not lost but the failure arrives at the worst possible moment, and
  // it does not say what to do about it.
  const [access, setAccess] = useState<"checking" | "ok" | "denied">("checking");

  const editorRef = useRef<Editor | null>(null);
  // While streaming, the parent must NOT push `content` into the editor: the
  // prop-change effect would fire setContent and wipe the inserted nodes. The
  // editor is fed through insertContentAt instead, and `content` is synced once
  // at the end.
  const streamBufferRef = useRef("");

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    fetch(`/api/optimizer/sessions?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((r) => { if (!cancelled) setAccess(r.ok ? "ok" : "denied"); })
      .catch(() => { if (!cancelled) setAccess("denied"); });
    return () => { cancelled = true; };
  }, [workspaceId]);

  // ── The canon ──
  useEffect(() => {
    if (!workspaceId || !selectedCustomer) { setCanon(null); return; }
    let cancelled = false;
    setCanonLoading(true);
    fetch(`/api/optimizer/canon?workspaceId=${encodeURIComponent(workspaceId)}&clientId=${encodeURIComponent(selectedCustomer.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.canon) setCanon(d.canon); })
      .catch(() => { /* a missing canon is a thinner brief, not an error */ })
      .finally(() => { if (!cancelled) setCanonLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId, selectedCustomer?.id]);

  const addQuery = () => {
    const q = queryDraft.trim();
    if (!q || queries.length >= 5) return;
    setQueries((prev) => (prev.indexOf(q) >= 0 ? prev : [...prev, q]));
    setQueryDraft("");
  };

  // ── Generate ──
  const generate = useCallback(async () => {
    if (!workspaceId) { toast.error("Select a workspace first"); return; }
    if (!title.trim()) { toast.error("Give the piece a working title"); return; }

    setBusy(true);
    try {
      const createRes = await fetch("/api/optimizer/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId, title, targetQueries: queries, format, platform,
          audience, goal, clientId: selectedCustomer ? Number(selectedCustomer.id) : null,
        }),
      });
      const created = await createRes.json();
      if (!createRes.ok) { toast.error(created.error || "Could not start that piece"); return; }

      setSessionId(created.sessionId);
      if (created.canon?.clientName) setCanon(created.canon);
      setPhase("studio");
      setBody("");
      streamBufferRef.current = "";
      setStreaming(true);

      const res = await fetch(`/api/optimizer/sessions/${created.sessionId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Generation failed");
        setStreaming(false);
        return;
      }

      // Frames are `data: {...}\n\n`, with a bare `data: [DONE]` sentinel that
      // is NOT JSON. The buffer split on "\n\n" is load-bearing: a frame can
      // arrive split across two reads.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let pending = "";
      let flushTimer: any = null;

      const flush = () => {
        if (!pending || !editorRef.current) return;
        editorRef.current
          .chain()
          .insertContentAt(editorRef.current.state.doc.content.size, pending.replace(/\n/g, "<br>"), {
            updateSelection: false,
          })
          .run();
        pending = "";
      };

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
                streamBufferRef.current += data.token;
                pending += data.token;
                if (!flushTimer) {
                  flushTimer = setTimeout(() => { flush(); flushTimer = null; }, 80);
                }
              } else if (data.error) {
                toast.error(String(data.error));
              }
            } catch { /* a malformed frame is not worth failing the stream over */ }
          }
        }
      }
      if (flushTimer) clearTimeout(flushTimer);
      flush();
      setBody(streamBufferRef.current);
    } catch (e: any) {
      toast.error(e?.message || "Generation failed");
    } finally {
      setStreaming(false);
      setBusy(false);
    }
  }, [workspaceId, title, queries, format, platform, audience, goal, selectedCustomer]);

  // ── Persist edits ──
  const saveBody = useCallback(
    async (html: string) => {
      setBody(html);
      if (!sessionId || !workspaceId || streaming) return;
      try {
        await fetch(`/api/optimizer/sessions/${sessionId}/draft`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, body: html }),
        });
      } catch { /* the editor keeps the text; a failed save retries on the next edit */ }
    },
    [sessionId, workspaceId, streaming]
  );

  const scoreInput: DraftInput = useMemo(
    () => ({
      body: streaming ? streamBufferRef.current : body,
      title,
      targetQueries: queries,
      format,
      brandName: canon?.brandName,
      brandAliases: canon?.brandAliases,
    }),
    [body, streaming, title, queries, format, canon]
  );

  if (access === "denied") {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-8">
        <div className="max-w-md flex flex-col gap-3 text-center">
          <h1 className="text-lg font-semibold">The Content Optimiser is not switched on yet</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The code is deployed, but the feature is still dark: its database tables have not been
            created and no account has been granted access. Both are deliberate, one-time steps —
            see <span className="font-mono text-[12px]">supabase/migrations/20260821_content_optimizer.sql</span>.
          </p>
          <p className="text-xs text-muted-foreground">
            Run that migration in the Supabase SQL Editor, then set{" "}
            <span className="font-mono">flag_access_optimizer = 1</span> for your user.
          </p>
        </div>
      </div>
    );
  }

  // ── Brief ──
  if (phase === "brief") {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-[46rem] px-6 py-10 flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">New piece</h1>
            <p className="text-sm text-muted-foreground">
              Brief it, and EngineAI drafts it answer-optimised from the first line.
              {selectedCustomer ? ` Grounded in what we know about ${selectedCustomer.name}.` : ""}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="opt-title">Working title</Label>
            <Input id="opt-title" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="What is generative engine optimisation? A practical guide" />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="opt-query">Target AI queries</Label>
              <span className="text-xs text-muted-foreground">What a buyer asks an AI before they know you exist</span>
            </div>
            <div className="rounded-xl border bg-card p-3 flex flex-col gap-2">
              {queries.map((q) => (
                <div key={q} className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-2.5 py-1 text-[13px] font-medium text-primary">
                    {q}
                    <button onClick={() => setQueries((p) => p.filter((x) => x !== q))} aria-label={`Remove ${q}`}>
                      <X className="h-3 w-3 opacity-60" />
                    </button>
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Input id="opt-query" value={queryDraft} onChange={(e) => setQueryDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addQuery(); } }}
                  placeholder={queries.length >= 5 ? "Five is plenty" : "Add a query and press Enter"}
                  disabled={queries.length >= 5} className="h-8 text-[13px]" />
              </div>
              {canon && canon.suggestedQueries.length > 0 && (
                <div className="flex flex-col gap-1.5 border-t pt-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    From this client&apos;s meetings and record
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {canon.suggestedQueries.map((q) => (
                      <button key={q} onClick={() => setQueries((p) => (p.indexOf(q) >= 0 || p.length >= 5 ? p : [...p, q]))}
                        className="rounded-lg border border-dashed px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground hover:border-solid">
                        + {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div className="flex flex-col gap-2">
              <Label>Format</Label>
              <div className="flex flex-wrap gap-1.5">
                {FORMATS.map((f) => (
                  <button key={f} onClick={() => setFormat(f)}
                    className={cn("rounded-lg px-3 py-1.5 text-[12.5px] font-medium border",
                      format === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground")}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Optimise for</Label>
              <div className="flex flex-wrap gap-1.5">
                {PLATFORMS.map((p) => (
                  <button key={p.id} onClick={() => setPlatform(p.id)}
                    className={cn("rounded-lg px-3 py-1.5 text-[12.5px] font-medium border",
                      platform === p.id ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground")}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="opt-audience">Audience &amp; goal</Label>
            <Textarea id="opt-audience" value={audience} onChange={(e) => setAudience(e.target.value)} rows={2}
              placeholder="Who is this for, and what should AI learn to repeat about the brand?" />
            <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2}
              placeholder="What should the reader take away?" />
          </div>

          {selectedCustomer && (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <Label>Client canon</Label>
                <span className="text-xs text-muted-foreground">
                  {canonLoading ? "Loading…" : "Drafts check facts against this"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(canon?.facts || []).slice(0, 8).map((f, i) => (
                  <span key={i} title={f.detail || ""}
                    className="rounded-full border bg-muted/50 px-2.5 py-1 text-[12px]">
                    <span className="text-muted-foreground">{f.source} · </span>{f.text.slice(0, 90)}
                  </span>
                ))}
                {canon && canon.facts.length === 0 && !canonLoading && (
                  <span className="text-[12px] text-muted-foreground">
                    Nothing on file for this client yet — the draft will be written from the brief alone.
                  </span>
                )}
              </div>
              {canon && canon.gaps.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Not contributing: {canon.gaps.map((g) => `${g.source} (${g.reason.toLowerCase()})`).join("; ")}.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-end pt-2">
            <Button onClick={generate} disabled={busy || !title.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate draft
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Studio ──
  return (
    <>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="shrink-0 h-12 border-b flex items-center gap-3 px-4">
          <button onClick={() => setPhase("brief")} className="text-[13px] text-muted-foreground hover:text-foreground">
            ← Brief
          </button>
          <span className="text-[13px] font-semibold truncate">{title}</span>
          {streaming && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> writing
            </span>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-[46rem] px-6 py-6">
            <TiptapEditor
              content={streaming ? "" : body}
              onChange={saveBody}
              onReady={(e) => { editorRef.current = e; }}
              editable={!streaming}
              debounceMs={600}
              placeholder="Paste or write your content here…"
            />
          </div>
        </div>
      </div>
      <div className="hidden lg:flex shrink-0 w-[380px] border-l bg-background flex-col min-h-0">
        <ScorePanel input={scoreInput} muted={streaming} />
      </div>
    </>
  );
}
