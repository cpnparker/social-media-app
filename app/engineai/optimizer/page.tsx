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
import { ArrowLeft, ArrowRight, Check, Copy, Loader2, Menu, MessageSquare, PenLine, Sparkles, X } from "lucide-react";
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
// detectContentType / shouldAnnounce were imported here and NEVER CALLED. Dead
// detection imports sitting beside a silence-critical registry read tell the
// next reader that typing happens in the studio; it does not. Removed rather
// than wired up: continuous first-person prose scores at most 0.1 against the
// quiet branch, so calling it here would silently reclassify documents to fix a
// case it cannot see.
import { chromeFor, labelOf, offeredTypes, DEFAULT_CONTENT_TYPE } from "@/lib/optimizer/content-types";
import { markPolicyFor, lensDisclosure, normaliseLens, MIN_MARKABLE_WORDS, mergeFindingSets, type Lens } from "@/lib/optimizer/mark-policy";
import PageAudit from "@/components/optimizer/PageAudit";
import StartScreen from "@/components/optimizer/StartScreen";
import DiscussPanel from "@/components/optimizer/DiscussPanel";
import VersionHistory from "@/components/optimizer/VersionHistory";
import SelectionActions from "@/components/optimizer/SelectionActions";
import SourcesPanel from "@/components/optimizer/SourcesPanel";
import { draftBlockToHtml, draftBlockToInlineHtml } from "@/lib/optimizer/discuss";
import { railTabsFor, defaultRailTab, type RailTabKey } from "@/lib/optimizer/rail-tabs";
import EngineAISidebar from "@/components/engineai/EngineAISidebar";
import {
  OptimizerHighlight, optimizerHighlightKey, applyFinding,
} from "@/lib/optimizer/highlight-plugin";
import { buildDocIndex, textRangeToPos } from "@/lib/optimizer/doc-index";
import { findAnchor, MAX_QUOTE_LENGTH } from "@/lib/optimizer/anchors";
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

/**
 * Which JOB this mounting is doing.
 *
 * The two surfaces are different tools that happen to share a document, an
 * editor and one anchoring path. The Writer PRODUCES text — a brief, a blank
 * page, a commission, and generation. The Optimiser ASSESSES text that already
 * exists — import, judge, findings, coverage. "content" is neither: it is the
 * full list both of them link to.
 *
 * They were one surface until 2026-08-26, which put a scoring panel over a
 * blank page and offered "write something" beside "bring something in to be
 * scored" as though they were the same intent.
 */
export type Surface = "writer" | "optimiser" | "content";

function OptimizerStudio({ surface }: { surface: Surface }) {
  const { selectedWorkspace } = useWorkspace();
  const { selectedCustomer } = useCustomer();
  const workspaceId = selectedWorkspace?.id || null;
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSession = searchParams.get("session");

  const [phase, setPhase] = useState<"start" | "brief" | "studio" | "all">("start");
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
  /** Bumped after creating a piece so the rail lists it without a reload. */
  const [piecesRefreshKey, setPiecesRefreshKey] = useState(0);
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
  /**
   * A person's decision about this piece, or null if nobody has made one.
   * Rides in config_brief — no new column, no hand-run migration.
   */
  const [lensOverride, setLensOverride] = useState<Lens | null>(null);

  /**
   * Which marks this piece gets.
   *
   * Read through markPolicyFor rather than decided here, for the reason
   * rail-tabs.ts is a module: a condition living in this file can only be
   * checked by grepping its text, and a guard that passed while blind has
   * already shipped from this repo. The check RUNS this across every surface,
   * type and override.
   */
  const policy = useMemo(
    () =>
      markPolicyFor({
        surface,
        contentTypeId,
        override: lensOverride,
        // A DECLARATION, not an inference: naming the questions this piece
        // should answer is the writer saying it is meant to be retrieved, so
        // the retrieval marks run while they draft it.
        hasTargetQueries: queries.length > 0,
      }),
    [surface, contentTypeId, lensOverride, queries.length]
  );

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
  /**
   * The rail's tabs, which are NOT the same on both surfaces.
   *
   * This is the separation made visible. The Writer's rail is Discuss,
   * Background and Suggestions: the tools for producing text. The Optimiser's
   * is Score, Suggestions and Coverage: the tools for judging it. There is
   * deliberately no Score in the Writer — a scoring panel over a draft being
   * written is what merged the two products in the first place, and a writer
   * who wants a verdict sends the piece to the Optimiser, which is the whole
   * shape of the pair.
   *
   * The default differs for the same reason: the Writer opens on the
   * conversation, the Optimiser on the number.
   */
  const [panelTab, setPanelTab] = useState<RailTabKey>(surface === "writer" ? "discuss" : "score");
  /**
   * The selected passage, mirrored into React.
   *
   * Kept here rather than read on demand because two things depend on it
   * reactively: the Discuss panel shows the writer WHAT they are asking about
   * before they send, and the Apply button's label has to say whether it will
   * replace that passage or append. A label reading "Replace selection" that
   * appends instead is a small lie caught only after it has moved their text.
   */
  const [selText, setSelText] = useState("");
  /** What the page audit found, lifted so the ship checklist can read it. */
  const [auditChecks, setAuditChecks] = useState<{ id: string; status: string; detail: string }[] | null>(null);
  /** Which reply a margin marker asked us to scroll to, bumped so repeat
   *  clicks on the same marker still scroll. */
  const [focusTurn, setFocusTurn] = useState<{ turn: number; nonce: number } | null>(null);
  /** A request sent from the editor's selection toolbar. */
  const [pendingAsk, setPendingAsk] = useState<{ text: string; nonce: number } | null>(null);
  /**
   * The editor as STATE as well as a ref.
   *
   * The ref is what every imperative path uses, but the selection toolbar is a
   * rendered component that must appear the moment the editor exists — and a
   * ref does not re-render when it is set, so a toolbar reading editorRef would
   * mount with null and never come back.
   */
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  /**
   * Whether anything is selected AT ALL — which is not the same question as
   * whether any TEXT is selected, and the difference was a lie on a button.
   *
   * A selection over an image or a horizontal rule has from !== to while
   * textBetween returns "", so selText was empty, the button read "Add to the
   * end", and applyDraftText — which tests from !== to — replaced the selection
   * instead. The label promised one thing and the code did the other, which is
   * precisely the failure the label was written to prevent. Both now read this.
   */
  const [hasSel, setHasSel] = useState(false);
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
  /**
   * The route a document opens at is the surface you are ON.
   *
   * This hardcoded the Optimiser, because everything did. After the split it
   * meant creating a Report in the Writer dropped you into the Optimiser with
   * the wrong rail entry lit — the tool you were using swapped underneath you
   * at the moment of creation. The content list is not a place a document can
   * open, so it sends you to the Writer, which is where a document you clicked
   * from a list is most likely to be worked on.
   */
  const surfaceRoute = surface === "optimiser" ? "/engineai/optimizer" : "/engineai/writer";

  const openSession = useCallback((id: string) => {
    router.replace(`${surfaceRoute}?session=${encodeURIComponent(id)}`, { scroll: false });
  }, [router, surfaceRoute]);

  const closeSession = useCallback(() => {
    router.replace(surfaceRoute, { scroll: false });
    setSessionId(null);
    setContentTypeId(DEFAULT_CONTENT_TYPE);
    setPhase("start");
    setBody("");
    setTitle("");
    setQueries([]);
    setLensOverride(null);
    setIssues([]);
    setDiagnostics(null);
    setPanelTab(defaultRailTab(surface, { showScore: chrome.showScore, showCoverageTab: chrome.showCoverageTab }));
    // A generated piece must not inherit the previous article's audit view or
    // source: stale sourceInfo kept the Page audit tab alive for a session
    // with no page, and the streaming draft wrote into a hidden editor.
    setStudioView("optimise");
    setSourceInfo({ source: "generated", ref: null });
  }, [router, surfaceRoute]);

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
          toast.error(res.status === 404 ? "That no longer exists" : "Could not open that");
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
        // Narrowed through the same function the route uses, so a hand-edited
        // jsonb value cannot put an unknown lens into the policy.
        setLensOverride(normaliseLens(brief.lens));
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
        toast.error("Could not open that");
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

  /**
   * Start an empty piece and open the editor.
   *
   * THE DOOR THAT DID NOT EXIST. Every route into the editor either spent a
   * model call (generate) or required text that already existed (import, and a
   * paste button disabled while empty) — while the editor's own placeholder
   * read "Paste or write your content here", advertising a state nothing could
   * reach. A writing studio you cannot start writing in is not one.
   *
   * No model call, no brief. A row, a cursor, and the free instant checks.
   */
  const startBlank = useCallback(async (type: string) => {
    if (!workspaceId) { toast.error("Select a workspace first"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/optimizer/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          title: "Untitled",
          targetQueries: [],
          format: "explainer",
          platform: "balanced",
          contentType: type,
          audience: "",
          goal: "",
          clientId: selectedCustomer ? Number(selectedCustomer.id) : null,
        }),
      });
      const created = await res.json();
      if (!res.ok) { toast.error(created.error || "Could not start that"); return; }
      setContentTypeId(type);
      setTitle("");
      setBody("");
      setIssues([]);
      setDiagnostics(null);
      setStudioView("optimise");
      setSourceInfo({ source: "generated", ref: null });
      if (created.canon?.clientName) setCanon(created.canon);
      setSessionId(created.sessionId);
      // Hydration would otherwise fetch this straight back and overwrite the
      // empty editor with the server's idea of it — same reason generate() marks
      // it before changing the URL.
      hydratedRef.current = created.sessionId;
      setPiecesRefreshKey((k) => k + 1);
      setPhase("studio");
      openSession(created.sessionId);
    } catch {
      toast.error("Could not start that");
    } finally {
      setBusy(false);
    }
  }, [workspaceId, selectedCustomer, openSession]);

  /**
   * `?new=` — the sidebar's New menu, and the only way to reach a blank page.
   *
   * Guarded by a ref rather than by state: the effect re-runs whenever
   * searchParams changes identity, and creating a piece changes the URL, so an
   * unguarded version would create a second piece with the first still opening.
   *
   * The type is validated against offeredTypes(), NOT against every registered
   * id. One type is deliberately not offered, and a URL is user input: without
   * this, `?new=` plus that id would be a way to create it on purpose, which is
   * exactly the door the registry closes everywhere else.
   */
  /** Full list for the "all" phase. Null = still loading. */
  const [allPieces, setAllPieces] = useState<any[] | null>(null);
  const allParam = searchParams.get("all");
  const newParam = searchParams.get("new");
  const setupParam = searchParams.get("setup");
  const claimedNewRef = useRef<string | null>(null);
  useEffect(() => {
    // Only the Writer creates. On the Optimiser this effect must not fire at
    // all: the redirect above is already sending the browser to /writer, and
    // creating here as well would mint a document the writer never sees.
    if (surface !== "writer") return;
    if (!newParam || !workspaceId) return;
    const claimKey = `${newParam}:${setupParam || ""}`;
    if (claimedNewRef.current === claimKey) return;
    claimedNewRef.current = claimKey;

    const wanted = offeredTypes().filter((t) => t.id === newParam)[0];
    if (!wanted) {
      // Unknown or not-offered: land on the start screen rather than erroring.
      // A bad URL should not be a dead end, and it must not name what it failed
      // to match.
      setPhase("start");
      return;
    }
    if (setupParam === "1") {
      // "Draft it with AI" — the brief step, where generate() spends.
      setContentTypeId(wanted.id);
      setPhase("brief");
      return;
    }
    void startBlank(wanted.id);
  }, [surface, newParam, setupParam, workspaceId, startBlank]);

  /**
   * `?all=1` — the full list.
   *
   * The rail shows five pieces and then "N more…", which pointed at the start
   * screen: a link promising the rest of your work and delivering a create
   * form. Beyond the fifth piece there was no route to your own documents
   * except a saved URL, and the list route caps at 50, so piece 51 is
   * unreachable full stop.
   */
  useEffect(() => {
    // The list is what /engineai/content IS, not a mode it can be put into.
    if (surface === "content" && !urlSession) { setPhase("all"); return; }
    if (allParam === "1" && !urlSession) setPhase("all");
  }, [surface, allParam, urlSession]);

  /**
   * The doors moved; the old addresses still work.
   *
   * `?new=` and `?all=1` were the Optimiser's because everything was. They now
   * belong to the Writer and to the content list, and a saved link, a
   * bookmark or a stale tab must land where the thing it asked for actually
   * lives rather than on a screen that no longer offers it.
   *
   * `?session=` is deliberately NOT redirected: a document opens wherever you
   * open it, which is the whole point of the two surfaces sharing one row.
   */
  useEffect(() => {
    if (surface !== "optimiser" || urlSession) return;
    if (newParam) {
      const qs = new URLSearchParams();
      qs.set("new", newParam);
      if (setupParam) qs.set("setup", setupParam);
      window.location.replace(`/engineai/writer?${qs.toString()}`);
      return;
    }
    if (allParam === "1") window.location.replace("/engineai/content");
  }, [surface, urlSession, newParam, setupParam, allParam]);

  useEffect(() => {
    if (phase !== "all" || !workspaceId) return;
    let cancelled = false;
    setAllPieces(null);
    fetch(`/api/optimizer/sessions?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setAllPieces(Array.isArray(d?.sessions) ? d.sessions : []); })
      .catch(() => { if (!cancelled) setAllPieces([]); });
    return () => { cancelled = true; };
  }, [phase, workspaceId, piecesRefreshKey]);

  /**
   * Persist the title.
   *
   * Fire-and-forget on the happy path but NOT silent on failure: a title that
   * looks saved and is not means the writer's own name for their document is
   * gone at the next reload, and they will not find out until then.
   */
  const savedTitleRef = useRef<string>("");
  const saveTitle = useCallback(async () => {
    if (!sessionId || !workspaceId) return;
    const next = title.trim();
    if (next === savedTitleRef.current) return;
    savedTitleRef.current = next;
    try {
      const res = await fetch(`/api/optimizer/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, title: next || "Untitled" }),
      });
      if (!res.ok) {
        savedTitleRef.current = "";
        toast.error("Could not save the title");
        return;
      }
      setPiecesRefreshKey((k) => k + 1);
    } catch {
      savedTitleRef.current = "";
      toast.error("Could not save the title");
    }
  }, [sessionId, workspaceId, title]);

  /**
   * Ask about this draft, in chat.
   *
   * SEEDED, NEVER SENT — the notebook's "ask about this" precedent
   * (app/engineai/page.tsx onAskAbout), and for its reason: the writer decides
   * what to ask. Auto-sending would guess the question and spend a model call
   * on the guess.
   *
   * The excerpt is the SELECTION when there is one, the opening otherwise. A
   * whole draft in the composer is unreadable and, on a long piece, is the
   * entire document in a text box the writer then has to scroll past to type.
   *
   * Handed over through sessionStorage rather than the URL: a draft excerpt in
   * a query string is a 2,000-character URL that lands in history and in any
   * log that records paths. Read once and cleared by the chat page.
   */
  const askInChat = useCallback(async () => {
    if (!workspaceId) { toast.error("Select a workspace first"); return; }
    const ed = editorRef.current;
    let excerpt = "";
    if (ed) {
      const { from, to } = ed.state.selection;
      if (to > from) excerpt = ed.state.doc.textBetween(from, to, "\n").trim();
    }
    let truncated = false;
    if (!excerpt) {
      // SHORTER than a selection, deliberately. A selection is what the writer
      // pointed at, so it earns its length; the opening is a fallback nobody
      // chose, and at 1,200 characters it fills the composer completely and
      // pushes the conversation off screen — the writer then has to scroll
      // past their own draft to type the question it was supposed to set up.
      const plain = (body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      excerpt = plain.slice(0, 500);
      truncated = plain.length > excerpt.length;
    }
    if (!excerpt) { toast.error("There is nothing to ask about yet"); return; }

    setBusy(true);
    try {
      const res = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          title: title.trim() ? `About: ${title.trim()}`.slice(0, 120) : "About a draft",
          customerId: selectedCustomer ? Number(selectedCustomer.id) : undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      // `conversation.id`, camelCase — the create route maps the row before
      // returning it. Guessing at id_conversation (the COLUMN name) failed
      // silently into the error toast, which is what a chain of `||` fallbacks
      // over invented shapes buys you: no error, just the last one being
      // undefined too.
      const convId = j?.conversation?.id;
      if (!res.ok || !convId) {
        toast.error(j?.error || "Could not open a chat about this");
        return;
      }
      sessionStorage.setItem(
        "engineai:ask",
        JSON.stringify({
          conversationId: convId,
          text:
            `About this draft${title.trim() ? ` — ${title.trim()}` : ""}:\n\n` +
            `> ${excerpt.slice(0, 1200)}${truncated ? "…" : ""}\n\n`,
        })
      );
      // A HARD navigation, matching the chat→document crossing rather than
      // differing from it. router.push left the studio mounted and the URL
      // unchanged: these are two heavy surfaces with their own providers, and a
      // soft transition between them is where this kind of push quietly does
      // nothing. It also guarantees the chat page MOUNTS fresh, which is when
      // the sessionStorage handoff is read.
      window.location.href = `/?thread=${encodeURIComponent(convId)}`;
    } catch {
      toast.error("Could not open a chat about this");
    } finally {
      setBusy(false);
    }
  }, [workspaceId, body, title, selectedCustomer, router]);

  // ── Generate ──
  const generate = useCallback(async () => {
    if (!workspaceId) { toast.error("Select a workspace first"); return; }
    if (!title.trim()) { toast.error("Give it a working title"); return; }

    setBusy(true);
    try {
      const createRes = await fetch("/api/optimizer/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId, title, targetQueries: queries, format, platform, contentType: contentTypeId,
          audience, goal, clientId: selectedCustomer ? Number(selectedCustomer.id) : null,
        }),
      });
      const created = await createRes.json();
      if (!createRes.ok) { toast.error(created.error || "Could not start that"); return; }

      setSessionId(created.sessionId);
      setStudioView("optimise");
      setSourceInfo({ source: "generated", ref: null });
      if (created.canon?.clientName) setCanon(created.canon);
      // Mark it hydrated before the URL changes: the piece is already in state
      // and the hydration effect would otherwise fetch it back mid-stream and
      // overwrite the tokens as they arrive.
      hydratedRef.current = created.sessionId;
      setPiecesRefreshKey((k) => k + 1);
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

  /**
   * A person deciding which marks this piece gets.
   *
   * Written to the row before state so a reload agrees with the screen — the
   * override is the whole point, and one that evaporates is worse than none.
   */
  const setLens = useCallback(
    async (next: Lens | null) => {
      if (!sessionId || !workspaceId) return;
      const previous = lensOverride;
      setLensOverride(next);
      try {
        const res = await fetch(`/api/optimizer/sessions/${encodeURIComponent(sessionId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, lens: next }),
        });
        if (!res.ok) throw new Error("patch failed");
      } catch {
        setLensOverride(previous);
        toast.error("Could not save that");
      }
    },
    [sessionId, workspaceId, lensOverride]
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

    // A SEPARATE listener, not another branch of the one above: that one
    // returns early on any transaction without the highlight plugin's meta,
    // which is every ordinary selection change. Folding this into it would mean
    // the selection only updated when a mark happened to be involved.
    // ── Margin markers ──────────────────────────────────────────────────
    //
    // Delegated on the editor root rather than bound per widget: the widget DOM
    // is rebuilt whenever its decoration is redrawn, and a listener attached to
    // the element would go with it. Not preventDefault — letting the caret land
    // in the paragraph is right, since the writer is about to edit it.
    editor.view.dom.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.(".ai-note-marker");
      if (!el) return;
      const turn = Number(el.getAttribute("data-note-turn"));
      if (Number.isNaN(turn)) return;
      setPanelTab("discuss");
      setFocusTurn((prev) => ({ turn, nonce: (prev?.nonce || 0) + 1 }));
    });

    editor.on("selectionUpdate", () => {
      const { from, to } = editor.state.selection;
      // ONE predicate, mirrored to both consumers, so the button's promise and
      // applyDraftText's behaviour cannot disagree.
      setHasSel(from !== to);
      setSelText(from === to ? "" : editor.state.doc.textBetween(from, to, "\n").trim());
    });
  }, []);

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

  /**
   * Resolve a passage the conversation quoted back to a place in the document.
   *
   * Through findAnchor, the SAME resolver the judge's findings use, against
   * DocIndex.text — which is documented byte-identical to ParsedDraft.text, the
   * string the route now sends the model. One derivation of "the text of this
   * document" end to end, so a quote that came back is a quote of the string we
   * are searching.
   *
   * Returns null rather than guessing. findAnchor answers `ambiguous` when a
   * quote appears twice with no distinguishing context, and taking the first
   * match there would send the writer confidently to the wrong paragraph — the
   * failure that is worse than no link, because nothing on screen says it
   * happened.
   */
  const resolveQuote = useCallback((quote: string): { start: number; end: number } | null => {
    const editor = editorRef.current;
    if (!editor || !quote || !quote.trim()) return null;
    try {
      const index = buildDocIndex(editor.state.doc);
      const m = findAnchor(index.text, { quote: quote.slice(0, MAX_QUOTE_LENGTH) });
      return m.ok ? { start: m.start, end: m.end } : null;
    } catch {
      return null;
    }
  }, []);

  const revealQuote = useCallback(
    (quote: string): boolean => {
      const at = resolveQuote(quote);
      if (!at) return false;
      revealTextRange(at.start, at.end);
      return true;
    },
    [resolveQuote, revealTextRange]
  );

  /**
   * The passages the conversation has pointed at, as margin markers.
   *
   * Held HERE and not in the panel because the marks belong to the document:
   * the panel unmounts the moment the writer opens Background or Suggestions,
   * and markers that vanished with it would be a feature you could only see
   * while looking at the thing it duplicates.
   *
   * Dispatched as `notes`, a separate action from `set`. They are deliberately
   * NOT merged into the findings list — anchorFindings resolves overlapping
   * ranges by orphaning the loser, so a conversation anchor over a sentence
   * that already carries a rubric mark would silently delete one of the two,
   * with nothing on screen saying which.
   */
  /**
   * Send a request from the editor to the conversation.
   *
   * Everything the selection toolbar offers goes through here rather than
   * calling a model directly. A rewrite fired off on its own would be a second,
   * silent path to the same work — its own spend, its own prompt, no record —
   * and the writer would have no way to argue with the answer. In the thread it
   * is visible, arguable, and comes back anchored, so Replace already works.
   */
  const askFromEditor = useCallback((text: string) => {
    setPanelTab("discuss");
    setPendingAsk((prev) => ({ text, nonce: (prev?.nonce || 0) + 1 }));
  }, []);

  const setTalkAnchors = useCallback((anchors: { quote: string; turn: number }[]) => {
    const editor = editorRef.current;
    if (!editor) return;
    const notes = anchors.map((a, i) => ({
      id: `talk:${a.turn}:${i}`,
      quote: a.quote,
      turn: a.turn,
    }));
    editor.view.dispatch(editor.state.tr.setMeta(optimizerHighlightKey, { type: "notes", notes }));
  }, []);

  /** Bumped whenever a version is cut, so an open history list refreshes. */
  const [versionsKey, setVersionsKey] = useState(0);

  /**
   * Record a version: what was there, and what replaced it.
   *
   * Fire-and-forget on purpose. The writer's edit has already landed in the
   * editor and the autosave owns the draft itself, so a failed history entry
   * must never block or undo their change — losing a row from the history is a
   * far smaller harm than refusing an edit they asked for.
   *
   * Both bodies are sent because the autosave debounce can fire either side of
   * this call. Only the client knows both states with certainty; the server
   * pins the old one and inserts the new above it, whichever order they arrive.
   */
  const cutVersion = useCallback(
    (previous: string, next: string) => {
      if (!sessionId || !workspaceId || previous === next) return;
      fetch(`/api/optimizer/sessions/${encodeURIComponent(sessionId)}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, previous, next }),
      })
        .then(() => setVersionsKey((k) => k + 1))
        .catch(() => { /* history is a convenience; the draft is already safe */ });
    },
    [sessionId, workspaceId]
  );

  /**
   * Go back to a version.
   *
   * Cuts a version FIRST, so the restore is itself undoable. A history that can
   * only move backwards is a trapdoor: a writer who restores the wrong one has
   * no way back to the work they just lost, which makes the whole feature
   * frightening to use.
   */
  const restoreVersion = useCallback(
    async (version: number) => {
      const editor = editorRef.current;
      if (!editor || !sessionId || !workspaceId) return;
      try {
        const res = await fetch(
          `/api/optimizer/sessions/${encodeURIComponent(sessionId)}/versions?workspaceId=${encodeURIComponent(workspaceId)}&version=${version}`
        );
        const d = await res.json();
        if (!res.ok || !d.version) { toast.error(d.error || "Could not read that version"); return; }
        const beforeHtml = editor.getHTML();
        const restored = String(d.version.document_body || "");
        if (restored === beforeHtml) { toast.info("That version is what you already have"); return; }
        editor.commands.setContent(restored);
        saveBody(restored);
        cutVersion(beforeHtml, restored);
        toast.success(`Restored version ${version}`);
      } catch {
        toast.error("Could not read that version");
      }
    },
    [sessionId, workspaceId, saveBody, cutVersion]
  );

  /**
   * Replace a range, without breaking the paragraph it sits in.
   *
   * draftBlockToHtml wraps its output in <p>, which Tiptap parses as a BLOCK —
   * so inserting it over a sentence inside a paragraph split that paragraph in
   * three and left a blank line either side of the replacement. Reported on a
   * live cover letter.
   *
   * A replacement goes in INLINE when it belongs inline: the range sits inside
   * one text block and the replacement has no paragraph breaks of its own.
   * Anything else — a range spanning blocks, or a multi-paragraph rewrite —
   * keeps the block form, because there the paragraph structure is the point.
   *
   * The replaced range is then selected and flashed, so the writer can see what
   * moved. A silent substitution in the middle of a long document is a change
   * you have to go hunting for.
   */
  const replaceRange = useCallback((editor: Editor, from: number, to: number, text: string) => {
    const multiParagraph = /\n{2,}/.test(text.trim());
    let inline = false;
    try {
      inline = !multiParagraph && editor.state.doc.resolve(from).sameParent(editor.state.doc.resolve(to));
    } catch {
      inline = false;
    }
    const content = inline ? draftBlockToInlineHtml(text) : draftBlockToHtml(text);
    if (!content) return;

    // Measured, not estimated. The inserted span is (what was there) plus (how
    // much the document grew) — html length is not a position count, and
    // guessing from it puts the highlight over the wrong words.
    const sizeBefore = editor.state.doc.content.size;
    editor.chain().focus().insertContentAt({ from, to }, content).run();
    const grew = editor.state.doc.content.size - sizeBefore;
    const end = Math.max(from, Math.min(from + (to - from) + grew, editor.state.doc.content.size));

    editor.view.dispatch(
      editor.state.tr.setMeta(optimizerHighlightKey, { type: "flash", from, to: end })
    );
  }, []);

  /**
   * Put text from the discussion into the document.
   *
   * Replaces the selection when there is one, appends otherwise, and SAYS WHICH
   * — the panel's toast is written from this return value rather than from an
   * assumption made before the click. The editor may be absent (the panel is
   * mounted beside a piece that has not finished loading), and that returns
   * "failed" rather than a cheerful lie about text that went nowhere.
   *
   * Goes through draftBlockToHtml, which escapes before it paragraphs. The
   * model's output is text: an unescaped "<10%" in a rewritten sentence would
   * reach the editor as markup and silently eat the rest of the line.
   */
  const applyDraftText = useCallback((text: string, anchorQuote?: string): "replaced" | "appended" | "failed" => {
    const editor = editorRef.current;
    const html = draftBlockToHtml(text);
    if (!editor || !html) return "failed";

    // Captured BEFORE anything moves. This is the version a writer would want
    // to go back to — the state before a change they did not type themselves.
    const beforeHtml = editor.getHTML();

    // An anchored rewrite replaces the passage it was WRITTEN FOR, in
    // preference to the selection. The writer clicked Show me, read the
    // paragraph and came back to the panel; wherever their cursor ended up is
    // not the instruction, and honouring it would drop a rewrite of paragraph
    // six into paragraph one.
    if (anchorQuote) {
      const at = resolveQuote(anchorQuote);
      if (at) {
        const index = buildDocIndex(editor.state.doc);
        const range = textRangeToPos(index, at.start, at.end);
        if (range) {
          replaceRange(editor, range.from, range.to, text);
          cutVersion(beforeHtml, editor.getHTML());
          return "replaced";
        }
      }
      // Resolvable when the panel drew the button, gone by the time it was
      // pressed. Falling through to append would silently put a replacement
      // paragraph at the end of the document, so refuse and say so.
      return "failed";
    }

    const { from, to } = editor.state.selection;
    if (from !== to) {
      replaceRange(editor, from, to, text);
      cutVersion(beforeHtml, editor.getHTML());
      return "replaced";
    }
    editor.chain().focus().insertContentAt(editor.state.doc.content.size, html).run();
    cutVersion(beforeHtml, editor.getHTML());
    return "appended";
  }, [resolveQuote, cutVersion]);

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
      // One floor for the whole live layer, shared with the score — so the
      // Score tab saying "not enough to score yet" and the document underneath
      // it can no longer tell different stories about one draft.
      const enough = (parsed.text.match(/\S+/g) || []).length >= MIN_MARKABLE_WORDS;
      const live = enough ? buildLiveFindings(scores, parsed.text, policy.lens) : [];
      editor.view.dispatch(
        editor.state.tr.setMeta(optimizerHighlightKey, {
          type: "set",
          findings: mergeFindingSets({ judge: judgeFindingsRef.current, live }),
        })
      );
      const st = optimizerHighlightKey.getState(editor.state);
      setIssues(st ? st.issues.slice() : []);
    } catch {
      // A parse failure must not take the editor down with it. The score panel
      // shows the same failure through its own try/catch.
    }
  }, [streaming, title, queries, format, canon, policy.lens]);

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

  /**
   * The rail's tabs for THIS surface.
   *
   * Derived rather than written out twice, so "which tabs does the Writer have"
   * has one answer. The count on Suggestions is the active findings, which is
   * the only number in the rail that changes as you type.
   */
  /**
   * Words in the draft, for the shared floor.
   *
   * Derived from `body` rather than the editor because it only feeds a
   * threshold: 600ms of lag either side of sixty words changes nothing a writer
   * can perceive, and reading the editor here would re-render the rail on every
   * keystroke.
   */
  const wordCount = useMemo(() => (htmlToPlainText(body).match(/\S+/g) || []).length, [body]);

  const panelTabs = useMemo(
    () =>
      railTabsFor(
        surface,
        { showScore: chrome.showScore, showCoverageTab: chrome.showCoverageTab },
        issues.filter((i) => i.status === "active").length
      ),
    [surface, chrome.showScore, chrome.showCoverageTab, issues]
  );

  /**
   * Correct a selection that this surface does not offer.
   *
   * Hiding a tab does not deselect it. Without this, a piece opened in the
   * Optimiser on Coverage and then opened in the Writer would render the rail
   * with no tab highlighted and the fallback panel below it — the page quietly
   * disagreeing with itself about what is on screen.
   */
  useEffect(() => {
    if (panelTabs.length === 0) return;
    let found = false;
    for (let i = 0; i < panelTabs.length; i++) if (panelTabs[i].key === panelTab) found = true;
    if (!found) setPanelTab(panelTabs[0].key);
  }, [panelTabs, panelTab]);

  /**
   * What is on screen right now, for a question asked about it.
   *
   * Reads the EDITOR rather than `body`, which lags by the autosave debounce.
   * A writer who rewrites a paragraph and immediately asks "is that better?"
   * must be answered about the rewrite, not the version before it.
   */
  const getDraftHtml = useCallback(
    () => (editorRef.current ? editorRef.current.getHTML() : body),
    [body]
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

  const shell = (inner: React.ReactNode) => (
    <>
      <EngineAISidebar
        piecesRefreshKey={piecesRefreshKey}
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

  // ── All content ──
  //
  // The rail lists five and then "N more…". That link used to land on the start
  // screen — a promise of the rest of your work, delivering a create form.
  if (phase === "all") {
    return shell(
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-[52rem] px-6 py-10 flex flex-col gap-5">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold tracking-tight">All content</h1>
              <p className="text-sm text-muted-foreground">
                Yours, plus anything shared with the team.
              </p>
            </div>
            {/* Says "Start writing", so it goes to the WRITER. It pointed at
                the Optimiser because everything did — and on this surface
                setPhase("start") is also a no-op, since the list effect forces
                the phase back to "all". A button that names a job must go to
                the tool that does it. */}
            <Button size="sm" variant="outline" onClick={() => router.push("/engineai/writer")}>
              Start writing
            </Button>
          </div>
          {allPieces === null ? (
            <div className="flex justify-center py-12"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : allPieces.length === 0 ? (
            <p className="text-[13px] text-muted-foreground py-8">
              Nothing here yet.
            </p>
          ) : (
            <div className="flex flex-col rounded-xl border divide-y overflow-hidden">
              {allPieces.map((a) => (
                <button
                  key={a.id_session}
                  onClick={() => openSession(a.id_session)}
                  className="flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                >
                  <PenLine className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-[13.5px] font-medium">
                    {a.name_title || "Untitled"}
                  </span>
                  {/* Rendered from labelOf, which returns null for the type the
                      product does not name — so that row simply shows no kind,
                      exactly as the header chip does. */}
                  {labelOf(a.type_content) && (
                    <span className="shrink-0 text-[11px] text-muted-foreground rounded-full border px-2 py-0.5">
                      {labelOf(a.type_content)}
                    </span>
                  )}
                  {a.type_visibility === "team" && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">Team</span>
                  )}
                  <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums w-20 text-right">
                    {a.date_updated ? new Date(a.date_updated).toLocaleDateString() : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
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
        onStartBlank={startBlank}
        onWriteNew={() => setPhase("brief")}
        surface={surface === "writer" ? "writer" : "optimiser"}
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
            <h1 className="text-2xl font-bold tracking-tight">New</h1>
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
          {/* The assessment verdict belongs to the Optimiser. Rendering it on
              the Writer is the merge in miniature: a grade on a piece you are
              still writing. */}
          {surface !== "writer" && chrome.showAssessmentChip && (() => {
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
          {/* ── Which checks are running, and the control to change it ──────
              In the HEADER, beside the chip that says what this piece is,
              because that is the only place it is visible whatever the rail is
              showing. It lived inside the Suggestions panel, which meant the
              one control that answers "why is my cover letter being graded like
              an article" was on a tab you had to already suspect the answer to
              go and find. Both directions from one control: engine-lens pieces
              can turn the answer-engine checks off, plain-lens pieces can turn
              them on. */}
          {sessionId && policy.canRaise && wordCount >= MIN_MARKABLE_WORDS && (
            <button
              onClick={() => setLens(policy.lens === "engine" ? "plain" : "engine")}
              title={
                policy.lens === "engine"
                  ? "These checks judge whether an AI assistant would cite this page. Turn them off for this piece."
                  : "Only the checks that apply to any writing are running. Turn on the answer-engine checks for this piece."
              }
              className={cn(
                "hidden md:inline-flex items-center gap-1.5 shrink-0 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                policy.lens === "engine"
                  ? "border-primary/25 bg-primary/10 text-primary hover:bg-primary/15"
                  : "border-border bg-muted/60 text-muted-foreground hover:text-foreground"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", policy.lens === "engine" ? "bg-primary" : "bg-muted-foreground/50")} />
              {policy.lens === "engine" ? "AI checks on" : "AI checks off"}
            </button>
          )}
          {sessionId && (
            <VersionHistory
              sessionId={sessionId}
              workspaceId={workspaceId}
              refreshKey={versionsKey}
              onRestore={restoreVersion}
            />
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
          {!streaming && sessionId && (
            <Button size="sm" variant="ghost" onClick={askInChat} disabled={busy}>
              <MessageSquare className="h-3.5 w-3.5" />
              Ask
            </Button>
          )}
          {!streaming && sessionId && surface !== "writer" && chrome.showAssessAction && (
            <Button size="sm" variant="outline" onClick={runAssess} disabled={assessing}>
              {assessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {assessing ? "Assessing" : "Assess"}
            </Button>
          )}
        </div>
        {studioView === "audit" && sourceInfo.source === "url" && sourceInfo.ref && sessionId && workspaceId && (
          <PageAudit sessionId={sessionId} workspaceId={workspaceId} sourceUrl={sourceInfo.ref}
              onResult={(d) => setAuditChecks(d && Array.isArray(d.checks) ? d.checks : null)}
            />
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
            {/* THE TITLE, in the editor rather than only in the brief form.
                A blank piece is created as "Untitled" and the brief's
                title input is on a screen the write-it-yourself path never
                visits — so every blank piece stayed Untitled unless the writer
                found the double-click rename in the sidebar. A document you
                cannot name from inside it is not finished being made.

                Saved on blur, not per keystroke: the title is also a sidebar
                row and a PATCH per character would rewrite that list
                constantly. */}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => { void saveTitle(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
              placeholder="Untitled"
              aria-label="Title"
              className="w-full mb-3 bg-transparent border-0 px-0 text-[26px] font-bold tracking-tight placeholder:text-muted-foreground/40 focus:outline-none"
            />
            {/* Actions at the passage, not only in the rail. Rendered beside the
                editor rather than inside the shared TiptapEditor, which serves
                other surfaces that should not grow a writing toolbar. */}
            <SelectionActions
              editor={editorInstance}
              enabled={!streaming}
              onAsk={askFromEditor}
              onDiscuss={() => setPanelTab("discuss")}
            />
            <TiptapEditor
              content={streaming ? "" : body}
              onChange={(html) => { saveBody(html); syncIssues(); repaintLive(); }}
              onReady={(e) => { editorRef.current = e; setEditorInstance(e); wireSelectionSync(e); setTimeout(repaintLive, 0); }}
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
        {/* The rail's tabs are the separation made visible. The Writer gets the
            tools for PRODUCING text — the conversation, the material it draws
            on, the marks on the prose. The Optimiser gets the tools for JUDGING
            it. There is deliberately no Score here on the Writer: a scoring
            panel over a draft in progress is precisely what merged the two
            products, and it turned writing into chasing a number before there
            was anything to score. */}
        <div className="shrink-0 flex items-center gap-1 px-3 pt-2 border-b">
          {panelTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setPanelTab(t.key)}
              className={cn("text-[12.5px] font-medium px-2.5 py-2 border-b-2 -mb-px",
                panelTab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}
            >
              {t.label}
              {t.count ? <span className="ml-1.5 text-[11px] text-muted-foreground">{t.count}</span> : null}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0">
          {/* Every branch tests the CAPABILITY as well as the tab state. Hiding
              a tab does not change which one is selected, so a session whose
              type or surface changes while a tab is open would keep rendering a
              panel for something no longer offered. */}
          {panelTab === "discuss" && surface === "writer" ? (
            sessionId ? (
              <DiscussPanel
                key={sessionId}
                sessionId={sessionId}
                workspaceId={workspaceId}
                getDraftHtml={getDraftHtml}
                resolveQuote={(q) => resolveQuote(q) !== null}
                onRevealQuote={revealQuote}
                onAnchorsChanged={setTalkAnchors}
                focusTurn={focusTurn}
                pendingAsk={pendingAsk}
                selection={selText}
                hasSelection={hasSel}
                onApply={applyDraftText}
              />
            ) : (
              <p className="p-4 text-[12px] text-muted-foreground leading-relaxed">
                Start or open a piece and you can talk it through here.
              </p>
            )
          ) : panelTab === "sources" && surface === "writer" ? (
            sessionId ? (
              <SourcesPanel
                key={sessionId}
                sessionId={sessionId}
                workspaceId={workspaceId}
                onChanged={() => setPiecesRefreshKey((k) => k + 1)}
              />
            ) : (
              <p className="p-4 text-[12px] text-muted-foreground leading-relaxed">
                Open a piece to attach the brief and anything else it is written from.
              </p>
            )
          ) : panelTab === "coverage" && chrome.showCoverageTab ? (
            <CoveragePanel
              sessionId={sessionId || ""}
              workspaceId={workspaceId}
              onReveal={revealTextRange}
            />
          ) : panelTab === "score" && chrome.showScore && surface !== "writer" ? (
            <ScorePanel
              input={scoreInput}
              muted={streaming}
              onAddQuery={addTargetQuery}
              hasLivePage={sourceInfo?.source === "url"}
              auditChecks={auditChecks}
              sessionId={sessionId || undefined}
              workspaceId={workspaceId}
              onShowCriterion={(key) => {
                // The instances are already anchored in the plugin — the same
                // marks the Suggestions tab lists. Selecting one switches there,
                // where the per-finding AI rewrite already lives.
                const editor = editorRef.current;
                if (!editor) return false;
                const st = optimizerHighlightKey.getState(editor.state);
                const hit = st?.issues.find((i) => i.status === "active" && i.finding.criterion === key);
                if (!hit) return false;
                handleSelect(hit.finding.id);
                setPanelTab("issues");
                return true;
              }}
              onApplyBlock={(text) => applyDraftText(text)}
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
              onAssess={surface !== "writer" && chrome.showAssessAction ? runAssess : undefined}
              onAiFix={handleAiFix}
              aiEdits={aiEdits}
              aiFixingId={aiFixing}
              lens={policy.lens}
              canRaiseLens={policy.canRaise}
              onSetLens={setLens}
              belowFloor={wordCount < MIN_MARKABLE_WORDS}
              onHandOff={
                surface === "writer" && sessionId
                  ? () => { window.location.href = `/engineai/optimizer?session=${encodeURIComponent(sessionId)}`; }
                  : undefined
              }
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
/**
 * Mounted by all three routes. The component is shared because the DOCUMENT is
 * shared — one row, one editor, one set of highlights — and forking it would
 * fork the anchoring path, which lib/optimizer/live-issues.ts warns is the copy
 * that rots.
 */
export function OptimizerSurface({ surface }: { surface: Surface }) {
  return (
    <Suspense fallback={<div className="flex-1 min-h-0" />}>
      <OptimizerStudio surface={surface} />
    </Suspense>
  );
}

export default function OptimizerPage() {
  return <OptimizerSurface surface="optimiser" />;
}
