"use client";

/**
 * The EngineAI sidebar, shared by every surface under /engineai.
 *
 * WHY THIS EXISTS. The sidebar lived entirely inside app/engineai/page.tsx —
 * the chat page — so the Content Optimiser at /engineai/optimizer rendered with
 * no navigation and no chrome at all, against a design whose own annotation
 * read "Header — the chrome that was missing". EngineAIShell provides only
 * providers and an auth guard; it renders no chrome, so a sub-surface got none.
 *
 * WHAT MOVED, AND WHAT DELIBERATELY DID NOT. This component owns the parts that
 * are identical on every surface: the icon rail, the logo, the client selector,
 * the Content Optimiser link, the search box, the Private/Team tabs and the
 * ARTICLES section. The conversation list and the profile block stay with their
 * pages, passed in as slots.
 *
 * That split is the whole risk control. The chat page's conversation list is
 * the most intricate JSX in the repo — client grouping, pinning, inline rename,
 * delete, deep-search results, per-group truncation — and moving it would put
 * the daily-driver surface at risk for no gain, since the optimiser needs none
 * of those affordances. Articles moved because it is genuinely identical on
 * both surfaces and was written days ago: duplicating it now is how two
 * sidebars start drifting apart.
 *
 * Search and tab state are OWNED BY THE PAGE and passed down, not held here.
 * Both filter the conversation list as well as the articles, and a component
 * that held them would have to sync them back up — which is a bug waiting to
 * happen for no benefit.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getSubdomainUrl } from "@/lib/subdomain";
import { SectionRailDesktop, SectionRailMobile, useRailItems } from "@/components/layout/SectionRail";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  Building2, Check, ChevronDown, ChevronsUpDown, Loader2, Lock, Pencil, PenLine, PenSquare, Pin, Plus, Search, Trash2, Users, X,
} from "lucide-react";

/** Kept in step with the shape app/engineai/page.tsx builds. */
export interface OptimizerArticle {
  id: string;
  title: string;
  status: string;
  visibility: string;
  source: string;
  clientId: number | null;
  updatedAt: string;
  /** Decided by the server, never inferred here. Rename and delete are the
   *  owner's, and a team article belongs to somebody else. */
  isOwner: boolean;
}

interface Props {
  sidebarOpen: boolean;
  onCloseSidebar: () => void;
  /** Chat passes its own handler; the optimiser navigates to a fresh chat. */
  onNewChat?: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  tab: "private" | "team";
  onTabChange: (t: "private" | "team") => void;
  /** Highlights the open article. Null on the chat page. */
  selectedArticleId?: string | null;
  /** Whether the page is still fetching its conversations. */
  conversationsLoading?: boolean;
  /**
   * How many conversation rows `children` will render.
   *
   * The sidebar cannot count them — they are opaque JSX — but it needs the
   * number for two things it DOES own: the empty state (which is only empty
   * when there are no articles either) and the "Conversations" heading, which
   * appears while searching only when both lists have results. Passing the
   * count is the smallest possible coupling that keeps those correct.
   */
  conversationCount?: number;
  /** The conversation list. Chat passes its grouped one; the optimiser a plain list. */
  children?: React.ReactNode;
  /** The profile block at the bottom of the panel. */
  footer?: React.ReactNode;
  /** The avatar at the bottom of the icon rail. Chat and the optimiser open
   *  different dialogs from it, so it is a slot rather than shared markup. */
  railFooter?: React.ReactNode;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

export default function EngineAISidebar({
  sidebarOpen, onCloseSidebar, onNewChat,
  searchQuery, onSearchChange, tab, onTabChange,
  selectedArticleId, conversationsLoading, conversationCount = 0, children, footer, railFooter,
}: Props) {
  const router = useRouter();
  const customerCtx = useCustomerSafe();
  const customers = customerCtx?.customers || [];
  const selectedCustomer = customerCtx?.selectedCustomer;
  const canViewAll = customerCtx?.canViewAll ?? false;
  const { visibleCount } = useRailItems();
  const showRail = visibleCount > 1;

  const clientNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (let i = 0; i < customers.length; i++) {
      const id = Number(customers[i].id);
      if (!Number.isNaN(id)) m.set(id, customers[i].name);
    }
    return m;
  }, [customers]);
  // Declared BEFORE the articles filter that reads it. It was below, which is
  // a temporal dead zone crash the moment an article row renders — and one
  // TypeScript does not flag, because both are consts in the same scope.

  /**
   * Articles live in the sidebar, so the sidebar fetches them.
   *
   * Fails silently: the route 403s for anyone without the optimiser flag, which
   * is the normal state for most of the workspace, and an empty section simply
   * does not render. A console error on every page load would be noise.
   */
  const [articles, setArticles] = useState<OptimizerArticle[]>([]);
  const wsCtx = useWorkspaceSafe();
  const workspaceId = wsCtx?.selectedWorkspace?.id || null;

  useEffect(() => {
    if (!workspaceId) { setArticles([]); return; }
    let cancelled = false;
    fetch(`/api/optimizer/sessions?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d || !Array.isArray(d.sessions)) return;
        setArticles(
          d.sessions.map((row: any) => ({
            id: row.id_session,
            title: row.name_title || "Untitled piece",
            status: row.type_status || "",
            // Default to private on a null. A row with no visibility is
            // invisible in BOTH tabs under strict equality, which reads as data
            // loss; private is the safe direction to resolve it in.
            visibility: row.type_visibility || "private",
            source: row.type_source || "generated",
            clientId: row.id_client ?? null,
            updatedAt: row.date_updated,
            isOwner: row.isOwner === true,
          }))
        );
      })
      .catch(() => { /* the optimiser being off is not an error in this view */ });
    return () => { cancelled = true; };
  }, [workspaceId]);

  /**
   * Match FIRST, then filter by visibility — never the reverse. Filtering to
   * the current tab and searching within it would silently hide a team article
   * from someone searching in Private, which reads as the article having been
   * deleted.
   */
  // Declared ABOVE visibleArticles, which sorts by them. Below, this is a
  // temporal dead zone crash on first render — and TypeScript does not flag
  // it, because both are consts in the same function scope. This is the
  // second time this exact trap has been hit in this file.
  // ── Article row actions: rename, pin, delete ──
  //
  // Deliberately the same three the conversation rows have, in the same order,
  // with the same idle/hover swap — an article is a peer of a conversation, and
  // a row that looks the same but behaves differently is worse than one that
  // looks different.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [pinnedArticleIds, setPinnedArticleIds] = useState<Set<string>>(new Set());

  const visibleArticles = articles.filter((a) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const client = a.clientId !== null ? clientNameById.get(a.clientId) : null;
      const matches =
        a.title.toLowerCase().indexOf(q) >= 0 ||
        (client ? client.toLowerCase().indexOf(q) >= 0 : false);
      if (!matches) return false;
    }
    if (tab === "private" && a.visibility !== "private") return false;
    if (tab === "team" && a.visibility !== "team") return false;
    return true;
  }).sort((a, b) => {
    // Pinned first, then most recent — matching the conversation list, so a pin
    // means the same thing in both halves of the sidebar.
    const ap = pinnedArticleIds.has(a.id);
    const bp = pinnedArticleIds.has(b.id);
    if (ap !== bp) return ap ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });


  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d || !Array.isArray(d.pinnedArticleIds)) return;
        setPinnedArticleIds(new Set(d.pinnedArticleIds));
      })
      .catch(() => { /* an unpinned list is a fine fallback */ });
    return () => { cancelled = true; };
  }, []);

  const togglePinArticle = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const next = new Set(pinnedArticleIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPinnedArticleIds(next);
    fetch("/api/me/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinnedArticleIds: Array.from(next) }),
    }).catch(() => {});
  };

  const startRenamingArticle = (e: React.MouseEvent, a: OptimizerArticle) => {
    e.stopPropagation();
    e.preventDefault();
    setEditingId(a.id);
    setEditingTitle(a.title || "");
  };

  const saveArticleRename = async (id: string) => {
    const trimmed = editingTitle.trim();
    const current = articles.find((a) => a.id === id);
    if (!trimmed || !current || trimmed === current.title) { setEditingId(null); return; }
    // Optimistic, then reconciled: the row is the writer's own text, so showing
    // it immediately is right, but a failed save must not leave the sidebar
    // disagreeing with the database.
    setArticles((prev) => prev.map((a) => (a.id === id ? { ...a, title: trimmed } : a)));
    setEditingId(null);
    try {
      const res = await fetch(`/api/optimizer/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, title: trimmed }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "");
    } catch (err: any) {
      setArticles((prev) => prev.map((a) => (a.id === id ? { ...a, title: current.title } : a)));
      toast.error(err?.message || "Could not rename that");
    }
  };

  const deleteArticle = async (e: React.MouseEvent, a: OptimizerArticle) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${a.title}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(
        `/api/optimizer/sessions/${encodeURIComponent(a.id)}?workspaceId=${encodeURIComponent(workspaceId || "")}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "");
      setArticles((prev) => prev.filter((x) => x.id !== a.id));
      // If the deleted piece is the one on screen, leave it — the studio would
      // otherwise sit on a session that no longer exists and 404 on next save.
      if (selectedArticleId === a.id) router.push("/engineai/optimizer");
      toast.success("Article deleted");
    } catch (err: any) {
      toast.error(err?.message || "Could not delete that");
    }
  };

  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);

  const filteredClients = (
    clientSearchQuery
      ? customers.filter((c) => c.name.toLowerCase().includes(clientSearchQuery.toLowerCase()))
      : customers
  ).sort((a, b) => a.name.localeCompare(b.name));


  const handleNewChat = () => {
    if (onNewChat) { onNewChat(); return; }
    // From a sub-surface there is no chat state to reset — go to a fresh one.
    router.push("/engineai");
  };

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onCloseSidebar}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[280px] flex",
          "transform transition-transform duration-300 ease-in-out",
          "lg:static lg:z-auto lg:translate-x-0 lg:shrink-0",
          showRail && "lg:w-[308px]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* ═══════ Icon Rail (desktop only) ═══════ */}
        {showRail && (
          <div className="hidden lg:flex flex-col items-center w-12 bg-[#2e3440] py-3 shrink-0">
            {/* Logo */}
            <a href={getSubdomainUrl("engine", "/dashboard")} className="mb-4">
              <div className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
                <img
                  src="/assets/logo_engine_icon.svg"
                  alt="Home"
                  width={24}
                  height={24}
                  className="h-6 w-6 brightness-0 invert"
                />
              </div>
            </a>

            {/* Area icons */}
            <SectionRailDesktop currentArea="engineai" />

            <div className="flex-1" />

            {railFooter}
          </div>
        )}

        {/* ═══════ Sidebar Panel ═══════ */}
        <div className="flex-1 flex flex-col bg-[#3b4252] text-white border-r border-white/[0.06] overflow-hidden">
          {/* ── Mobile area switcher ── */}
          {showRail && (
            <SectionRailMobile currentArea="engineai" />
          )}

          {/* Top section */}
          <div className="shrink-0 p-3 space-y-3">
            {/* Logo + New Chat */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => {
                  customerCtx?.setSelectedCustomerId(null);
                  handleNewChat();
                }}
                className="flex items-center gap-2 hover:opacity-70 transition-opacity"
              >
                {!showRail && (
                  <img
                    src="/assets/logo_engine_icon.svg"
                    alt="EngineAI"
                    className="h-7 w-7 brightness-0 invert"
                  />
                )}
                <span className="text-[15px] font-semibold text-white">
                  EngineAI
                </span>
              </button>
              <button
                onClick={handleNewChat}
                className="h-8 w-8 rounded-lg bg-white/10 hover:bg-white/15 flex items-center justify-center transition-colors text-white"
                title="New chat"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* Client selector (searchable popover) */}
            {customers.length > 0 && (
              <Popover
                open={clientPopoverOpen}
                onOpenChange={(open) => {
                  setClientPopoverOpen(open);
                  if (!open) setClientSearchQuery("");
                }}
              >
                <PopoverTrigger asChild>
                  <button className="w-full flex items-center gap-2 rounded-lg bg-white/[0.06] hover:bg-white/10 px-2.5 py-2 transition-colors text-left">
                    <Building2 className="h-3.5 w-3.5 text-white/40 shrink-0" />
                    <span className="flex-1 truncate text-white/80 text-[13px] font-medium">
                      {selectedCustomer?.name || "General"}
                    </span>
                    <ChevronsUpDown className="h-3 w-3 text-white/40 shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" side="bottom" className="w-[256px] p-0">
                  <div className="flex items-center border-b px-3">
                    <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <input
                      placeholder="Search clients..."
                      value={clientSearchQuery}
                      onChange={(e) => setClientSearchQuery(e.target.value)}
                      className="flex h-9 w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
                    />
                    {clientSearchQuery && (
                      <button
                        onClick={() => setClientSearchQuery("")}
                        className="ml-1 h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div className="max-h-[240px] overflow-y-auto p-1">
                    {canViewAll && !clientSearchQuery && (
                      <button
                        onClick={() => {
                          customerCtx?.setSelectedCustomerId(null);
                          setClientPopoverOpen(false);
                          setClientSearchQuery("");
                        }}
                        className={cn(
                          "w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left",
                          !selectedCustomer && "bg-accent"
                        )}
                      >
                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="flex-1">General</span>
                        {!selectedCustomer && (
                          <Check className="h-4 w-4 text-primary shrink-0" />
                        )}
                      </button>
                    )}
                    {filteredClients.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        No clients found
                      </p>
                    ) : (
                      filteredClients.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            customerCtx?.setSelectedCustomerId(c.id);
                            setClientPopoverOpen(false);
                            setClientSearchQuery("");
                          }}
                          className={cn(
                            "w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left",
                            selectedCustomer?.id === c.id && "bg-accent"
                          )}
                        >
                          {c.logoUrl ? (
                            <img
                              src={c.logoUrl}
                              alt=""
                              className="h-4 w-4 rounded object-cover shrink-0"
                            />
                          ) : (
                            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="flex-1 truncate">{c.name}</span>
                          {selectedCustomer?.id === c.id && (
                            <Check className="h-4 w-4 text-primary shrink-0" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Tools.
                EngineAI's sub-surfaces (/engineai/design, /engineai/optimizer)
                render inside this same shell but had NO inbound link from
                anywhere in the product — they were reachable only by typing the
                URL, which in practice means nobody found them. A feature nobody
                can navigate to is a feature that does not exist. */}
            <button
              onClick={() => router.push("/engineai/optimizer")}
              className="w-full flex items-center gap-2 rounded-lg bg-white/[0.06] hover:bg-white/10 px-2.5 py-2 transition-colors text-left text-white/80 hover:text-white"
              title="Write content optimised to be cited by AI assistants"
            >
              <PenLine className="h-3.5 w-3.5 text-white/40 shrink-0" />
              <span className="flex-1 truncate text-[13px] font-medium">Content Optimiser</span>
            </button>

            {/* Search chats */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
              <input
                placeholder="Search chats..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full h-8 rounded-lg bg-white/[0.06] border border-white/[0.08] pl-8 pr-3 text-[13px] text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/20"
              />
              {searchQuery && (
                <button
                  onClick={() => onSearchChange("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Private / Team tabs */}
            <div className="flex gap-0.5 bg-white/10 rounded-lg p-0.5">
              <button
                onClick={() => onTabChange("private")}
                className={cn(
                  "flex-1 px-2.5 py-1 rounded-md text-[13px] font-medium transition-all",
                  tab === "private"
                    ? "bg-white/15 text-white shadow-sm"
                    : "text-white/50 hover:text-white/80"
                )}
              >
                <Lock className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
                Private
              </button>
              <button
                onClick={() => onTabChange("team")}
                className={cn(
                  "flex-1 px-2.5 py-1 rounded-md text-[13px] font-medium transition-all",
                  tab === "team"
                    ? "bg-white/15 text-white shadow-sm"
                    : "text-white/50 hover:text-white/80"
                )}
              >
                <Users className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
                Team
              </button>
            </div>
          </div>

          {/* The list. Articles are the sidebar's own; the conversation rows
              come from the page. The loading and empty states live here because
              "empty" is only true when BOTH lists are empty. */}
          <div className="flex-1 overflow-y-auto px-2 py-1 scrollbar-hide">
            {conversationsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-white/40" />
              </div>
            ) : conversationCount === 0 && visibleArticles.length === 0 ? (
              <div className="text-center py-8 px-3">
                <p className="text-[13px] text-white/50">
                  {searchQuery ? "Nothing matches your search" : "Nothing here yet"}
                </p>
              </div>
            ) : (
            <div className="space-y-0.5">
  {/* ─── Articles ───
                      Its own section rather than rows mixed into the chat list.
                      Two kinds of thing in one list is harder to scan than two
                      short lists, and when searching it is the difference
                      between "did it find my article?" and having to read every
                      row to find out. The heading carries the count so an empty
                      result under a heading never reads as a hung fetch. */}
                  {visibleArticles.length > 0 && (
                    <div className="mb-1">
                      <div className="flex items-center justify-between px-2.5 pt-3 pb-1">
                        <p className="text-[11px] font-semibold text-white/55 uppercase tracking-wider">
                          Articles
                        </p>
                        <span className="text-[11px] text-white/35 tabular-nums">
                          {visibleArticles.length}
                        </span>
                      </div>
                      {visibleArticles.slice(0, searchQuery ? 8 : 5).map((a) => (
                        <button
                          key={a.id}
                          onClick={() => editingId !== a.id && router.push(`/engineai/optimizer?session=${encodeURIComponent(a.id)}`)}
                          onDoubleClick={(e) => a.isOwner && startRenamingArticle(e, a)}
                          className={cn(
                            "w-full text-left rounded-lg px-2.5 py-2 transition-colors group/art",
                            selectedArticleId === a.id
                              ? "bg-white/15 text-white"
                              : "text-white/70 hover:bg-white/10 hover:text-white"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            {/* A leading icon, not a trailing badge: it marks the
                                row as a different KIND before the eye reaches the
                                title, and it does not compete with the timestamp
                                for the right edge. */}
                            <PenLine className="h-3.5 w-3.5 text-white/40 shrink-0" />
                            {editingId === a.id ? (
                              <input
                                autoFocus
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                onBlur={() => saveArticleRename(a.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveArticleRename(a.id);
                                  if (e.key === "Escape") setEditingId(null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="text-[14px] font-medium flex-1 bg-white/10 text-white rounded px-1.5 py-0.5 outline-none ring-1 ring-white/30 focus:ring-white/60 min-w-0"
                              />
                            ) : (
                              <p className="text-[14px] font-medium truncate flex-1">{a.title}</p>
                            )}
                            {/* Idle shows the timestamp (and a pin badge if
                                pinned); hover or selected shows the actions.
                                Swapped with hidden/flex rather than opacity, so
                                an idle row gives its full width to the title and
                                there are no invisible-but-clickable buttons —
                                the same treatment the conversation rows get. */}
                            <div className="flex items-center shrink-0">
                              <span
                                className={cn(
                                  "flex items-center gap-1 text-[11px] text-white/55",
                                  selectedArticleId === a.id ? "hidden" : "group-hover/art:hidden"
                                )}
                              >
                                {pinnedArticleIds.has(a.id) && (
                                  <Pin className="h-3 w-3 text-yellow-400 fill-yellow-400" />
                                )}
                                {a.updatedAt ? timeAgo(a.updatedAt) : ""}
                              </span>
                              <div
                                className={cn(
                                  "items-center gap-0.5",
                                  selectedArticleId === a.id ? "flex" : "hidden group-hover/art:flex"
                                )}
                              >
                                {/* Rename and delete are the OWNER's. A team
                                    article belongs to someone else, and showing
                                    a button that 403s is worse than not showing
                                    it. Pinning is personal, so everyone gets it. */}
                                {a.isOwner && (
                                  <button
                                    onClick={(e) => startRenamingArticle(e, a)}
                                    className="p-1 rounded hover:bg-white/10"
                                    title="Rename"
                                  >
                                    <Pencil className="h-3.5 w-3.5 text-white/50 hover:text-white/90" />
                                  </button>
                                )}
                                <button
                                  onClick={(e) => togglePinArticle(e, a.id)}
                                  className="p-1 rounded hover:bg-white/10"
                                  title={pinnedArticleIds.has(a.id) ? "Unpin" : "Pin"}
                                >
                                  <Pin
                                    className={cn(
                                      "h-3.5 w-3.5 transition-colors",
                                      pinnedArticleIds.has(a.id)
                                        ? "text-yellow-400 fill-yellow-400"
                                        : "text-white/50 hover:text-white/90"
                                    )}
                                  />
                                </button>
                                {a.isOwner && (
                                  <button
                                    onClick={(e) => deleteArticle(e, a)}
                                    className="p-1 rounded ml-0.5 hover:bg-red-500/15"
                                    title="Delete"
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-white/50 hover:text-red-400" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                          {a.clientId !== null && clientNameById.get(a.clientId) && (
                            <div className="flex items-center gap-1 mt-0.5 pl-[22px]">
                              <Building2 className="h-3 w-3 text-white/30 shrink-0" />
                              <p className="text-[11px] text-white/55 truncate">
                                {clientNameById.get(a.clientId)}
                              </p>
                            </div>
                          )}
                        </button>
                      ))}
                      {visibleArticles.length > (searchQuery ? 8 : 5) && (
                        <button
                          onClick={() => router.push("/engineai/optimizer")}
                          className="w-full text-left px-2.5 py-1.5 text-[12px] text-white/55 hover:text-white/80 transition-colors"
                        >
                          {visibleArticles.length - (searchQuery ? 8 : 5)} more...
                        </button>
                      )}
                    </div>
                  )}
              {/* ─── Conversations ───
                  Headed only while searching, where the two lists sit together
                  and each needs to say what it is. Unsearched, the chat list
                  keeps its own client groupings and a second heading above them
                  would just be noise. */}
              {searchQuery && conversationCount > 0 && visibleArticles.length > 0 && (
                <div className="flex items-center justify-between px-2.5 pt-3 pb-1">
                  <p className="text-[11px] font-semibold text-white/55 uppercase tracking-wider">
                    Conversations
                  </p>
                  <span className="text-[11px] text-white/35 tabular-nums">{conversationCount}</span>
                </div>
              )}
              {searchQuery && conversationCount === 0 && visibleArticles.length > 0 && (
                <p className="px-2.5 pt-3 pb-1 text-[11.5px] text-white/40">
                  No conversations match.
                </p>
              )}
              {children}
            </div>
            )}
          </div>

          {footer}
        </div>
      </aside>
    </>
  );
}
