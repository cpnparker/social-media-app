"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import { toast } from "sonner";
import {
  DEFAULT_WIN_THEMES,
  DEFAULT_SOURCES,
  DEFAULT_SECTORS,
  DEFAULT_REGIONS,
} from "@/lib/rfp/company-profile";
import {
  Search,
  FileText,
  PenTool,
  Globe,
  Upload,
  FileSearch,
  Target,
  Loader2,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
  X,
  File,
  ExternalLink,
  Bookmark,
  Calendar,
  MapPin,
  Sparkles,
  Cpu,
  Download,
  FolderKanban,
  ArrowRight,
  ChevronDown,
  MoreHorizontal,
  Eye,
  Archive,
  Settings,
  Plus,
  ChevronUp,
  BookOpen,
  BarChart3,
  Link2,
  UserPlus,
  Copy,
  Shield,
  EyeOff,
  Undo2,
  Bell,
} from "lucide-react";
import { SavedSearchesPanel } from "./SavedSearches";
import { NotificationSettingsDialog } from "./NotificationSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ────────────────────────────────────────────────
   Types & Constants
   ──────────────────────────────────────────────── */

type Tab = "discover" | "library" | "pipeline";

const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "discover", label: "Discover RFPs", icon: Globe },
  { id: "library", label: "Document Library", icon: FileText },
  { id: "pipeline", label: "Pipeline", icon: FolderKanban },
];

interface RfpDocument {
  id_document: string;
  type_document: string;
  name_file: string;
  url_file: string;
  units_file_size: number;
  type_mime: string;
  document_summary: string | null;
  type_extraction_status: string;
  date_created: string;
}

interface DeadlineMilestone {
  type: string;
  label: string;
  date: string;
}

interface RfpOpportunity {
  id_opportunity: string;
  title: string;
  organisation_name: string;
  date_deadline: string | null;
  config_deadlines?: DeadlineMilestone[];
  document_scope: string | null;
  tags_sectors: string[];
  name_region: string | null;
  document_value: string | null;
  url_source: string | null;
  units_relevance_score: number | null;
  document_ai_reasoning: string | null;
  type_status: PipelineStatus;
  document_notes: string | null;
  date_created: string;
  date_updated: string | null;
  // URL verification metadata
  type_url_confidence?: UrlConfidence | null;
  name_portal?: string | null;
  url_portal_search?: string | null;
}

interface RfpResponse {
  id_response: string;
  id_opportunity: string | null;
  title: string;
  type_status: string;
  config_win_themes: string[];
  document_sections: any[];
  id_user_assigned?: number | null;
  name_user_assigned?: string | null;
  date_updated: string;
  date_created: string;
}

interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
}

type PipelineStatus = "discovered" | "shortlisted" | "in_progress" | "submitted" | "archived" | "ignored";

const PIPELINE_COLUMNS: { id: PipelineStatus; label: string; dotColor: string }[] = [
  { id: "discovered", label: "Discovered", dotColor: "bg-slate-400" },
  { id: "shortlisted", label: "Shortlisted", dotColor: "bg-amber-500" },
  { id: "in_progress", label: "In Progress", dotColor: "bg-blue-500" },
  { id: "submitted", label: "Submitted", dotColor: "bg-emerald-500" },
];

type ResponseStageStatus = "drafting" | "internal_review" | "revision" | "final_review" | "ready_to_submit";

const RESPONSE_STAGES: { id: ResponseStageStatus; label: string; dotColor: string }[] = [
  { id: "drafting", label: "Drafting", dotColor: "bg-slate-400" },
  { id: "internal_review", label: "Internal Review", dotColor: "bg-amber-500" },
  { id: "revision", label: "Revision", dotColor: "bg-blue-500" },
  { id: "final_review", label: "Final Review", dotColor: "bg-violet-500" },
  { id: "ready_to_submit", label: "Ready to Submit", dotColor: "bg-emerald-500" },
];

type UrlConfidence = "verified" | "trusted_domain" | "unverified" | "failed" | "none";

interface DiscoveredRfp {
  title: string;
  organisation: string;
  deadline: string | null;
  milestones: DeadlineMilestone[];
  scope: string;
  relevanceScore: number;
  sourceUrl: string | null;
  reasoning: string;
  sectors: string[];
  region: string | null;
  estimatedValue: string | null;
  // URL verification metadata
  urlConfidence?: UrlConfidence;
  portalName?: string | null;
  portalSearchUrl?: string | null;
}

type SearchProvider = "anthropic" | "grok";

interface SavedOppInfo {
  oppId: string;
  status: PipelineStatus;
  responseStatus?: string;
}

/* ────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────── */

/** Parse dates flexibly — handles YYYY-MM-DD, "April 15, 2026", DD/MM/YYYY, etc. */
function parseDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  // Try native Date first (handles ISO and most English formats)
  let d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;
  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    if (!isNaN(d.getTime())) return d;
  }
  // Quarter format: Q1 2026 → Jan 1
  const q = dateStr.match(/Q(\d)\s+(\d{4})/i);
  if (q) {
    const month = (Number(q[1]) - 1) * 3;
    return new Date(Number(q[2]), month, 1);
  }
  return null;
}

function getDeadlineUrgency(deadline: string | null) {
  if (!deadline) return null;
  const deadlineDate = parseDate(deadline);
  if (!deadlineDate) return null;
  const now = new Date();
  const diffDays = Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: "Overdue", className: "text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-400" };
  if (diffDays < 14) return { label: `${diffDays}d left`, className: "text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400" };
  if (diffDays < 28) return { label: `${diffDays}d left`, className: "text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400" };
  return { label: `${diffDays}d left`, className: "text-muted-foreground bg-muted" };
}

function scoreColor(score: number) {
  if (score >= 80) return "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20";
  if (score >= 60) return "text-amber-600 bg-amber-50 dark:bg-amber-900/20";
  return "text-muted-foreground bg-muted";
}

function sectionStatusIcon(status: string) {
  switch (status) {
    case "generated":
      return <Sparkles className="h-3 w-3 text-violet-500" />;
    case "edited":
      return <PenTool className="h-3 w-3 text-blue-500" />;
    case "approved":
      return <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
    default:
      return <div className="h-3 w-3 rounded-full border border-muted-foreground/30" />;
  }
}

function getResponseStage(status: string) {
  return RESPONSE_STAGES.find((s) => s.id === status) || RESPONSE_STAGES[0];
}

function formatDeadline(dateStr: string | null): string {
  if (!dateStr) return "No deadline";
  const d = parseDate(dateStr);
  if (!d) return dateStr; // Return raw string if unparseable
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Normalise a date string to ISO format for the API, or return null */
function toISODate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = parseDate(dateStr);
  if (!d) return null;
  return d.toISOString();
}

function extractDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ────────────────────────────────────────────────
   Search Config (localStorage persistence)
   ──────────────────────────────────────────────── */

interface SearchConfig {
  sources: string[];
  keywords: string[];
  sectors: string[];
  regions: string[];
}

function getStoredSearchConfig(workspaceId: string): SearchConfig {
  try {
    const stored = localStorage.getItem(`rfp-search-config-${workspaceId}`);
    if (stored) return JSON.parse(stored);
  } catch {}
  return {
    sources: [...DEFAULT_SOURCES],
    keywords: [],
    sectors: [],
    regions: [],
  };
}

function saveSearchConfig(workspaceId: string, config: SearchConfig) {
  try {
    localStorage.setItem(`rfp-search-config-${workspaceId}`, JSON.stringify(config));
  } catch {}
}

/* ────────────────────────────────────────────────
   Main Component
   ──────────────────────────────────────────────── */

export function RfpTool() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as Tab | null;
  const [activeTab, setActiveTab] = useState<Tab>(
    tabParam && ["discover", "library", "pipeline"].includes(tabParam) ? tabParam : "discover"
  );
  const wsCtx = useWorkspaceSafe();
  const workspaceId = wsCtx?.selectedWorkspace?.id;

  // Sync tab with URL param changes
  useEffect(() => {
    if (tabParam && ["discover", "library", "pipeline"].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  // Persist discover state across tab switches
  const [discoverResults, setDiscoverResults] = useState<DiscoveredRfp[]>([]);
  const [discoverSummary, setDiscoverSummary] = useState("");
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [discoverHasSearched, setDiscoverHasSearched] = useState(false);
  const [discoverSavedOpps, setDiscoverSavedOpps] = useState<Map<string, SavedOppInfo>>(new Map());

  // Notification settings dialog
  const [showNotifications, setShowNotifications] = useState(false);

  // Response editor state — when set, shows editor instead of tabs
  const [editorResponseId, setEditorResponseId] = useState<string | null>(null);
  const [editorOpportunity, setEditorOpportunity] = useState<RfpOpportunity | null>(null);

  const handleOpenEditor = (responseId: string, opportunity: RfpOpportunity | null) => {
    setEditorResponseId(responseId);
    setEditorOpportunity(opportunity);
    // Sync URL for shareability
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "pipeline");
    url.searchParams.set("response", responseId);
    window.history.replaceState({}, "", url.toString());
  };

  const handleCloseEditor = () => {
    setEditorResponseId(null);
    setEditorOpportunity(null);
    // Clean up URL
    const url = new URL(window.location.href);
    url.searchParams.delete("response");
    window.history.replaceState({}, "", url.toString());
  };

  // Auto-open response from URL param (for shareable links)
  const responseParam = searchParams.get("response");
  useEffect(() => {
    if (responseParam && !editorResponseId) {
      setActiveTab("pipeline");
      fetch(`/api/rfp/responses/${responseParam}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.response) {
            setEditorResponseId(responseParam);
            if (data.response.id_opportunity) {
              fetch(`/api/rfp/opportunities/${data.response.id_opportunity}`)
                .then((res) => (res.ok ? res.json() : null))
                .then((oppData) => {
                  if (oppData?.opportunity) setEditorOpportunity(oppData.opportunity);
                });
            }
          }
        });
    }
  }, [responseParam]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header — hidden when in editor */}
      {!editorResponseId && (
        <div className="border-b px-4 py-3 sm:px-6 sm:py-4 shrink-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-9 w-9 rounded-lg bg-cyan-500/10 flex items-center justify-center">
              <FileSearch className="h-5 w-5 text-cyan-600" />
            </div>
            <div className="flex-1">
              <h1 className="text-lg font-semibold">RFP Tool</h1>
              <p className="text-xs text-muted-foreground">
                Find, manage, and respond to RFPs
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 shrink-0"
              onClick={() => setShowNotifications(true)}
            >
              <Bell className="h-4 w-4" />
            </Button>
          </div>

          <NotificationSettingsDialog
            open={showNotifications}
            onOpenChange={setShowNotifications}
            workspaceId={workspaceId}
          />

          {/* Tab bar */}
          <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-2 sm:px-4 sm:gap-2 rounded-md text-xs sm:text-sm font-medium transition-colors flex-1 justify-center",
                    activeTab === tab.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.id === "discover" ? "Discover" : tab.id === "library" ? "Library" : "Pipeline"}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {editorResponseId ? (
          <ResponseEditor
            responseId={editorResponseId}
            opportunity={editorOpportunity}
            workspaceId={workspaceId}
            onBack={handleCloseEditor}
          />
        ) : (
          <>
            {activeTab === "discover" && (
              <DiscoverPanel
                workspaceId={workspaceId}
                onSaved={() => setActiveTab("pipeline")}
                results={discoverResults}
                setResults={setDiscoverResults}
                searchSummary={discoverSummary}
                setSearchSummary={setDiscoverSummary}
                query={discoverQuery}
                setQuery={setDiscoverQuery}
                hasSearched={discoverHasSearched}
                setHasSearched={setDiscoverHasSearched}
                savedOpps={discoverSavedOpps}
                setSavedOpps={setDiscoverSavedOpps}
              />
            )}
            {activeTab === "library" && <DocumentLibrary workspaceId={workspaceId} />}
            {activeTab === "pipeline" && (
              <PipelineView
                workspaceId={workspaceId}
                onOpenEditor={handleOpenEditor}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────
   Pipeline View (Kanban Board)
   ──────────────────────────────────────────────── */

function PipelineView({
  workspaceId,
  onOpenEditor,
}: {
  workspaceId?: string;
  onOpenEditor: (responseId: string, opportunity: RfpOpportunity | null) => void;
}) {
  const [opportunities, setOpportunities] = useState<RfpOpportunity[]>([]);
  const [responses, setResponses] = useState<RfpResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOpp, setSelectedOpp] = useState<RfpOpportunity | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);

  const fetchPipelineData = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const [oppRes, respRes] = await Promise.all([
        fetch(`/api/rfp/opportunities?workspaceId=${workspaceId}`),
        fetch(`/api/rfp/responses?workspaceId=${workspaceId}`),
      ]);
      if (oppRes.ok) {
        const oppData = await oppRes.json();
        setOpportunities(oppData.opportunities || []);
      }
      if (respRes.ok) {
        const respData = await respRes.json();
        setResponses(respData.responses || []);
      }
    } catch (err) {
      console.error("Pipeline fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchPipelineData();
  }, [fetchPipelineData]);

  const responseByOppId = useMemo(() => {
    const map = new Map<string, RfpResponse>();
    for (const r of responses) {
      if (r.id_opportunity) map.set(r.id_opportunity, r);
    }
    return map;
  }, [responses]);

  const handleStatusChange = async (oppId: string, newStatus: PipelineStatus) => {
    try {
      const res = await fetch(`/api/rfp/opportunities/${oppId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setOpportunities((prev) =>
          prev.map((o) => (o.id_opportunity === oppId ? { ...o, type_status: newStatus } : o))
        );
      }
    } catch (err) {
      console.error("Status update failed:", err);
    }
  };

  const handleStartResponse = async (opp: RfpOpportunity) => {
    if (!workspaceId) return;

    // Prevent duplicate responses
    const existingResponse = responseByOppId.get(opp.id_opportunity);
    if (existingResponse) {
      toast.info("A response already exists for this opportunity");
      onOpenEditor(existingResponse.id_response, opp);
      return;
    }

    try {
      // 1. Create linked response
      const res = await fetch("/api/rfp/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          title: opp.title,
          opportunityId: opp.id_opportunity,
        }),
      });
      if (!res.ok) throw new Error("Failed to create response");
      const data = await res.json();

      // 2. Update opportunity status
      await fetch(`/api/rfp/opportunities/${opp.id_opportunity}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in_progress" }),
      });

      // 3. Update local state
      setOpportunities((prev) =>
        prev.map((o) =>
          o.id_opportunity === opp.id_opportunity ? { ...o, type_status: "in_progress" } : o
        )
      );
      setResponses((prev) => [data.response, ...prev]);

      // 4. Open editor
      onOpenEditor(data.response.id_response, { ...opp, type_status: "in_progress" });
      toast.success("Response created and linked to opportunity");
    } catch (err) {
      console.error("Start response failed:", err);
      toast.error("Failed to create response");
    }
  };

  const handleDeleteOpp = async (oppId: string) => {
    try {
      await fetch(`/api/rfp/opportunities/${oppId}`, { method: "DELETE" });
      setOpportunities((prev) => prev.filter((o) => o.id_opportunity !== oppId));
      if (selectedOpp?.id_opportunity === oppId) setSelectedOpp(null);
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleNotesUpdate = async (oppId: string, notes: string) => {
    try {
      await fetch(`/api/rfp/opportunities/${oppId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      setOpportunities((prev) =>
        prev.map((o) => (o.id_opportunity === oppId ? { ...o, document_notes: notes } : o))
      );
    } catch (err) {
      console.error("Notes update failed:", err);
    }
  };

  if (!workspaceId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Select a workspace
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Build visible columns based on toggles
  const allColumns = [
    ...PIPELINE_COLUMNS,
    ...(showIgnored ? [{ id: "ignored" as PipelineStatus, label: "Ignored", dotColor: "bg-gray-400" }] : []),
    ...(showArchived ? [{ id: "archived" as PipelineStatus, label: "Archived", dotColor: "bg-gray-400" }] : []),
  ];

  const ignoredCount = opportunities.filter((o) => o.type_status === "ignored").length;
  const archivedCount = opportunities.filter((o) => o.type_status === "archived").length;

  const activeOpps = opportunities.filter((o) => o.type_status !== "ignored");
  if (activeOpps.length === 0 && ignoredCount === 0) {
    return (
      <div className="flex flex-col items-center py-16">
        <div className="h-16 w-16 rounded-2xl bg-cyan-500/10 flex items-center justify-center mb-4">
          <FolderKanban className="h-8 w-8 text-cyan-600" />
        </div>
        <h2 className="text-lg font-semibold mb-2">Pipeline</h2>
        <p className="text-sm text-muted-foreground text-center max-w-md mb-6">
          No opportunities yet. Use the Discover tab to find RFPs and save them to your pipeline.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold">Pipeline</h2>
        <div className="flex items-center gap-2">
          {ignoredCount > 0 && (
            <button
              onClick={() => setShowIgnored(!showIgnored)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
                showIgnored ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              <EyeOff className="h-3 w-3" />
              {showIgnored ? "Hide Ignored" : `Ignored (${ignoredCount})`}
            </button>
          )}
          <button
            onClick={() => setShowArchived(!showArchived)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
              showArchived ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"
            )}
          >
            <Archive className="h-3 w-3" />
            {showArchived ? "Hide Archived" : archivedCount > 0 ? `Archived (${archivedCount})` : "Show Archived"}
          </button>
        </div>
      </div>

      {/* Kanban columns */}
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-4 lg:overflow-x-auto pb-4">
        {allColumns.map((col) => {
          const columnOpps = opportunities.filter((o) => o.type_status === col.id);
          return (
            <div key={col.id} className="flex-1 lg:min-w-[260px] lg:max-w-[340px]">
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className={cn("h-2 w-2 rounded-full", col.dotColor)} />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {col.label}
                </h3>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                  {columnOpps.length}
                </Badge>
              </div>
              <div className="space-y-2 min-h-[100px]">
                {columnOpps.map((opp) => {
                  const linkedResponse = responseByOppId.get(opp.id_opportunity);
                  const urgency = getDeadlineUrgency(opp.date_deadline);
                  const totalSections = linkedResponse?.document_sections?.length || 0;
                  const completedSections = (linkedResponse?.document_sections || []).filter(
                    (s: any) => s.status !== "empty"
                  ).length;

                  return (
                    <div
                      key={opp.id_opportunity}
                      onClick={() => setSelectedOpp(opp)}
                      className="border rounded-lg p-3 bg-background hover:border-cyan-300 hover:shadow-sm transition-all cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="text-sm font-medium line-clamp-2">{opp.title}</h4>
                        {opp.units_relevance_score != null && opp.units_relevance_score > 0 && (
                          <span
                            className={cn(
                              "text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0",
                              scoreColor(opp.units_relevance_score)
                            )}
                          >
                            {opp.units_relevance_score}%
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">{opp.organisation_name}</p>

                      <div className="flex items-center gap-2 flex-wrap">
                        {urgency && (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded",
                              urgency.className
                            )}
                          >
                            <Clock className="h-2.5 w-2.5" />
                            {urgency.label}
                          </span>
                        )}
                      </div>

                      {linkedResponse && totalSections > 0 && (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{
                                width: `${(completedSections / totalSections) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {completedSections}/{totalSections}
                          </span>
                        </div>
                      )}

                      {linkedResponse && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <div className={cn("h-1.5 w-1.5 rounded-full", getResponseStage(linkedResponse.type_status).dotColor)} />
                          <span className="text-[10px] text-muted-foreground font-medium">
                            {getResponseStage(linkedResponse.type_status).label}
                          </span>
                        </div>
                      )}

                      {linkedResponse?.name_user_assigned && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <div className="h-4 w-4 rounded-full bg-cyan-100 text-cyan-700 flex items-center justify-center text-[8px] font-bold shrink-0">
                            {getInitials(linkedResponse.name_user_assigned)}
                          </div>
                          <span className="text-[10px] text-muted-foreground truncate">
                            {linkedResponse.name_user_assigned}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Opportunity detail dialog */}
      <Dialog open={!!selectedOpp} onOpenChange={(open) => !open && setSelectedOpp(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-base pr-6">{selectedOpp?.title}</DialogTitle>
          </DialogHeader>
          {selectedOpp && (
            <OpportunityDetail
              opportunity={selectedOpp}
              linkedResponse={responseByOppId.get(selectedOpp.id_opportunity) || null}
              onStatusChange={(newStatus) => {
                handleStatusChange(selectedOpp.id_opportunity, newStatus);
                setSelectedOpp((prev) => (prev ? { ...prev, type_status: newStatus } : prev));
              }}
              onStartResponse={() => {
                handleStartResponse(selectedOpp);
                setSelectedOpp(null);
              }}
              onOpenEditor={(responseId) => {
                onOpenEditor(responseId, selectedOpp);
                setSelectedOpp(null);
              }}
              onDelete={() => handleDeleteOpp(selectedOpp.id_opportunity)}
              onNotesUpdate={(notes) =>
                handleNotesUpdate(selectedOpp.id_opportunity, notes)
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ────────────────────────────────────────────────
   Opportunity Detail (inside dialog)
   ──────────────────────────────────────────────── */

function OpportunityDetail({
  opportunity,
  linkedResponse,
  onStatusChange,
  onStartResponse,
  onOpenEditor,
  onDelete,
  onNotesUpdate,
}: {
  opportunity: RfpOpportunity;
  linkedResponse: RfpResponse | null;
  onStatusChange: (status: PipelineStatus) => void;
  onStartResponse: () => void;
  onOpenEditor: (responseId: string) => void;
  onDelete: () => void;
  onNotesUpdate: (notes: string) => void;
}) {
  const [notes, setNotes] = useState(opportunity.document_notes || "");
  const urgency = getDeadlineUrgency(opportunity.date_deadline);

  const totalSections = linkedResponse?.document_sections?.length || 0;
  const completedSections = (linkedResponse?.document_sections || []).filter(
    (s: any) => s.status !== "empty"
  ).length;

  return (
    <div className="space-y-4">
      {/* Metadata */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Organisation</p>
          <p className="font-medium">{opportunity.organisation_name}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Submission Deadline</p>
          <div className="flex items-center gap-2">
            <p className="font-medium">
              {opportunity.date_deadline
                ? new Date(opportunity.date_deadline).toLocaleDateString()
                : "Not specified"}
            </p>
            {urgency && (
              <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", urgency.className)}>
                {urgency.label}
              </span>
            )}
          </div>
        </div>
        {opportunity.name_region && (
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Region</p>
            <p className="font-medium">{opportunity.name_region}</p>
          </div>
        )}
        {opportunity.document_value && (
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Estimated Value</p>
            <p className="font-medium">{opportunity.document_value}</p>
          </div>
        )}
        {opportunity.units_relevance_score != null && opportunity.units_relevance_score > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Relevance Score</p>
            <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", scoreColor(opportunity.units_relevance_score))}>
              {opportunity.units_relevance_score}%
            </span>
          </div>
        )}
      </div>

      {/* Scope */}
      {opportunity.document_scope && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Scope</p>
          <p className="text-sm leading-relaxed">{opportunity.document_scope}</p>
        </div>
      )}

      {/* AI Reasoning */}
      {opportunity.document_ai_reasoning && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">AI Reasoning</p>
          <p className="text-sm text-muted-foreground italic leading-relaxed">
            {opportunity.document_ai_reasoning}
          </p>
        </div>
      )}

      {/* Milestones Timeline */}
      {opportunity.config_deadlines && opportunity.config_deadlines.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2">Key Milestones</p>
          <div className="space-y-2 border-l-2 border-muted pl-3">
            {opportunity.config_deadlines.map((m, i) => {
              const mUrgency = getDeadlineUrgency(m.date);
              return (
                <div key={i} className="relative">
                  <div className="absolute -left-[calc(0.75rem+1px)] top-1 h-2 w-2 rounded-full bg-cyan-500 border-2 border-background" />
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{m.label}</p>
                    {mUrgency && (
                      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", mUrgency.className)}>
                        {mUrgency.label}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(m.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Source URL with confidence-aware display */}
      {opportunity.url_source ? (
        <div className="space-y-1.5">
          <a
            href={opportunity.url_source}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-600 hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            View Source ({extractDomain(opportunity.url_source)})
          </a>
          {opportunity.type_url_confidence === "verified" ? (
            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Verified link
            </p>
          ) : opportunity.type_url_confidence === "trusted_domain" ? (
            <p className="text-[10px] text-cyan-600 dark:text-cyan-400 flex items-center gap-1">
              <Shield className="h-2.5 w-2.5" />
              Trusted portal{opportunity.name_portal ? ` — ${opportunity.name_portal}` : ""}
            </p>
          ) : opportunity.type_url_confidence === "unverified" ? (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <AlertCircle className="h-2.5 w-2.5" />
              Unverified — check manually
            </p>
          ) : (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <Shield className="h-2.5 w-2.5" />
              AI-generated link — verify before trusting
            </p>
          )}
        </div>
      ) : opportunity.url_portal_search ? (
        <div>
          <a
            href={opportunity.url_portal_search}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-cyan-600 hover:underline"
          >
            <Search className="h-3 w-3" />
            Search {opportunity.name_portal || "portal"}
          </a>
        </div>
      ) : null}

      {/* Notes */}
      <div>
        <p className="text-xs text-muted-foreground mb-1">Notes</p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => onNotesUpdate(notes)}
          placeholder="Add notes about this opportunity..."
          className="w-full text-sm bg-muted/50 rounded-lg p-3 border-0 resize-none h-20 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
        />
      </div>

      {/* Linked Response */}
      <div className="border rounded-lg p-3">
        <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Response</p>
        {linkedResponse ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">{linkedResponse.title}</p>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className={cn("h-1.5 w-1.5 rounded-full", getResponseStage(linkedResponse.type_status).dotColor)} />
                {getResponseStage(linkedResponse.type_status).label}
              </span>
            </div>
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${totalSections > 0 ? (completedSections / totalSections) * 100 : 0}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground">{completedSections}/{totalSections} sections</span>
            </div>
            <Button
              size="sm"
              onClick={() => onOpenEditor(linkedResponse.id_response)}
              className="gap-1.5 w-full"
            >
              <PenTool className="h-3.5 w-3.5" />
              Open Response
            </Button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-muted-foreground mb-3">
              No response started yet. Create one to begin drafting.
            </p>
            <Button size="sm" onClick={onStartResponse} className="gap-1.5 w-full">
              <ArrowRight className="h-3.5 w-3.5" />
              Start Response
            </Button>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2 border-t">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              Status: <span className="capitalize">{opportunity.type_status.replace("_", " ")}</span>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {[...PIPELINE_COLUMNS, { id: "ignored" as PipelineStatus, label: "Ignored", dotColor: "bg-gray-400" }, { id: "archived" as PipelineStatus, label: "Archived", dotColor: "bg-gray-400" }].map(
              (col) => (
                <DropdownMenuItem
                  key={col.id}
                  onClick={() => onStatusChange(col.id)}
                  className="gap-2 text-xs"
                >
                  <div className={cn("h-2 w-2 rounded-full", col.dotColor)} />
                  {col.label}
                  {opportunity.type_status === col.id && <CheckCircle2 className="h-3 w-3 ml-auto" />}
                </DropdownMenuItem>
              )
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-xs text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Delete
        </Button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────
   Response Editor
   ──────────────────────────────────────────────── */

function ResponseEditor({
  responseId,
  opportunity,
  workspaceId,
  onBack,
}: {
  responseId: string;
  opportunity: RfpOpportunity | null;
  workspaceId?: string;
  onBack: () => void;
}) {
  const [response, setResponse] = useState<RfpResponse | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [suggestingThemes, setSuggestingThemes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showBrief, setShowBrief] = useState(false);
  const [showMobileSections, setShowMobileSections] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);

  // Fetch workspace members for assignment
  useEffect(() => {
    fetch("/api/workspace-members")
      .then((res) => res.json())
      .then((data) => {
        if (data.members) {
          setMembers(
            data.members
              .filter((m: any) => m.accessRfpTool === true)
              .map((m: any) => ({
                id: String(m.id),
                name: m.name || m.email,
                email: m.email,
              }))
          );
        }
      })
      .catch(() => {});
  }, []);

  const handleAssign = async (member: WorkspaceMember | null) => {
    if (!response) return;
    try {
      const res = await fetch(`/api/rfp/responses/${response.id_response}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: member ? parseInt(member.id, 10) : null,
          userName: member?.name || null,
        }),
      });
      if (res.ok) {
        setResponse((prev) =>
          prev
            ? {
                ...prev,
                id_user_assigned: member ? parseInt(member.id, 10) : null,
                name_user_assigned: member?.name || null,
              }
            : prev
        );
        toast.success(member ? `Assigned to ${member.name}` : "Assignment removed");
      }
    } catch {
      toast.error("Failed to assign user");
    }
  };

  useEffect(() => {
    async function fetchResponse() {
      try {
        const res = await fetch(`/api/rfp/responses/${responseId}`);
        if (res.ok) {
          const data = await res.json();
          setResponse(data.response);
          setActiveSection(data.response.document_sections?.[0]?.id || null);
        }
      } catch (err) {
        console.error("Failed to fetch response:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchResponse();
  }, [responseId]);

  const generateSection = async (sectionId: string) => {
    if (!response) return;
    setGenerating(sectionId);
    try {
      const res = await fetch(`/api/rfp/responses/${response.id_response}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId }),
      });
      if (res.ok) {
        const data = await res.json();
        setResponse((prev) => {
          if (!prev) return prev;
          const updated = prev.document_sections.map((s: any) =>
            s.id === sectionId
              ? { ...s, content: data.content, status: "generated", wordCount: data.wordCount }
              : s
          );
          return { ...prev, document_sections: updated };
        });
      }
    } catch (err) {
      console.error("Generation failed:", err);
      toast.error("Failed to generate section");
    } finally {
      setGenerating(null);
    }
  };

  const handleGenerateAll = async () => {
    if (!response) return;
    setGeneratingAll(true);

    const emptySections = response.document_sections.filter(
      (s: any) => s.status === "empty"
    );

    for (const section of emptySections) {
      setActiveSection(section.id);
      setGenerating(section.id);
      try {
        const res = await fetch(`/api/rfp/responses/${response.id_response}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sectionId: section.id }),
        });
        if (res.ok) {
          const data = await res.json();
          setResponse((prev) => {
            if (!prev) return prev;
            const updated = prev.document_sections.map((s: any) =>
              s.id === section.id
                ? { ...s, content: data.content, status: "generated", wordCount: data.wordCount }
                : s
            );
            return { ...prev, document_sections: updated };
          });
        }
      } catch (err) {
        console.error(`Generation failed for ${section.title}:`, err);
        toast.error(`Failed to generate ${section.title}`);
      } finally {
        setGenerating(null);
      }
    }

    setGeneratingAll(false);
    if (emptySections.length > 0) {
      toast.success(`Generated ${emptySections.length} sections`);
    }
  };

  const updateSectionContent = async (sectionId: string, content: string) => {
    if (!response) return;
    const updatedSections = response.document_sections.map((s: any) =>
      s.id === sectionId
        ? { ...s, content, status: "edited", wordCount: content.split(/\s+/).length }
        : s
    );
    setResponse((prev) => (prev ? { ...prev, document_sections: updatedSections } : prev));
    await fetch(`/api/rfp/responses/${response.id_response}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sections: updatedSections }),
    });
  };

  const handleStageChange = async (newStage: ResponseStageStatus) => {
    if (!response) return;
    try {
      const res = await fetch(`/api/rfp/responses/${response.id_response}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStage }),
      });
      if (res.ok) {
        setResponse((prev) => (prev ? { ...prev, type_status: newStage } : prev));
        toast.success(`Status updated to ${RESPONSE_STAGES.find((s) => s.id === newStage)?.label}`);
      }
    } catch (err) {
      console.error("Stage update failed:", err);
      toast.error("Failed to update status");
    }
  };

  const handleSuggestWinThemes = async () => {
    if (!response) return;
    setSuggestingThemes(true);
    try {
      await fetch(`/api/rfp/responses/${response.id_response}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ winThemes: DEFAULT_WIN_THEMES }),
      });
      setResponse((prev) =>
        prev ? { ...prev, config_win_themes: DEFAULT_WIN_THEMES } : prev
      );
      toast.success("Win themes added");
    } catch {
      toast.error("Failed to add win themes");
    } finally {
      setSuggestingThemes(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Response not found
      </div>
    );
  }

  const currentSection = response.document_sections.find(
    (s: any) => s.id === activeSection
  );

  const urgency = opportunity ? getDeadlineUrgency(opportunity.date_deadline) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Opportunity context banner */}
      {opportunity && (() => {
        const totalSecs = response?.document_sections?.length || 0;
        const completedSecs = response?.document_sections?.filter(
          (s: any) => s.status !== "empty"
        ).length || 0;
        const totalWords = response?.document_sections?.reduce(
          (sum: number, s: any) => sum + (s.wordCount || 0),
          0
        ) || 0;

        return (
          <div className="border-b px-4 py-3 bg-cyan-50/50 dark:bg-cyan-900/10 shrink-0">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
                  Responding to opportunity
                </p>
                <p className="text-sm font-medium truncate">{opportunity.title}</p>
                <div className="flex items-center gap-2 sm:gap-3 mt-0.5 flex-wrap">
                  <span className="text-xs text-muted-foreground">{opportunity.organisation_name}</span>
                  {opportunity.date_deadline && (
                    <span className={cn("text-xs", urgency?.className || "text-muted-foreground")}>
                      Submission: {new Date(opportunity.date_deadline).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 shrink-0 sm:ml-4">
                {/* Progress summary */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5" />
                    <span>{completedSecs}/{totalSecs} sections</span>
                  </div>
                  <span className="text-muted-foreground/40">|</span>
                  <span>{totalWords.toLocaleString()} words</span>
                </div>
                {/* View RFP Brief toggle */}
                <Button
                  variant={showBrief ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5 text-xs h-7"
                  onClick={() => setShowBrief(!showBrief)}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  {showBrief ? "Hide Brief" : "RFP Brief"}
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Response stage stepper */}
      {response && (
        <div className="border-b px-3 py-2 sm:px-4 shrink-0 flex items-center justify-between bg-background gap-2">
          {/* Mobile: current stage only */}
          <div className="flex items-center gap-1.5 lg:hidden">
            <div className={cn("h-2 w-2 rounded-full", getResponseStage(response.type_status).dotColor)} />
            <span className="text-xs font-medium">{getResponseStage(response.type_status).label}</span>
            <span className="text-xs text-muted-foreground">
              ({RESPONSE_STAGES.findIndex(s => s.id === response.type_status) + 1}/{RESPONSE_STAGES.length})
            </span>
          </div>
          {/* Desktop: full stepper */}
          <div className="hidden lg:flex items-center gap-1">
            {RESPONSE_STAGES.map((stage, i) => {
              const currentStage = getResponseStage(response.type_status);
              const currentIndex = RESPONSE_STAGES.findIndex((s) => s.id === currentStage.id);
              const isActive = stage.id === currentStage.id;
              const isPast = i < currentIndex;
              return (
                <div key={stage.id} className="flex items-center">
                  {i > 0 && (
                    <div
                      className={cn(
                        "h-px w-3 mx-0.5",
                        isPast ? "bg-emerald-400" : "bg-muted-foreground/20"
                      )}
                    />
                  )}
                  <div
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors",
                      isActive && "bg-muted text-foreground",
                      isPast && "text-emerald-600",
                      !isActive && !isPast && "text-muted-foreground"
                    )}
                  >
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full",
                        isActive
                          ? stage.dotColor
                          : isPast
                          ? "bg-emerald-400"
                          : "bg-muted-foreground/30"
                      )}
                    />
                    {stage.label}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            {/* User assignment */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7">
                  {response.name_user_assigned ? (
                    <>
                      <div className="h-4 w-4 rounded-full bg-foreground/10 flex items-center justify-center text-[8px] font-bold">
                        {getInitials(response.name_user_assigned)}
                      </div>
                      <span className="hidden sm:inline">{response.name_user_assigned}</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-3 w-3" />
                      <span className="hidden sm:inline">Assign</span>
                    </>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {members.map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    onClick={() => handleAssign(m)}
                    className="gap-2 text-xs"
                  >
                    <div className="h-5 w-5 rounded-full bg-foreground/10 flex items-center justify-center text-[9px] font-bold">
                      {getInitials(m.name)}
                    </div>
                    {m.name}
                    {response.id_user_assigned === parseInt(m.id, 10) && (
                      <CheckCircle2 className="h-3 w-3 ml-auto text-emerald-500" />
                    )}
                  </DropdownMenuItem>
                ))}
                {response.id_user_assigned && (
                  <DropdownMenuItem
                    onClick={() => handleAssign(null)}
                    className="gap-2 text-xs text-destructive"
                  >
                    <X className="h-3 w-3" />
                    Remove assignment
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Copy link */}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs h-7"
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.set("tab", "pipeline");
                url.searchParams.set("response", responseId);
                navigator.clipboard.writeText(url.toString());
                toast.success("Link copied to clipboard");
              }}
            >
              <Copy className="h-3 w-3" />
              <span className="hidden sm:inline">Copy Link</span>
            </Button>

            {/* Stage dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7">
                  {getResponseStage(response.type_status).label}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {RESPONSE_STAGES.map((stage) => (
                  <DropdownMenuItem
                    key={stage.id}
                    onClick={() => handleStageChange(stage.id)}
                    className="gap-2 text-xs"
                  >
                    <div className={cn("h-2 w-2 rounded-full", stage.dotColor)} />
                    {stage.label}
                    {response.type_status === stage.id && (
                      <CheckCircle2 className="h-3 w-3 ml-auto" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0 relative">
        {/* Mobile backdrop for section sidebar */}
        {showMobileSections && (
          <div
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
            onClick={() => setShowMobileSections(false)}
          />
        )}

        {/* Section sidebar */}
        <div className={cn(
          "w-64 border-r shrink-0 flex flex-col bg-background",
          "fixed inset-y-0 left-0 z-40 transition-transform duration-200 lg:static lg:translate-x-0",
          showMobileSections ? "translate-x-0" : "-translate-x-full"
        )}>
          <div className="p-3 border-b">
            <div className="flex items-center justify-between">
              <button
                onClick={onBack}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 py-1"
              >
                &larr; Back to Pipeline
              </button>
              <button
                onClick={() => setShowMobileSections(false)}
                className="lg:hidden p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <h3 className="text-sm font-semibold truncate">{response.title}</h3>
          </div>

          <div className="p-2 border-b space-y-1">
            <a
              href={`/api/rfp/responses/${response.id_response}/export`}
              className="flex items-center gap-1.5 w-full px-2.5 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Export DOCX
            </a>
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5 text-xs h-8"
              onClick={handleGenerateAll}
              disabled={generatingAll || !!generating}
            >
              {generatingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {generatingAll ? "Generating..." : "Generate All Sections"}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {response.document_sections.map((section: any) => (
              <button
                key={section.id}
                onClick={() => { setActiveSection(section.id); setShowMobileSections(false); }}
                className={cn(
                  "w-full text-left flex items-center gap-2 px-2.5 py-2.5 sm:py-2 rounded-lg text-xs transition-colors mb-0.5",
                  activeSection === section.id
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  generating === section.id && "animate-pulse"
                )}
              >
                {generating === section.id ? (
                  <Loader2 className="h-3 w-3 animate-spin text-violet-500" />
                ) : (
                  sectionStatusIcon(section.status)
                )}
                <span className="truncate flex-1">{section.title}</span>
                {section.wordCount > 0 && (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {section.wordCount}w
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Win Themes */}
          <div className="border-t p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Win Themes
              </h4>
              {(!response.config_win_themes || response.config_win_themes.length === 0) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-[10px] gap-1 px-1.5"
                  onClick={handleSuggestWinThemes}
                  disabled={suggestingThemes}
                >
                  {suggestingThemes ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-2.5 w-2.5" />
                  )}
                  Suggest
                </Button>
              )}
            </div>
            {(response.config_win_themes || []).length > 0 ? (
              <div className="space-y-1.5">
                {(response.config_win_themes || []).map((theme: string, i: number) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <Target className="h-3 w-3 text-cyan-500 mt-0.5 shrink-0" />
                    <span className="text-[11px] leading-tight">{theme}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                No win themes yet
              </p>
            )}
          </div>
        </div>

        {/* Section editor */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Mobile sections toggle */}
          <button
            onClick={() => setShowMobileSections(true)}
            className="lg:hidden flex items-center gap-1.5 px-3 py-2.5 mx-4 mt-3 mb-1 rounded-lg border text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            <FileText className="h-3.5 w-3.5" />
            Sections ({response.document_sections.length})
          </button>
          {currentSection ? (
            <>
              <div className="p-4 border-b shrink-0 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm">{currentSection.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {currentSection.guidance}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => generateSection(currentSection.id)}
                  disabled={generating === currentSection.id || generatingAll}
                  className="gap-1.5"
                >
                  {generating === currentSection.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {generating === currentSection.id
                    ? "Generating..."
                    : currentSection.content
                    ? "Regenerate"
                    : "Generate with AI"}
                </Button>
              </div>
              <div className="flex-1 min-h-0 p-4">
                {generating === currentSection.id && !currentSection.content ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
                    <p className="text-sm text-muted-foreground">
                      Generating {currentSection.title}...
                    </p>
                  </div>
                ) : currentSection.content ? (
                  <textarea
                    value={currentSection.content}
                    onChange={(e) =>
                      updateSectionContent(currentSection.id, e.target.value)
                    }
                    className="w-full h-full resize-none text-sm leading-relaxed bg-transparent border rounded-lg p-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    placeholder="Section content will appear here..."
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <PenTool className="h-8 w-8 mb-3 text-muted-foreground/50" />
                    <p className="text-sm">
                      Click &quot;Generate with AI&quot; to draft this section
                    </p>
                    <p className="text-xs mt-1">
                      Target: ~{currentSection.targetWords} words
                    </p>
                  </div>
                )}
              </div>
              <div className="px-4 py-2 border-t shrink-0 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {currentSection.wordCount > 0
                    ? `${currentSection.wordCount} words`
                    : "Empty"}{" "}
                  / ~{currentSection.targetWords} target
                </span>
                <span className="capitalize">{currentSection.status}</span>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Select a section from the sidebar
            </div>
          )}
        </div>

        {/* RFP Brief panel — right sidebar */}
        {showBrief && opportunity && (
          <div className={cn(
            "border-l shrink-0 flex flex-col overflow-y-auto",
            "fixed inset-0 z-40 w-full bg-background lg:static lg:w-80 lg:z-auto lg:bg-muted/20"
          )}>
            <div className="p-4 border-b sticky top-0 bg-muted/20 backdrop-blur-sm z-10">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  RFP Brief
                </h3>
                <button
                  onClick={() => setShowBrief(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="p-4 space-y-5">
              {/* Organisation */}
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                  Organisation
                </p>
                <p className="text-sm font-medium">{opportunity.organisation_name}</p>
              </div>

              {/* Submission Deadline */}
              {opportunity.date_deadline && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Submission Deadline
                  </p>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className={cn("text-sm font-medium", urgency?.className)}>
                      {new Date(opportunity.date_deadline).toLocaleDateString("en-GB", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  {urgency && (
                    <Badge
                      variant="secondary"
                      className={cn("text-[10px] mt-1.5", urgency.className)}
                    >
                      {urgency.label}
                    </Badge>
                  )}
                </div>
              )}

              {/* Milestones Timeline */}
              {opportunity.config_deadlines && opportunity.config_deadlines.length > 0 && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
                    Key Milestones
                  </p>
                  <div className="space-y-2.5 border-l-2 border-muted pl-3">
                    {opportunity.config_deadlines.map((m, i) => {
                      const mUrgency = getDeadlineUrgency(m.date);
                      return (
                        <div key={i} className="relative">
                          <div className="absolute -left-[calc(0.75rem+1px)] top-1 h-2 w-2 rounded-full bg-cyan-500 border-2 border-background" />
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-medium">{m.label}</p>
                            {mUrgency && (
                              <span className={cn("text-[10px] font-medium px-1 py-0.5 rounded", mUrgency.className)}>
                                {mUrgency.label}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {new Date(m.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Region */}
              {opportunity.name_region && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Region
                  </p>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm">{opportunity.name_region}</span>
                  </div>
                </div>
              )}

              {/* Estimated Value */}
              {opportunity.document_value && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Estimated Value
                  </p>
                  <p className="text-sm font-medium">{opportunity.document_value}</p>
                </div>
              )}

              {/* Relevance Score */}
              {opportunity.units_relevance_score != null && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Relevance Score
                  </p>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-xs font-bold",
                      scoreColor(opportunity.units_relevance_score)
                    )}
                  >
                    {opportunity.units_relevance_score}%
                  </Badge>
                </div>
              )}

              {/* Scope — the main content */}
              {opportunity.document_scope && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Scope &amp; Requirements
                  </p>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap bg-background border rounded-lg p-3">
                    {opportunity.document_scope}
                  </div>
                </div>
              )}

              {/* Sectors */}
              {opportunity.tags_sectors && opportunity.tags_sectors.length > 0 && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Sectors
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {opportunity.tags_sectors.map((sector) => (
                      <Badge key={sector} variant="secondary" className="text-xs">
                        {sector}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Reasoning */}
              {opportunity.document_ai_reasoning && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Why This Is Relevant
                  </p>
                  <p className="text-sm text-muted-foreground italic leading-relaxed">
                    {opportunity.document_ai_reasoning}
                  </p>
                </div>
              )}

              {/* Notes */}
              {opportunity.document_notes && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Notes
                  </p>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {opportunity.document_notes}
                  </p>
                </div>
              )}

              {/* Source URL with confidence-aware display */}
              {opportunity.url_source ? (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Original RFP
                  </p>
                  <a
                    href={opportunity.url_source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-cyan-600 hover:text-cyan-700 hover:underline"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    {extractDomain(opportunity.url_source) || "View Source"}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  {opportunity.type_url_confidence === "verified" ? (
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-1">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      Verified link
                    </p>
                  ) : opportunity.type_url_confidence === "trusted_domain" ? (
                    <p className="text-[10px] text-cyan-600 dark:text-cyan-400 flex items-center gap-1 mt-1">
                      <Shield className="h-2.5 w-2.5" />
                      Trusted portal{opportunity.name_portal ? ` — ${opportunity.name_portal}` : ""}
                    </p>
                  ) : opportunity.type_url_confidence === "unverified" ? (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1">
                      <AlertCircle className="h-2.5 w-2.5" />
                      Unverified — check manually
                    </p>
                  ) : (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1">
                      <Shield className="h-2.5 w-2.5" />
                      AI-generated link — verify before trusting
                    </p>
                  )}
                </div>
              ) : opportunity.url_portal_search ? (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Original RFP
                  </p>
                  <a
                    href={opportunity.url_portal_search}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-cyan-600 hover:underline"
                  >
                    <Search className="h-3.5 w-3.5" />
                    Search {opportunity.name_portal || "portal"}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────
   Document Library
   ──────────────────────────────────────────────── */

function DocumentLibrary({ workspaceId }: { workspaceId?: string }) {
  const [documents, setDocuments] = useState<RfpDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<RfpDocument | null>(null);
  const [docTypeFilter, setDocTypeFilter] = useState<string>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocuments = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const params = new URLSearchParams({ workspaceId });
      if (docTypeFilter !== "all") params.set("type", docTypeFilter);
      const res = await fetch(`/api/rfp/documents?${params}`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents || []);
      }
    } catch (err) {
      console.error("Failed to fetch documents:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, docTypeFilter]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    const hasPending = documents.some(
      (d) => d.type_extraction_status === "pending" || d.type_extraction_status === "extracting"
    );
    if (!hasPending) return;
    const interval = setInterval(fetchDocuments, 5000);
    return () => clearInterval(interval);
  }, [documents, fetchDocuments]);

  const handleUpload = async (files: FileList | File[]) => {
    if (!workspaceId) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        // Check file size (50MB limit)
        if (file.size > 50 * 1024 * 1024) {
          toast.error(`"${file.name}" exceeds the 50MB limit`);
          continue;
        }
        toast.info(`Uploading ${file.name}...`);
        // Use client-side Vercel Blob upload (bypasses serverless body limits)
        const { upload } = await import("@vercel/blob/client");
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/media/upload",
        });
        await fetch("/api/rfp/documents/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            fileName: file.name,
            fileUrl: blob.url,
            fileSize: file.size,
            mimeType: file.type,
            documentType: "previous_response",
          }),
        });
      }
      await fetchDocuments();
      toast.success("Upload complete");
    } catch (err: any) {
      console.error("Upload error:", err);
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docId: string) => {
    try {
      const res = await fetch(`/api/rfp/documents/${docId}`, { method: "DELETE" });
      if (res.ok) {
        setDocuments((prev) => prev.filter((d) => d.id_document !== docId));
        if (selectedDoc?.id_document === docId) setSelectedDoc(null);
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "ready":
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
      case "extracting":
      case "pending":
        return <Loader2 className="h-3.5 w-3.5 text-amber-500 animate-spin" />;
      case "failed":
        return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
      default:
        return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const docTypeLabel = (type: string) => {
    switch (type) {
      case "previous_response": return "Previous Response";
      case "target_rfp": return "Target RFP";
      case "supporting": return "Supporting";
      default: return type;
    }
  };

  if (!workspaceId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Select a workspace to view documents
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "border-2 border-dashed rounded-xl p-5 sm:p-8 text-center transition-colors mb-4 sm:mb-6",
          dragOver
            ? "border-violet-500 bg-violet-500/5"
            : "border-muted-foreground/20 hover:border-muted-foreground/40"
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleUpload(e.target.files);
            e.target.value = "";
          }}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 text-violet-500 animate-spin" />
            <p className="text-sm font-medium">Uploading...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              Drop PDF or DOCX files here, or{" "}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-violet-600 hover:underline"
              >
                browse
              </button>
            </p>
            <p className="text-xs text-muted-foreground">
              Upload previous RFP responses and supporting documents
            </p>
          </div>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {["all", "previous_response", "target_rfp", "supporting"].map((type) => (
          <button
            key={type}
            onClick={() => setDocTypeFilter(type)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              docTypeFilter === type
                ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {type === "all" ? "All" : docTypeLabel(type)}
          </button>
        ))}
      </div>

      {/* Document list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No documents uploaded yet. Upload your first RFP response above.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((doc) => (
            <div
              key={doc.id_document}
              onClick={() => setSelectedDoc(doc)}
              className="group border rounded-xl p-4 hover:border-violet-300 hover:shadow-sm transition-all cursor-pointer"
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-lg bg-violet-50 dark:bg-violet-900/20 flex items-center justify-center shrink-0">
                  <File className="h-5 w-5 text-violet-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{doc.name_file}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">
                      {formatFileSize(doc.units_file_size)}
                    </span>
                    <span className="text-xs text-muted-foreground">&middot;</span>
                    <span className="text-xs text-muted-foreground">
                      {docTypeLabel(doc.type_document)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    {statusIcon(doc.type_extraction_status)}
                    <span className="text-xs text-muted-foreground capitalize">
                      {doc.type_extraction_status === "ready"
                        ? "Processed"
                        : doc.type_extraction_status}
                    </span>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(doc.id_document);
                  }}
                  className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-500 transition-all"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {doc.document_summary && (
                <p className="mt-3 text-xs text-muted-foreground line-clamp-2">
                  {doc.document_summary}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Document detail modal */}
      <Dialog open={!!selectedDoc} onOpenChange={(open) => !open && setSelectedDoc(null)}>
        <DialogContent className="max-w-lg p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <File className="h-4 w-4 text-violet-500" />
              {selectedDoc?.name_file}
            </DialogTitle>
          </DialogHeader>
          {selectedDoc && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Type</p>
                  <p className="font-medium">{docTypeLabel(selectedDoc.type_document)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Size</p>
                  <p className="font-medium">{formatFileSize(selectedDoc.units_file_size)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Status</p>
                  <div className="flex items-center gap-1.5">
                    {statusIcon(selectedDoc.type_extraction_status)}
                    <span className="font-medium capitalize">
                      {selectedDoc.type_extraction_status === "ready"
                        ? "Processed"
                        : selectedDoc.type_extraction_status}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Uploaded</p>
                  <p className="font-medium">
                    {new Date(selectedDoc.date_created).toLocaleDateString()}
                  </p>
                </div>
              </div>
              {selectedDoc.document_summary && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">AI Summary</p>
                  <div className="bg-muted/50 rounded-lg p-3 text-sm leading-relaxed">
                    {selectedDoc.document_summary}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    handleDelete(selectedDoc.id_document);
                    setSelectedDoc(null);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ────────────────────────────────────────────────
   Discover Panel
   ──────────────────────────────────────────────── */

function DiscoverPanel({
  workspaceId,
  onSaved,
  results,
  setResults,
  searchSummary,
  setSearchSummary,
  query,
  setQuery,
  hasSearched,
  setHasSearched,
  savedOpps,
  setSavedOpps,
}: {
  workspaceId?: string;
  onSaved?: () => void;
  results: DiscoveredRfp[];
  setResults: (r: DiscoveredRfp[]) => void;
  searchSummary: string;
  setSearchSummary: (s: string) => void;
  query: string;
  setQuery: (q: string) => void;
  hasSearched: boolean;
  setHasSearched: (h: boolean) => void;
  savedOpps: Map<string, SavedOppInfo>;
  setSavedOpps: React.Dispatch<React.SetStateAction<Map<string, SavedOppInfo>>>;
}) {
  const [provider, setProvider] = useState<SearchProvider>("anthropic");
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [searchConfig, setSearchConfig] = useState<SearchConfig>(() =>
    workspaceId
      ? getStoredSearchConfig(workspaceId)
      : { sources: [...DEFAULT_SOURCES], keywords: [], sectors: [], regions: [] }
  );
  const [newSource, setNewSource] = useState("");
  const [newKeyword, setNewKeyword] = useState("");
  const [selectedRfp, setSelectedRfp] = useState<DiscoveredRfp | null>(null);
  const [searchMeta, setSearchMeta] = useState<{
    userName: string;
    date: string;
    provider: string;
    resultCount: number;
    query: string | null;
  } | null>(null);
  const [searchStep, setSearchStep] = useState(0);
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Progress steps for search animation
  const SEARCH_STEPS = useMemo(() => [
    { label: "Connecting", detail: "Initializing search...", durationMs: 4000 },
    { label: "Searching portals", detail: "UN, government & NGO procurement portals", durationMs: 20000 },
    { label: "Expanding search", detail: "Development banks, aggregators & corporate RFPs", durationMs: 20000 },
    { label: "Analyzing results", detail: "Filtering and scoring opportunities", durationMs: 15000 },
    { label: "Verifying links", detail: "Checking source URLs and portal availability", durationMs: 15000 },
    { label: "Finishing up", detail: "Preparing results...", durationMs: 30000 },
  ], []);

  // Animate progress steps during search
  useEffect(() => {
    if (searching) {
      setSearchStep(0);
      let elapsed = 0;
      searchTimerRef.current = setInterval(() => {
        elapsed += 1000;
        let cumulative = 0;
        for (let i = 0; i < SEARCH_STEPS.length; i++) {
          cumulative += SEARCH_STEPS[i].durationMs;
          if (elapsed < cumulative) {
            setSearchStep(i);
            return;
          }
        }
        setSearchStep(SEARCH_STEPS.length - 1);
      }, 1000);
    } else {
      if (searchTimerRef.current) {
        clearInterval(searchTimerRef.current);
        searchTimerRef.current = null;
      }
    }
    return () => {
      if (searchTimerRef.current) clearInterval(searchTimerRef.current);
    };
  }, [searching, SEARCH_STEPS]);

  // Fetch pipeline data + load latest saved search on mount
  useEffect(() => {
    if (!workspaceId) return;
    (async () => {
      try {
        const [oppRes, respRes, searchRes] = await Promise.all([
          fetch(`/api/rfp/opportunities?workspaceId=${workspaceId}`),
          fetch(`/api/rfp/responses?workspaceId=${workspaceId}`),
          fetch(`/api/rfp/searches?workspaceId=${workspaceId}&limit=1`),
        ]);
        const oppData = await oppRes.json();
        const respData = await respRes.json();
        const searchData = await searchRes.json();

        const responseByOpp = new Map<string, string>();
        for (const r of respData.responses || []) {
          if (r.id_opportunity) responseByOpp.set(r.id_opportunity, r.type_status);
        }

        const map = new Map<string, SavedOppInfo>();
        for (const opp of oppData.opportunities || []) {
          const key = opp.title.toLowerCase().trim();
          map.set(key, {
            oppId: opp.id_opportunity,
            status: opp.type_status,
            responseStatus: responseByOpp.get(opp.id_opportunity),
          });
          // Also index by source URL for more reliable matching
          if (opp.url_source) {
            map.set(opp.url_source, {
              oppId: opp.id_opportunity,
              status: opp.type_status,
              responseStatus: responseByOpp.get(opp.id_opportunity),
            });
          }
        }
        setSavedOpps(map);

        // Load the latest saved search if we haven't searched yet
        const savedSearches = searchData.searches || [];
        if (savedSearches.length > 0 && !hasSearched) {
          const latest = savedSearches[0];
          setResults(latest.results || []);
          setSearchSummary(latest.document_summary || "");
          setQuery(latest.query || "");
          setHasSearched(true);
          setSearchMeta({
            userName: latest.name_user_created || "Unknown",
            date: latest.date_created,
            provider: latest.type_provider || "anthropic",
            resultCount: latest.units_result_count || (latest.results?.length ?? 0),
            query: latest.query || null,
          });
        }
      } catch (err) {
        console.error("Failed to fetch pipeline data for discover:", err);
      }
    })();
  }, [workspaceId, setSavedOpps]);

  // Helper to find matching saved opp for a discovery result
  const getMatchedOpp = useCallback((rfp: DiscoveredRfp): SavedOppInfo | undefined => {
    // Try URL match first (more reliable)
    if (rfp.sourceUrl) {
      const urlMatch = savedOpps.get(rfp.sourceUrl);
      if (urlMatch) return urlMatch;
    }
    // Fall back to title match
    const titleMatch = savedOpps.get(rfp.title.toLowerCase().trim());
    if (titleMatch) return titleMatch;
    // Try partial title match (AI may slightly rephrase titles across sessions)
    const rfpTitleLower = rfp.title.toLowerCase().trim();
    const entries = Array.from(savedOpps.entries());
    for (let ei = 0; ei < entries.length; ei++) {
      const [key, val] = entries[ei];
      if (key.length > 10 && !key.startsWith("http") && (
        rfpTitleLower.includes(key) || key.includes(rfpTitleLower)
      )) {
        return val;
      }
    }
    return undefined;
  }, [savedOpps]);

  useEffect(() => {
    if (workspaceId) {
      setSearchConfig(getStoredSearchConfig(workspaceId));
    }
  }, [workspaceId]);

  const updateConfig = (update: Partial<SearchConfig>) => {
    const newConfig = { ...searchConfig, ...update };
    setSearchConfig(newConfig);
    if (workspaceId) saveSearchConfig(workspaceId, newConfig);
  };

  const handleSearch = async () => {
    if (!workspaceId) return;
    setSearching(true);
    setResults([]);
    setSearchSummary("");

    const combinedQuery = [query, ...searchConfig.keywords].filter(Boolean).join(" ");

    try {
      const res = await fetch("/api/rfp/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          query: combinedQuery || undefined,
          provider,
          sources: searchConfig.sources.length > 0 ? searchConfig.sources : undefined,
          sectors: searchConfig.sectors.length > 0 ? searchConfig.sectors : undefined,
          regions: searchConfig.regions.length > 0 ? searchConfig.regions : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Search failed (${res.status})`);
      }
      const opps = data.opportunities || [];
      const summary = data.searchSummary || "";
      setResults(opps);
      setSearchSummary(summary);
      setHasSearched(true);

      // Save search results to database for sharing across users
      try {
        const saveRes = await fetch("/api/rfp/searches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            query: combinedQuery || null,
            config: {
              sources: searchConfig.sources,
              sectors: searchConfig.sectors,
              regions: searchConfig.regions,
              keywords: searchConfig.keywords,
            },
            provider,
            results: opps,
            summary,
          }),
        });
        if (saveRes.ok) {
          const saved = await saveRes.json();
          setSearchMeta({
            userName: saved.search?.name_user_created || "You",
            date: saved.search?.date_created || new Date().toISOString(),
            provider,
            resultCount: opps.length,
            query: combinedQuery || null,
          });
          toast.success("Search results saved");
        }
      } catch (saveErr) {
        console.error("Failed to save search results:", saveErr);
      }
    } catch (err: any) {
      console.error("Discovery search failed:", err);
      const msg = err?.message || "Unknown error";
      setSearchSummary(`Search failed: ${msg}`);
      setHasSearched(true);
      toast.error(`Search failed: ${msg}`);
    } finally {
      setSearching(false);
    }
  };

  const handleSave = async (rfp: DiscoveredRfp): Promise<boolean> => {
    if (!workspaceId) return false;
    setSaving(rfp.title);

    try {
      // Normalise milestone dates to ISO for the DB
      const normMilestones = (rfp.milestones || []).map((m) => ({
        ...m,
        date: toISODate(m.date) || m.date,
      }));

      const res = await fetch("/api/rfp/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          title: rfp.title,
          organisationName: rfp.organisation,
          deadline: toISODate(rfp.deadline),
          milestones: normMilestones,
          scope: rfp.scope,
          sectors: rfp.sectors,
          region: rfp.region,
          estimatedValue: rfp.estimatedValue,
          sourceUrl: rfp.sourceUrl,
          relevanceScore: rfp.relevanceScore,
          aiReasoning: rfp.reasoning,
          urlConfidence: rfp.urlConfidence || null,
          portalName: rfp.portalName || null,
          portalSearchUrl: rfp.portalSearchUrl || null,
          status: "shortlisted",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const oppId = data.opportunity?.id_opportunity;
        setSavedOpps((prev) => {
          const next = new Map(prev);
          next.set(rfp.title.toLowerCase().trim(), { oppId, status: "shortlisted" });
          if (rfp.sourceUrl) next.set(rfp.sourceUrl, { oppId, status: "shortlisted" });
          return next;
        });
        toast.success("RFP saved to Pipeline", {
          action: {
            label: "View Pipeline",
            onClick: () => onSaved?.(),
          },
        });
        return true;
      } else {
        const errData = await res.json().catch(() => ({ error: "Unknown error" }));
        console.error("Save failed:", res.status, errData);
        toast.error(`Failed to save: ${errData.error || res.statusText}`);
        return false;
      }
    } catch (err) {
      console.error("Save failed:", err);
      toast.error("Failed to save RFP");
      return false;
    } finally {
      setSaving(null);
    }
  };

  const handleIgnore = async (rfp: DiscoveredRfp) => {
    if (!workspaceId) return;
    setSaving(rfp.title);

    try {
      const res = await fetch("/api/rfp/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          title: rfp.title,
          organisationName: rfp.organisation,
          deadline: rfp.deadline,
          milestones: rfp.milestones || [],
          scope: rfp.scope,
          sectors: rfp.sectors,
          region: rfp.region,
          estimatedValue: rfp.estimatedValue,
          sourceUrl: rfp.sourceUrl,
          relevanceScore: rfp.relevanceScore,
          aiReasoning: rfp.reasoning,
          urlConfidence: rfp.urlConfidence || null,
          portalName: rfp.portalName || null,
          portalSearchUrl: rfp.portalSearchUrl || null,
          status: "ignored",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const oppId = data.opportunity?.id_opportunity;
        setSavedOpps((prev) => {
          const next = new Map(prev);
          next.set(rfp.title.toLowerCase().trim(), { oppId, status: "ignored" });
          if (rfp.sourceUrl) next.set(rfp.sourceUrl, { oppId, status: "ignored" });
          return next;
        });
        toast("RFP ignored");
      }
    } catch (err) {
      console.error("Ignore failed:", err);
      toast.error("Failed to ignore RFP");
    } finally {
      setSaving(null);
    }
  };

  const handleUndoIgnore = async (rfp: DiscoveredRfp) => {
    const matched = getMatchedOpp(rfp);
    if (!matched) return;

    try {
      await fetch(`/api/rfp/opportunities/${matched.oppId}`, { method: "DELETE" });
      setSavedOpps((prev) => {
        const next = new Map(prev);
        next.delete(rfp.title.toLowerCase().trim());
        if (rfp.sourceUrl) next.delete(rfp.sourceUrl);
        return next;
      });
      toast("RFP unignored");
    } catch (err) {
      console.error("Undo ignore failed:", err);
    }
  };

  if (!workspaceId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Select a workspace to discover RFPs
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      {/* Search controls */}
      <div className="max-w-2xl mx-auto mb-6">
        <div className="flex gap-2 mb-3">
          <Input
            placeholder="Optional: add specific search terms (e.g. 'climate communications Africa')"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !searching && handleSearch()}
            className="flex-1"
          />
          <Button onClick={handleSearch} disabled={searching} className="gap-2">
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {searching ? "Searching..." : "Search"}
          </Button>
        </div>

        {/* Provider selector */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Search with:</span>
          <div className="flex gap-1 bg-muted/50 rounded-lg p-0.5">
            <button
              onClick={() => setProvider("anthropic")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                provider === "anthropic"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Sparkles className="h-3 w-3" />
              Claude
            </button>
            <button
              onClick={() => setProvider("grok")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                provider === "grok"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Cpu className="h-3 w-3" />
              Grok
            </button>
          </div>
        </div>

        {/* Search Settings */}
        <div className="mt-3">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Settings className="h-3 w-3" />
            Search Settings
            {showSettings ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {(searchConfig.sectors.length > 0 ||
              searchConfig.regions.length > 0 ||
              searchConfig.keywords.length > 0 ||
              searchConfig.sources.length !== DEFAULT_SOURCES.length) && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 ml-1">
                Customised
              </Badge>
            )}
          </button>

          {showSettings && (
            <div className="mt-3 border rounded-lg p-4 space-y-4 bg-muted/20">
              {/* Sources */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Procurement Portals
                </h4>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {searchConfig.sources.map((source) => (
                    <Badge key={source} variant="secondary" className="text-xs gap-1 pr-1">
                      {source}
                      <button
                        onClick={() =>
                          updateConfig({
                            sources: searchConfig.sources.filter((s) => s !== source),
                          })
                        }
                        className="ml-0.5 hover:text-destructive"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                  {searchConfig.sources.length === 0 && (
                    <span className="text-xs text-muted-foreground italic">
                      No sources — will search broadly
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <Input
                    placeholder="Add custom source..."
                    value={newSource}
                    onChange={(e) => setNewSource(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newSource.trim()) {
                        updateConfig({
                          sources: [...searchConfig.sources, newSource.trim()],
                        });
                        setNewSource("");
                      }
                    }}
                    className="text-xs h-7 flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs px-2"
                    disabled={!newSource.trim()}
                    onClick={() => {
                      updateConfig({
                        sources: [...searchConfig.sources, newSource.trim()],
                      });
                      setNewSource("");
                    }}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* Keywords */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Keywords
                </h4>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {searchConfig.keywords.map((keyword) => (
                    <Badge key={keyword} variant="outline" className="text-xs gap-1 pr-1">
                      {keyword}
                      <button
                        onClick={() =>
                          updateConfig({
                            keywords: searchConfig.keywords.filter((k) => k !== keyword),
                          })
                        }
                        className="ml-0.5 hover:text-destructive"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                  {searchConfig.keywords.length === 0 && (
                    <span className="text-xs text-muted-foreground italic">
                      No keywords added — uses company profile defaults
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <Input
                    placeholder="Add keyword..."
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newKeyword.trim()) {
                        updateConfig({
                          keywords: [...searchConfig.keywords, newKeyword.trim()],
                        });
                        setNewKeyword("");
                      }
                    }}
                    className="text-xs h-7 flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs px-2"
                    disabled={!newKeyword.trim()}
                    onClick={() => {
                      updateConfig({
                        keywords: [...searchConfig.keywords, newKeyword.trim()],
                      });
                      setNewKeyword("");
                    }}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* Sectors */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Sectors
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {DEFAULT_SECTORS.map((sector) => {
                    const isSelected = searchConfig.sectors.includes(sector);
                    return (
                      <button
                        key={sector}
                        onClick={() =>
                          updateConfig({
                            sectors: isSelected
                              ? searchConfig.sectors.filter((s) => s !== sector)
                              : [...searchConfig.sectors, sector],
                          })
                        }
                        className={cn(
                          "text-xs px-2.5 py-1 rounded-full border transition-colors",
                          isSelected
                            ? "bg-cyan-50 border-cyan-300 text-cyan-700 dark:bg-cyan-900/20 dark:border-cyan-700 dark:text-cyan-300"
                            : "border-muted-foreground/20 text-muted-foreground hover:border-muted-foreground/40"
                        )}
                      >
                        {sector}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Select sectors to narrow your search. Leave empty to search all.
                </p>
              </div>

              {/* Regions */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Regions
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {DEFAULT_REGIONS.map((region) => {
                    const isSelected = searchConfig.regions.includes(region);
                    return (
                      <button
                        key={region}
                        onClick={() =>
                          updateConfig({
                            regions: isSelected
                              ? searchConfig.regions.filter((r) => r !== region)
                              : [...searchConfig.regions, region],
                          })
                        }
                        className={cn(
                          "text-xs px-2.5 py-1 rounded-full border transition-colors",
                          isSelected
                            ? "bg-cyan-50 border-cyan-300 text-cyan-700 dark:bg-cyan-900/20 dark:border-cyan-700 dark:text-cyan-300"
                            : "border-muted-foreground/20 text-muted-foreground hover:border-muted-foreground/40"
                        )}
                      >
                        {region}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Reset */}
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() =>
                  updateConfig({
                    sources: [...DEFAULT_SOURCES],
                    keywords: [],
                    sectors: [],
                    regions: [],
                  })
                }
              >
                Reset to Defaults
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Saved Searches */}
      <div className="max-w-2xl mx-auto mb-4">
        <SavedSearchesPanel
          workspaceId={workspaceId!}
          currentConfig={searchConfig}
          currentQuery={query}
          currentProvider={provider}
          onLoadSearch={(config, q, p) => {
            setSearchConfig(config);
            if (workspaceId) saveSearchConfig(workspaceId, config);
            setQuery(q);
            setProvider(p);
          }}
          onRunResult={(opps, summary) => {
            setResults(opps);
            setSearchSummary(summary);
            setHasSearched(true);
            setSearchMeta(null);
          }}
        />
      </div>

      {/* Search progress */}
      {searching && (
        <div className="flex flex-col items-center py-12 max-w-sm mx-auto">
          <div className="w-full h-1 bg-muted rounded-full mb-8 overflow-hidden">
            <div
              className="h-full bg-cyan-500 rounded-full transition-all duration-1000 ease-out"
              style={{ width: `${Math.min(((searchStep + 1) / SEARCH_STEPS.length) * 100, 95)}%` }}
            />
          </div>
          <div className="space-y-3 w-full">
            {SEARCH_STEPS.map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                {i < searchStep ? (
                  <CheckCircle2 className="h-4 w-4 text-cyan-500 shrink-0" />
                ) : i === searchStep ? (
                  <Loader2 className="h-4 w-4 text-cyan-500 animate-spin shrink-0" />
                ) : (
                  <div className="h-4 w-4 rounded-full border border-muted-foreground/20 shrink-0" />
                )}
                <div className={cn(
                  "text-sm",
                  i < searchStep ? "text-muted-foreground" :
                  i === searchStep ? "text-foreground font-medium" :
                  "text-muted-foreground/40"
                )}>
                  {step.label}
                  {i === searchStep && (
                    <span className="block text-xs text-muted-foreground font-normal mt-0.5">
                      {step.detail}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-8">Typically takes 1–2 minutes</p>
        </div>
      )}

      {/* Results */}
      {!searching && hasSearched && (
        <>
          {/* Compact metadata line */}
          {searchMeta && (
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-4 max-w-3xl mx-auto px-1">
              <span>
                {searchMeta.resultCount} result{searchMeta.resultCount !== 1 ? "s" : ""}
                {" · "}
                {searchMeta.provider === "anthropic" ? "Claude" : "Grok"}
                {" · "}
                {formatRelativeTime(searchMeta.date)}
              </span>
              <button
                onClick={() => {
                  setResults([]);
                  setSearchSummary("");
                  setHasSearched(false);
                  setSearchMeta(null);
                  setQuery("");
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                New search
              </button>
            </div>
          )}

          {results.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No matching RFPs found. Try different search terms or the other search provider.
            </div>
          ) : (
            <div className="space-y-2 max-w-3xl mx-auto">
              {results.map((rfp, i) => {
                const matched = getMatchedOpp(rfp);
                const isIgnored = matched?.status === "ignored";
                const urgency = getDeadlineUrgency(rfp.deadline);
                return (
                <button
                  key={i}
                  onClick={() => setSelectedRfp(rfp)}
                  className={cn(
                    "border rounded-lg p-4 transition-colors w-full text-left",
                    isIgnored ? "opacity-40" : "hover:border-foreground/20 hover:bg-muted/30"
                  )}
                >
                  {/* Row 1: Title + Score */}
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-sm leading-snug">{rfp.title}</h3>
                      <span className="text-xs text-muted-foreground">{rfp.organisation}</span>
                    </div>
                    <div className={cn(
                      "h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0",
                      scoreColor(rfp.relevanceScore)
                    )}>
                      {rfp.relevanceScore}
                    </div>
                  </div>

                  {/* Row 2: Key details */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mb-2">
                    {/* Deadline */}
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {rfp.deadline ? (
                        <>
                          {formatDeadline(rfp.deadline)}
                          {urgency && (
                            <span className={cn(
                              "text-[10px] font-medium ml-0.5",
                              urgency.className.split(" ")[0]
                            )}>
                              ({urgency.label})
                            </span>
                          )}
                        </>
                      ) : rfp.milestones.length > 0 ? (
                        <>
                          {rfp.milestones[0].label}: {formatDeadline(rfp.milestones[0].date)}
                        </>
                      ) : (
                        <span className="italic">Deadline TBD</span>
                      )}
                    </span>
                    {/* Show first milestone alongside deadline if both exist */}
                    {rfp.deadline && rfp.milestones.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground/70">
                        {rfp.milestones[0].label}: {formatDeadline(rfp.milestones[0].date)}
                      </span>
                    )}
                    {rfp.estimatedValue && (
                      <span className="inline-flex items-center gap-1 font-medium text-foreground/70">
                        {rfp.estimatedValue}
                      </span>
                    )}
                    {rfp.region && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {rfp.region}
                      </span>
                    )}
                  </div>

                  {/* Row 3: Scope (truncated) */}
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    {rfp.scope}
                  </p>

                  {/* Row 4: Source + status */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {rfp.sourceUrl ? (
                        <span
                          role="link"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); window.open(rfp.sourceUrl!, "_blank", "noopener"); }}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); window.open(rfp.sourceUrl!, "_blank", "noopener"); } }}
                          className={cn(
                            "inline-flex items-center gap-1 text-xs cursor-pointer hover:underline",
                            rfp.urlConfidence === "verified"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : rfp.urlConfidence === "trusted_domain"
                              ? "text-cyan-600 dark:text-cyan-400"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <ExternalLink className="h-3 w-3" />
                          {rfp.portalName || extractDomain(rfp.sourceUrl) || "View Source"}
                        </span>
                      ) : rfp.portalSearchUrl ? (
                        <span
                          role="link"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); window.open(rfp.portalSearchUrl!, "_blank", "noopener"); }}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); window.open(rfp.portalSearchUrl!, "_blank", "noopener"); } }}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground cursor-pointer hover:underline hover:text-foreground"
                        >
                          <Search className="h-3 w-3" />
                          {rfp.portalName || "Search Portal"}
                        </span>
                      ) : null}
                      {rfp.sectors.length > 0 && (
                        <span className="text-[11px] text-muted-foreground/60">
                          {rfp.sectors.slice(0, 2).join(" · ")}
                        </span>
                      )}
                    </div>
                    {matched && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <FolderKanban className="h-3 w-3" />
                        {matched.status === "submitted" ? "Submitted" :
                         matched.responseStatus ? getResponseStage(matched.responseStatus).label :
                         "In Pipeline"}
                      </span>
                    )}
                  </div>
                </button>
                );
              })}
            </div>
          )}

          {/* RFP Detail Modal */}
          <Dialog open={!!selectedRfp} onOpenChange={(open) => !open && setSelectedRfp(null)}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              {selectedRfp && (() => {
                const rfp = selectedRfp;
                const matched = getMatchedOpp(rfp);
                const isIgnored = matched?.status === "ignored";
                const urgency = getDeadlineUrgency(rfp.deadline);
                return (
                  <>
                    <DialogHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <DialogTitle className="text-base leading-snug mb-1">{rfp.title}</DialogTitle>
                          <p className="text-sm text-muted-foreground">{rfp.organisation}</p>
                        </div>
                        <div className={cn(
                          "h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                          scoreColor(rfp.relevanceScore)
                        )}>
                          {rfp.relevanceScore}
                        </div>
                      </div>
                    </DialogHeader>

                    <div className="space-y-5 mt-2">
                      {/* Key details grid */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-0.5">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Deadline</p>
                          <p className="text-sm font-medium flex items-center gap-1.5">
                            {rfp.deadline ? (
                              <>
                                {formatDeadline(rfp.deadline)}
                                {urgency && (
                                  <span className={cn(
                                    "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                                    urgency.className
                                  )}>
                                    {urgency.label}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-muted-foreground italic font-normal">TBD</span>
                            )}
                          </p>
                        </div>
                        {rfp.estimatedValue && (
                          <div className="space-y-0.5">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Estimated Budget</p>
                            <p className="text-sm font-medium">{rfp.estimatedValue}</p>
                          </div>
                        )}
                        {rfp.region && (
                          <div className="space-y-0.5">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Region</p>
                            <p className="text-sm">{rfp.region}</p>
                          </div>
                        )}
                        {rfp.sectors.length > 0 && (
                          <div className="space-y-0.5">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Sectors</p>
                            <p className="text-sm">{rfp.sectors.join(", ")}</p>
                          </div>
                        )}
                      </div>

                      {/* Milestones */}
                      {rfp.milestones.length > 0 && (
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Key Dates</p>
                          <div className="space-y-1.5">
                            {rfp.milestones.map((m, mi) => {
                              const mUrgency = getDeadlineUrgency(m.date);
                              return (
                                <div key={mi} className="flex items-center justify-between text-sm">
                                  <span className="text-muted-foreground">{m.label}</span>
                                  <span className="font-medium flex items-center gap-1.5">
                                    {formatDeadline(m.date)}
                                    {mUrgency && (
                                      <span className={cn("text-[10px]", mUrgency.className.split(" ")[0])}>
                                        ({mUrgency.label})
                                      </span>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Scope */}
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Scope</p>
                        <p className="text-sm text-muted-foreground leading-relaxed">{rfp.scope}</p>
                      </div>

                      {/* AI Reasoning */}
                      {rfp.reasoning && (
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Why This Matches</p>
                          <p className="text-sm text-muted-foreground leading-relaxed italic">{rfp.reasoning}</p>
                        </div>
                      )}

                      {/* Source link */}
                      {rfp.sourceUrl ? (
                        <a
                          href={rfp.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className={cn(
                            "inline-flex items-center gap-1.5 text-sm transition-colors",
                            rfp.urlConfidence === "verified"
                              ? "text-emerald-600 dark:text-emerald-400 hover:text-emerald-700"
                              : rfp.urlConfidence === "trusted_domain"
                              ? "text-cyan-600 dark:text-cyan-400 hover:text-cyan-700"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          {rfp.urlConfidence === "verified" ? "View RFP (verified)" :
                           rfp.urlConfidence === "trusted_domain" ? `View on ${rfp.portalName || "portal"}` :
                           "View source (unverified)"}
                        </a>
                      ) : rfp.portalSearchUrl ? (
                        <a
                          href={rfp.portalSearchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Search className="h-3.5 w-3.5" />
                          Search on {rfp.portalName || "portal"}
                        </a>
                      ) : null}

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 pt-2 border-t">
                        {isIgnored ? (
                          <Button
                            variant="outline"
                            onClick={async () => { await handleUndoIgnore(rfp); setSelectedRfp(null); }}
                            className="gap-1.5"
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                            Undo Ignore
                          </Button>
                        ) : matched ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                              <FolderKanban className="h-4 w-4" />
                              {matched.status === "submitted" ? "Submitted" :
                               matched.responseStatus ? getResponseStage(matched.responseStatus).label :
                               "In Pipeline"}
                            </span>
                          </div>
                        ) : (
                          <>
                            <Button
                              disabled={saving === rfp.title}
                              onClick={async () => {
                                const ok = await handleSave(rfp);
                                if (ok) setSelectedRfp(null);
                              }}
                              className="gap-1.5"
                            >
                              {saving === rfp.title ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Bookmark className="h-3.5 w-3.5" />
                              )}
                              {saving === rfp.title ? "Saving…" : "Save to Pipeline"}
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={saving === rfp.title}
                              onClick={async () => {
                                await handleIgnore(rfp);
                                setSelectedRfp(null);
                              }}
                              className="gap-1.5 text-muted-foreground"
                            >
                              <EyeOff className="h-3.5 w-3.5" />
                              Ignore
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* Initial empty state */}
      {!searching && !hasSearched && (
        <div className="flex flex-col items-center py-20">
          <Search className="h-6 w-6 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            Search for open procurement opportunities
          </p>
        </div>
      )}
    </div>
  );
}
