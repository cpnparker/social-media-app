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

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { ArrowLeft, ArrowRight, Check, Copy, Loader2, Menu, Sparkles, X } from "lucide-react";
import { htmlToMarkdown, htmlToPlainText } from "@/lib/optimizer/export";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Editor } from "@tiptap/react";
import type { DraftInput } from "@/lib/optimizer/engine";
import type { ClientCanon } from "@/lib/optimizer/client-canon";
import IssueList from "@/components/optimizer/IssueList";
import CoveragePanel from "@/components/optimizer/CoveragePanel";
import IssuePopover from "@/components/optimizer/IssuePopover";
import { chromeFor, labelOf, DEFAULT_CONTENT_TYPE, detectContentType, shouldAnnounce } from "@/lib/optimizer/content-types";
import PageAudit from "@/components/optimizer/PageAudit";
import StartScreen from "@/components/optimizer/StartScreen";
import EngineAISidebar from "@/components/engineai/EngineAISidebar";
import {
  OptimizerHighlight, optimizerHighlightKey, applyFinding,
} from "@/lib/optimizer/highlight-plugin";
import { buildDocIndex, textRangeToPos } from "@/lib/optimizer/doc-index";
import type { Issue, HighlightFinding } from "@/lib/optimizer/highlight-plugin";
import { buildLiveFindings } from "@/lib/optimizer/live-issues";
import { parseDraft } from "@/lib/optimizer/parse";
import { computeDraftScores } from "@/lib/optimizer/engine";

/**
 * Module constant, deliberately. useEditor does not rebuild on a changed
 * extension array, so an inline literal would be silently ignored after the
 * first render and the highlight plugin would never load.
 */
const OPTIMIZER_EXTENSIONS = [OptimizerHighlight];

const FORMATS = ["explainer", "ranked list", "FAQ", "data brief", "op-ed"];
const PLATFORMS: { id: string; label: string }[] = [
  { id: "balanced", label: "Balanced" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "aio", label: "AI Overviews" },
  { id: "perplexity", label: "Perplexity" },
];

function OptimizerStudio() {
  const { selectedWorkspace } = useWorkspace();
  const { selectedCustomer } = useCustomer();
  const workspaceId = selectedWorkspace?.id || null;
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSession = searchParams.get("session");

  const [phase, setPhase] = useState<"start" | "brief" | "studio">("start");
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
  /**
   * The KIND of document. Drives which analyses may run and — the half that
   * matters here — what the cockpit is allowed to render at all. Everything
   * below reads `chrome`, never the id: one type is deliberately unnamed and a
   * component that tests the id directly is one interpolation away from
   * printing it. verify-optimizer-types asserts no UI file contains it.
   */
  const [contentTypeId, setContentTypeId] = useState<string>(DEFAULT_CONTENT_TYPE);
  const chrome = chromeFor(contentTypeId);
  const typeLabel = labelOf(contentTypeId);
  const [body, setBody] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);

  // Probed once on mount rather than discovered on submit. Without this the
  // writer fills in an entire brief, hits Generate, and gets a toast — the
  // work is not lost but the failure arrives at the worst possible moment, and
  // it does not say what to do about it.
  const [access, setAccess] = useState<"checking" | "ok" | "denied">("checking");
  const [assessing, setAssessing] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<{ dropped: number; orphaned: number; gateRejected: number } | null>(null);
  const [panelTab, setPanelTab] = useState<"score" | "issues" | "coverage">("score");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /**
   * The body as it stood when the last assessment ran.
   *
   * "Has this been assessed?" is not a boolean once the writer starts editing.
   * Marks anchored to text that has since changed are stale, and showing a
   * confident tick over them is the same class of dishonesty as printing a
   * score over a skipped pillar. Kept as the text itself rather than a flag so
   * an undo back to the assessed state correctly reads as assessed again.
   */
  const [assessedBody, setAssessedBody] = useState<string | null>(null);
  /**
   * URL-imported sessions get two views: Optimise (the editor) and Page audit
   * (the live page's furniture plus its text through the same rubric). The
   * source ref is what makes the audit possible, so both come from hydration
   * together and the tab renders only when there is a page to audit.
   */
  const [studioView, setStudioView] = useState<"optimise" | "audit">("optimise");
  const [sourceInfo, setSourceInfo] = useState<{ source: string; ref: string | null }>({ source: "generated", ref: null });
  const [navSearch, setNavSearch] = useState("");
  const [navTab, setNavTab] = useState<"private" | "team">("private");
  /** Conversations, listed read-only. Clicking one leaves for the chat surface,
   *  so none of the chat page's rename/pin/delete affordances belong here. */
  const [conversations, setConversations] = useState<{ id: string; title: string; visibility: string; updatedAt: string }[]>([]);
  const [convLoading, setConvLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) { setConversations([]); setConvLoading(false); return; }
    let cancelled = false;
    setConvLoading(true);
    fetch(`/api/ai/conversations?workspaceId=${encodeURIComponent(workspaceId)}&mode=general`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setConversations(
          (d.conversations || []).map((c: any) => ({
            id: c.id, title: c.title || "Untitled",
            visibility: c.visibility || "private", updatedAt: c.updatedAt,
          }))
        );
      })
      .catch(() => { /* the nav degrades to articles only, which is the point of this surface */ })
      .finally(() => { if (!cancelled) setConvLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId]);

  // Match FIRST, then filter by visibility — never the reverse, or a team
  // conversation vanishes for someone searching in Private and reads as deleted.
  const visibleConversations = conversations.filter((c) => {
    if (navSearch && c.title.toLowerCase().indexOf(navSearch.toLowerCase()) < 0) return false;
    return c.visibility === navTab;
  });

  const editorRef = useRef<Editor | null>(null);
  /** The editor's scroll container — the popover positions inside it so it
   *  scrolls with the text instead of floating over the wrong sentence. */
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
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

  /**
   * The URL is the single source of truth for which piece is open.
   * Everything that opens one goes through here, so a link to
   * /engineai/optimizer?session=<id> behaves exactly like clicking the piece —
   * which is what makes an article shareable and what lets the sidebar and the
   * search results point at one.
   */
  const openSession = useCallback((id: string) => {
    router.replace(`/engineai/optimizer?session=${encodeURIComponent(id)}`, { scroll: false });
  }, [router]);

  const closeSession = useCallback(() => {
    router.replace("/engineai/optimizer", { scroll: false });
    setSessionId(null);
    setContentTypeId(DEFAULT_CONTENT_TYPE);
    setPhase("start");
    setBody("");
    setTitle("");
    setQueries([]);
    setIssues([]);
    setDiagnostics(null);
    setPanelTab("score");
    // A generated piece must not inherit the previous article's audit view or
    // source: stale sourceInfo kept the Page audit tab alive for a session
    // with no page, and the streaming draft wrote into a hidden editor.
    setStudioView("optimise");
    setSourceInfo({ source: "generated", ref: null });
  }, [router]);

  // Hydrate whatever the URL names. Runs on mount and on every change of the
  // session parameter, so back/forward through the browser history works
  // without a reload. `hydratedRef` stops the effect re-fetching the session it
  // just loaded when unrelated state changes.
  const hydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!urlSession) {
      hydratedRef.current = null;
      return;
    }
    if (!workspaceId) return;
    if (hydratedRef.current === urlSession) return;
    // Claim it BEFORE the await. Without this the effect can re-enter while the
    // first fetch is in flight and hydrate the same session twice, the second
    // response overwriting edits made against the first.
    hydratedRef.current = urlSession;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/optimizer/sessions/${encodeURIComponent(urlSession)}/draft?workspaceId=${encodeURIComponent(workspaceId)}`
        );
        if (!res.ok) {
          if (cancelled) return;
          hydratedRef.current = null;
          toast.error(res.status === 404 ? "That piece no longer exists" : "Could not open that piece");
          router.replace("/engineai/optimizer", { scroll: false });
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        const sess = data.session || {};
        setSessionId(sess.id || urlSession);
        setTitle(sess.title || "");
        setSourceInfo({ source: sess.source || "generated", ref: sess.sourceRef || null });
        setStudioView("optimise");
        setFormat(sess.format || "explainer");
        setContentTypeId(sess.contentType || DEFAULT_CONTENT_TYPE);
        setPlatform(sess.platform || "balanced");
        if (sess.canon && sess.canon.clientName) setCanon(sess.canon);
        const brief = sess.brief || {};
        setQueries(Array.isArray(brief.targetQueries) ? brief.targetQueries : []);
        setAudience(brief.audience || "");
        setGoal(brief.goal || "");
        // streamBufferRef feeds the live score while streaming; keep it in step
        // with the body so a hydrated piece scores immediately rather than
        // reading as empty until the first keystroke.
        const html = (data.draft && data.draft.document_body) || "";
        streamBufferRef.current = html;
        setBody(html);
        setIssues([]);
        // Findings already paid for, restored rather than discarded. This used
        // to clear them, so reopening a piece lost every mark and pressing
        // Assess again just hit the memo.
        const stored: HighlightFinding[] = (data.findings || []).map((f: any) => ({
          id: f.id, criterion: f.criterion, severity: f.severity,
          quote: f.quote, prefix: f.prefix, suffix: f.suffix,
          explanation: f.explanation, suggestedEdit: f.suggestedEdit ?? null,
        }));
        judgeFindingsRef.current = stored;
        setDiagnostics(data.assessment ? { dropped: 0, orphaned: 0, gateRejected: 0 } : null);
        setAssessedBody(data.assessment ? html : null);
        setPhase("studio");
        // The editor receives `body` on the next render; paint once it has.
        setTimeout(() => repaintLive(), 60);
      } catch {
        if (cancelled) return;
        hydratedRef.current = null;
        toast.error("Could not open that piece");
      }
    })();
    return () => { cancelled = true; };
  }, [urlSession, workspaceId, router]);

  /**
   * Adds a target query to a piece that is already open, and PERSISTS it.
   * The assess route reads the brief from the row, so a query kept only in
   * React would move the live score and leave the judge scoring against
   * nothing — two numbers disagreeing with no visible cause.
   */
  const addTargetQuery = useCallback(async (q: string) => {
    const query = q.trim();
    if (!query || queries.indexOf(query) >= 0) return;
    // Computed from `queries` rather than inside a setState updater: reading the
    // next value out of an updater's side effect works by accident, and breaks
    // the moment React calls it twice.
    const next = [...queries, query].slice(0, 5);
    setQueries(next);
    if (!sessionId || !workspaceId) return;
    try {
      const res = await fetch(`/api/optimizer/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, targetQueries: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // Say so rather than leaving a query that scores here and nowhere else.
      toast.error("Added here, but not saved — assessing may not see it");
    }
  }, [queries, sessionId, workspaceId]);

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
      setStudioView("optimise");
      setSourceInfo({ source: "generated", ref: null });
      if (created.canon?.clientName) setCanon(created.canon);
      // Mark it hydrated before the URL changes: the piece is already in state
      // and the hydration effect would otherwise fetch it back mid-stream and
      // overwrite the tokens as they arrive.
      hydratedRef.current = created.sessionId;
      openSession(created.sessionId);
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

  // ── Assess ──
  const runAssess = useCallback(async () => {
    if (!sessionId || !workspaceId || assessing) return;
    setAssessing(true);
    try {
      const res = await fetch(`/api/optimizer/sessions/${sessionId}/assess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await res.json();
      if (!res.ok) {
        // The route distinguishes a deterministic failure from a transient one.
        // Saying "try again" on a truncation is advice to spend the same money
        // for the same result, so the message reflects which it was.
        toast.error(data.error || "Assessment failed");
        return;
      }
      setDiagnostics(data.diagnostics || null);
      const findings: HighlightFinding[] = (data.findings || []).map((f: any, i: number) => ({
        id: f.id || `f${i}`,
        criterion: f.criterion,
        severity: f.severity,
        quote: f.quote,
        prefix: f.prefix,
        suffix: f.suffix,
        explanation: f.explanation,
        suggestedEdit: f.suggestedEdit || null,
      }));
      const editor = editorRef.current;
      if (editor) {
        // Held so a live repaint (which fires on every edit) re-includes them
        // rather than wiping the pass that was just paid for.
        judgeFindingsRef.current = findings;
        setAssessedBody(editor.getHTML());
        editor.view.dispatch(
          editor.state.tr.setMeta(optimizerHighlightKey, { type: "set", findings })
        );
        repaintLive();
        const st = optimizerHighlightKey.getState(editor.state);
        setIssues(st ? st.issues : []);
      }
      setPanelTab("issues");
      if (data.memoHit) toast.success("Nothing changed since the last assessment");
    } catch (e: any) {
      toast.error(e?.message || "Assessment failed");
    } finally {
      setAssessing(false);
    }
  }, [sessionId, workspaceId, assessing]);

  /** Pull the plugin's current issue list into React after any dispatch. */
  /**
   * The reverse path: a click on a highlight IN THE TEXT.
   *
   * The plugin's handleClick dispatches a select meta into its own state, but a
   * meta-only transaction never fires the editor's onChange — so React's copy
   * of the selection went stale and clicking a mark changed a tint and nothing
   * else. The transaction listener is the only place both directions of
   * selection actually meet.
   */
  const wireSelectionSync = useCallback((editor: Editor) => {
    editor.on("transaction", ({ transaction }) => {
      if (!transaction.getMeta(optimizerHighlightKey)) return;
      const st = optimizerHighlightKey.getState(editor.state);
      if (!st) return;
      setIssues(st.issues.slice());
      setSelectedId(st.selectedId);
    });
  }, []);

  const syncIssues = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const st = optimizerHighlightKey.getState(editor.state);
    setIssues(st ? st.issues.slice() : []);
    setSelectedId(st ? st.selectedId : null);
  }, []);

  /**
   * On-demand AI rewrites, keyed by finding id.
   *
   * Held OUTSIDE the plugin: its findings are immutable once anchored, and a
   * repaint (which fires on every keystroke) rebuilds them from scratch — an
   * edit stored inside would be wiped by the next letter typed. The map
   * survives because React owns it; a finding whose text drifts still fails
   * applyFinding's own drift check, so a stale entry cannot misfire.
   */
  const [aiEdits, setAiEdits] = useState<{ [id: string]: string }>({});
  const [aiFixing, setAiFixing] = useState<string | null>(null);

  const handleAiFix = useCallback(async (id: string) => {
    const editor = editorRef.current;
    if (!editor || !sessionId || !workspaceId || aiFixing) return;
    const st = optimizerHighlightKey.getState(editor.state);
    const issue = st ? st.issues.filter((i) => i.finding.id === id)[0] : null;
    if (!issue) return;
    setAiFixing(id);
    try {
      const res = await fetch(`/api/optimizer/sessions/${encodeURIComponent(sessionId)}/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          criterion: issue.finding.criterion,
          quote: issue.finding.quote,
          prefix: issue.finding.prefix,
          suffix: issue.finding.suffix,
          explanation: issue.finding.explanation,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Could not generate a rewrite");
        return;
      }
      setAiEdits((prev) => ({ ...prev, [id]: data.suggestedEdit }));
    } catch {
      toast.error("Could not generate a rewrite");
    } finally {
      setAiFixing(null);
    }
  }, [sessionId, workspaceId, aiFixing]);

  const handleApply = useCallback((id: string) => {
    /* the AI-edit override, when one was generated for this finding */
    const editor = editorRef.current;
    if (!editor) return;
    const result = applyFinding(editor as any, id, aiEdits[id]);
    if (!result.ok) {
      toast.error(
        result.reason === "drifted"
          ? "That passage has changed since it was assessed — nothing was replaced"
          : result.reason === "deleted"
          ? "That passage is gone"
          : "Could not apply that suggestion"
      );
    }
    syncIssues();
    // Persist immediately: the edit came from a button, not from typing, so
    // there is no debounce coming to save it.
    if (editor) saveBody(editor.getHTML());
  }, [syncIssues, aiEdits]);

  const handleDismiss = useCallback((id: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(optimizerHighlightKey, { type: "dismiss", ids: [id] })
    );
    syncIssues();
  }, [syncIssues]);


  /**
   * Scroll a passage into view from TEXT offsets, which is what the coverage
   * panel has — it carries quotes verified against ParsedDraft.text, not
   * issue ids, so handleSelect cannot serve it.
   */
  const revealTextRange = useCallback((start: number, end: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      const index = buildDocIndex(editor.state.doc);
      const range = textRangeToPos(index, start, end);
      if (!range) return;
      editor.chain().focus().setTextSelection({ from: range.from, to: range.to }).run();
      const dom = editor.view.domAtPos(range.from);
      const node = (dom.node as any).nodeType === 1 ? (dom.node as Element) : (dom.node as any).parentElement;
      if (node && node.scrollIntoView) node.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      /* a passage that cannot be located is not worth an error to the writer */
    }
  }, []);

  const handleSelect = useCallback((id: string | null) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(optimizerHighlightKey, { type: "select", id })
    );
    setSelectedId(id);
    // Clicking a highlight in the draft must reveal its card. With the Score
    // tab open it previously changed a tint in the text and produced nothing in
    // the panel — the forward path worked and the reverse path was silently
    // dead, on the interaction the whole feature exists for.
    if (id) setPanelTab("issues");
    if (id) {
      const st = optimizerHighlightKey.getState(editor.state);
      const issue = st ? st.issues.filter((i) => i.finding.id === id)[0] : null;
      if (issue && issue.status === "active") {
        // focus() as well as select: the Edit affordance promises "jump to it
        // and edit by hand", and without focus the caret never lands in the
        // editor, so pressing it produced no observable change at all.
        editor.commands.focus();
        editor.commands.setTextSelection({ from: issue.from, to: issue.to });
        editor.commands.scrollIntoView();
      }
    }
  }, []);

  /**
   * Getting the piece out.
   *
   * Rich text is the default because that is where this content goes — a
   * Google Doc, a Word file, a CMS editor — and it needs no conversion at all;
   * the editor already holds the HTML. The text/plain half of the same
   * clipboard write is what a plain field receives, and it is generated
   * block-aware rather than with textContent, which would run the heading into
   * the first paragraph.
   */
  const [copied, setCopied] = useState<string | null>(null);

  const copyOut = useCallback(async (as: "rich" | "markdown") => {
    const html = editorRef.current ? editorRef.current.getHTML() : body;
    if (!html || !html.replace(/<[^>]+>/g, "").trim()) {
      toast.error("There is nothing to copy yet");
      return;
    }
    try {
      if (as === "markdown") {
        await navigator.clipboard.writeText(htmlToMarkdown(html));
      } else {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([htmlToPlainText(html)], { type: "text/plain" }),
          }),
        ]);
      }
      setCopied(as);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Safari and any non-secure context refuse clipboard.write outright.
      // Falling back to plain text is worse output, so SAY that rather than
      // letting the writer paste unformatted text believing it worked.
      try {
        await navigator.clipboard.writeText(as === "markdown" ? htmlToMarkdown(html) : htmlToPlainText(html));
        toast.success(as === "markdown" ? "Copied as Markdown" : "Copied as plain text — this browser would not take formatting");
        setCopied(as);
        setTimeout(() => setCopied(null), 2000);
      } catch {
        toast.error("This browser would not let the page write to the clipboard");
      }
    }
  }, [body]);

  /**
   * The free annotation layer.
   *
   * Deterministic findings anchored to the text, recomputed from the current
   * draft and painted with no model call. This is what makes the editor feel
   * like an editor rather than a form with a score beside it: the marks are
   * there the moment content arrives, and they move as you type.
   *
   * Judge findings are held separately in `issues` and merged at dispatch, so a
   * recompute here cannot wipe work that was paid for.
   */
  const judgeFindingsRef = useRef<HighlightFinding[]>([]);

  const repaintLive = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || streaming) return;
    try {
      const html = editor.getHTML();
      const parsed = parseDraft({ body: html, title });
      const scores = computeDraftScores({
        body: html, title, targetQueries: queries, format,
        brandName: canon?.brandName, brandAliases: canon?.brandAliases,
      });
      // parsed.text is passed explicitly because the spans index into it. A
      // differently-derived string produces quotes that never match, and the
      // failure looks like broken anchoring rather than a wrong argument.
      const live = buildLiveFindings(scores, parsed.text);
      editor.view.dispatch(
        editor.state.tr.setMeta(optimizerHighlightKey, {
          type: "set",
          findings: [...judgeFindingsRef.current, ...live],
        })
      );
      const st = optimizerHighlightKey.getState(editor.state);
      setIssues(st ? st.issues.slice() : []);
    } catch {
      // A parse failure must not take the editor down with it. The score panel
      // shows the same failure through its own try/catch.
    }
  }, [streaming, title, queries, format, canon]);

  const selectNext = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const st = optimizerHighlightKey.getState(editor.state);
    if (!st) return;
    const active = st.issues.filter((i) => i.status === "active").sort((a, b) => a.from - b.from);
    if (!active.length) return;
    const at = active.findIndex((i) => i.finding.id === selectedId);
    const next = active[(at + 1) % active.length];
    handleSelect(next.finding.id);
  }, [selectedId]);

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

  const shell = (inner: React.ReactNode) => (
    <>
      <EngineAISidebar
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        searchQuery={navSearch}
        onSearchChange={setNavSearch}
        tab={navTab}
        onTabChange={setNavTab}
        selectedArticleId={sessionId}
        conversationsLoading={convLoading}
        conversationCount={visibleConversations.length}
        footer={
          <div className="shrink-0 border-t border-white/[0.08] p-3">
            <button
              onClick={() => router.push("/engineai")}
              className="w-full flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-white/10 transition-colors text-left text-[13px] text-white/70 hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
              Back to chat
            </button>
          </div>
        }
      >
        {visibleConversations.slice(0, 12).map((c) => (
          <button
            key={c.id}
            onClick={() => router.push(`/engineai?c=${encodeURIComponent(c.id)}`)}
            className="w-full text-left rounded-lg px-2.5 py-2 transition-colors text-white/70 hover:bg-white/10 hover:text-white"
          >
            <p className="text-[14px] font-medium truncate">{c.title}</p>
          </button>
        ))}
      </EngineAISidebar>
      {inner}
    </>
  );

  if (access === "denied") {
    return shell(
      <div className="flex-1 min-h-0 flex items-center justify-center p-8">
        <div className="max-w-md flex flex-col gap-3 text-center">
          <h1 className="text-lg font-semibold">You don&apos;t have EngineAI access in this workspace</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The Content Optimiser is part of EngineAI, and it uses the same access as the rest of it —
            there is no separate switch to turn on. If you can use EngineAI chat but not this, the
            workspace selector at the top left is probably on a workspace you are not a member of.
          </p>
          <p className="text-xs text-muted-foreground">
            Otherwise ask a workspace admin to grant you EngineAI access.
          </p>
        </div>
      </div>
    );
  }

  // ── Start ──
  if (phase === "start") {
    return shell(
      <StartScreen
        workspaceId={workspaceId}
        clientId={selectedCustomer ? Number(selectedCustomer.id) : null}
        clientName={selectedCustomer ? selectedCustomer.name : null}
        onImported={openSession}
        onWriteNew={() => setPhase("brief")}
      />
    );
  }

  // ── Brief ──
  if (phase === "brief") {
    return shell(
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-[46rem] px-6 py-10 flex flex-col gap-6">
          <button
            onClick={() => setPhase("start")}
            className="self-start text-[13px] text-muted-foreground hover:text-foreground"
          >
            ← Back
          </button>
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
  return shell(
    <>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* The header the design called "the chrome that was missing". The menu
            button is not decoration: below lg the sidebar is off-canvas, so
            without it there is no way back to the nav on a narrow screen. */}
        <div className="shrink-0 h-12 border-b flex items-center gap-2.5 px-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden -ml-1 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </button>
          <button onClick={closeSession} className="text-[13px] text-muted-foreground hover:text-foreground shrink-0">
            ← All content
          </button>
          <span className="w-px h-4 bg-border shrink-0" />
          <span className="text-[13px] font-semibold truncate flex-1 min-w-0">{title}</span>
          {sourceInfo.source === "url" && sourceInfo.ref && (
            <div className="flex items-center rounded-lg border p-0.5 shrink-0">
              <button
                onClick={() => setStudioView("optimise")}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors",
                  studioView === "optimise" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Optimise
              </button>
              <button
                onClick={() => setStudioView("audit")}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors",
                  studioView === "audit" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Page audit
              </button>
            </div>
          )}
          {/* Assessment state, in the header rather than buried in a panel.
              Four states, because three of them were previously indistinguishable
              from each other: never assessed, assessed and current, assessed but
              the text has moved on, and running. The third is the one that
              matters — marks anchored to text that has since been edited are
              stale, and a confident tick over them is the same dishonesty as a
              score printed over a skipped pillar. */}
          {chrome.showAssessmentChip && (() => {
            const currentBody = editorRef.current ? editorRef.current.getHTML() : body;
            const state = assessing
              ? "running"
              : assessedBody === null
                ? "never"
                : assessedBody === currentBody
                  ? "current"
                  : "stale";
            const look = {
              running: { cls: "border-primary/30 bg-primary/10 text-primary", dot: "bg-primary animate-pulse", label: "Reviewing…" },
              never:   { cls: "border-border bg-muted/60 text-muted-foreground", dot: "bg-muted-foreground/50", label: "Not reviewed" },
              current: { cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500", label: "Reviewed" },
              stale:   { cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-500", dot: "bg-amber-500", label: "Edited since review" },
            }[state];
            return (
              <span
                className={cn(
                  "hidden sm:inline-flex items-center gap-1.5 shrink-0 rounded-full border px-2.5 py-1 text-[11.5px] font-medium",
                  look.cls
                )}
                title={
                  state === "stale"
                    ? "The AI review ran on an earlier version. Its marks may no longer sit on the right words — re-run it when you are ready."
                    : state === "never"
                      ? "The instant checks are always on. The AI review reads for meaning and runs when you ask."
                      : undefined
                }
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", look.dot)} />
                {look.label}
              </span>
            );
          })()}
          {/* The kind of document. Rendered only when the product NAMES this
              type — labelOf returns null for the one it does not, and this
              reads the label rather than the id so the decision holds without
              anyone remembering it. */}
          {chrome.showTypeChip && typeLabel && (
            <span className="hidden sm:inline-flex items-center gap-1.5 shrink-0 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11.5px] font-medium text-primary">
              {typeLabel}
            </span>
          )}
          {selectedCustomer && (
            <span className="hidden lg:inline-flex items-center gap-1.5 shrink-0 rounded-full border bg-muted/60 px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {selectedCustomer.name}
            </span>
          )}
          {streaming && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> writing
            </span>
          )}
          {!streaming && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="gap-1.5">
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[248px]">
                <DropdownMenuItem onClick={() => copyOut("rich")} className="flex-col items-start gap-0.5 py-2">
                  <span className="text-[13px] font-medium">Copy with formatting</span>
                  <span className="text-[11.5px] text-muted-foreground">
                    For Google Docs, Word, most CMSs
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => copyOut("markdown")} className="flex-col items-start gap-0.5 py-2">
                  <span className="text-[13px] font-medium">Copy as Markdown</span>
                  <span className="text-[11.5px] text-muted-foreground">
                    For publishing pipelines that take it
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {/* No Assess where there is no judge. Hiding it is not cosmetic: the
              route refuses this type with 400 before any spend, so an offered
              button would be a button that always fails. */}
          {!streaming && sessionId && chrome.showAssessAction && (
            <Button size="sm" variant="outline" onClick={runAssess} disabled={assessing}>
              {assessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {assessing ? "Assessing" : "Assess"}
            </Button>
          )}
        </div>
        {studioView === "audit" && sourceInfo.source === "url" && sourceInfo.ref && sessionId && workspaceId && (
          <PageAudit sessionId={sessionId} workspaceId={workspaceId} sourceUrl={sourceInfo.ref} />
        )}
        <div
          ref={editorScrollRef}
          className={cn(
            "relative flex-1 min-h-0 overflow-y-auto",
            // Hidden, not unmounted: Tiptap's undo stack and the highlight
            // plugin's state live in the editor instance, and remounting on
            // every tab switch would discard both.
            studioView === "audit" && "hidden"
          )}
        >
          <IssuePopover
            editor={editorRef.current}
            issue={(() => {
              if (!selectedId) return null;
              const found = issues.filter((i) => i.finding.id === selectedId);
              return found.length ? found[0] : null;
            })()}
            containerRef={editorScrollRef}
            onDismiss={handleDismiss}
            onApply={handleApply}
            onNext={selectNext}
            onClose={() => handleSelect(null)}
            onAiFix={handleAiFix}
            aiEdit={selectedId ? aiEdits[selectedId] : undefined}
            aiFixing={selectedId !== null && aiFixing === selectedId}
            onManualEdit={(id) => {
              // Manual edit: put the caret ON the span and get out of the way.
              const editor = editorRef.current;
              if (!editor) return;
              const st = optimizerHighlightKey.getState(editor.state);
              const issue = st ? st.issues.filter((i) => i.finding.id === id)[0] : null;
              if (issue && issue.status === "active") {
                editor.commands.focus();
                editor.commands.setTextSelection({ from: issue.from, to: issue.to });
                editor.commands.scrollIntoView();
              }
              handleSelect(null);
            }}
            activeCount={issues.filter((i) => i.status === "active").length}
          />
          <div className="mx-auto w-full max-w-[46rem] px-6 py-6">
            <TiptapEditor
              content={streaming ? "" : body}
              onChange={(html) => { saveBody(html); syncIssues(); repaintLive(); }}
              onReady={(e) => { editorRef.current = e; wireSelectionSync(e); setTimeout(repaintLive, 0); }}
              editable={!streaming}
              debounceMs={600}
              extraExtensions={OPTIMIZER_EXTENSIONS}
              placeholder="Paste or write your content here…"
            />
          </div>
        </div>
      </div>
      {/* Narrower at lg than it used to be. With the sidebar now present, a
          308px nav plus a 380px panel left the editor about 336px at 1024px —
          too tight to write in. The score is the point of this surface, so it
          stays visible rather than being pushed to xl; it just gives back
          60px until there is room. */}
      <div className={cn(
        "hidden shrink-0 w-[320px] xl:w-[380px] border-l bg-background flex-col min-h-0",
        // The audit view carries its own "live text through the rubric" card;
        // keeping the DRAFT's score panel beside it put two different numbers
        // for "this piece" on screen with nothing saying which was which.
        studioView === "audit" ? "lg:hidden" : "lg:flex"
      )}>
        <div className="shrink-0 flex items-center gap-1 px-3 pt-2 border-b">
          {/* A graded score over a document nobody is scoring is a number
              pretending to mean something — the dishonesty this page's own
              doctrine warns about. Where there is no judge there is no tab, and
              the deterministic marks still appear under Suggestions, which is
              the honest home for them. */}
          {chrome.showScore && (
            <button
              onClick={() => setPanelTab("score")}
              className={cn("text-[12.5px] font-medium px-2.5 py-2 border-b-2 -mb-px",
                panelTab === "score" ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}
            >
              Score
            </button>
          )}
          <button
            onClick={() => setPanelTab("issues")}
            className={cn("text-[12.5px] font-medium px-2.5 py-2 border-b-2 -mb-px",
              panelTab === "issues" ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}
          >
            Suggestions
            {issues.filter((i) => i.status === "active").length > 0 && (
              <span className="ml-1.5 text-[11px] text-muted-foreground">
                {issues.filter((i) => i.status === "active").length}
              </span>
            )}
          </button>
          {chrome.showCoverageTab && (
            <button
              onClick={() => setPanelTab("coverage")}
              className={cn("text-[12.5px] font-medium px-2.5 py-2 border-b-2 -mb-px",
                panelTab === "coverage" ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}
            >
              Coverage
            </button>
          )}
        </div>
        <div className="flex-1 min-h-0">
          {/* `&& chrome.showCoverageTab`, not just the tab state. Hiding a tab
              does not change which one is SELECTED, so a session whose type
              switches while Coverage is open would keep rendering a panel for
              an analysis the route now refuses. */}
          {panelTab === "coverage" && chrome.showCoverageTab ? (
            <CoveragePanel
              sessionId={sessionId || ""}
              workspaceId={workspaceId}
              onReveal={revealTextRange}
            />
          ) : panelTab === "score" && chrome.showScore ? (
            <ScorePanel
              input={scoreInput}
              muted={streaming}
              onAddQuery={addTargetQuery}
            />
          ) : (
            <IssueList
              issues={issues}
              selectedId={selectedId}
              onSelect={handleSelect}
              onApply={handleApply}
              onDismiss={handleDismiss}
              diagnostics={diagnostics}
              hasAssessed={diagnostics !== null}
              scored={chrome.showScore}
              onAssess={chrome.showAssessAction ? runAssess : undefined}
              onAiFix={handleAiFix}
              aiEdits={aiEdits}
              aiFixingId={aiFixing}
            />
          )}
        </div>
      </div>
    </>
  );
}

/**
 * useSearchParams suspends, and Next refuses to build a page that reads it
 * outside a Suspense boundary. The fallback is the studio's own chrome rather
 * than a spinner: the boundary resolves in the same tick client-side, so a
 * spinner would only ever flash.
 */
export default function OptimizerPage() {
  return (
    <Suspense fallback={<div className="flex-1 min-h-0" />}>
      <OptimizerStudio />
    </Suspense>
  );
}
