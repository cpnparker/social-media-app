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
  LayoutDashboard,
  TrendingUp,
  Activity,
  CircleDot,
  History,
  AlertTriangle,
  ShieldCheck,
  List,
  ArrowUpDown,
  SortAsc,
  SortDesc,
  RotateCcw,
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

type Tab = "overview" | "discover" | "all_rfps" | "library" | "pipeline";

const tabs: { id: Tab; label: string; shortLabel: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", label: "Overview", shortLabel: "Overview", icon: LayoutDashboard },
  { id: "discover", label: "Discover RFPs", shortLabel: "Discover", icon: Globe },
  { id: "all_rfps", label: "All RFPs", shortLabel: "All RFPs", icon: List },
  { id: "library", label: "Company Profile", shortLabel: "Profile", icon: FileText },
  { id: "pipeline", label: "Pipeline", shortLabel: "Pipeline", icon: FolderKanban },
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

type UrlConfidence = "verified" | "trusted_domain" | "unverified" | "portal_page" | "failed" | "none";
type RfpStatus = "confirmed_open" | "likely_open" | "likely_closed" | "unknown";

interface DiscoveredRfp {
  title: string;
  organisation: string;
  deadline: string | null;
  milestones: DeadlineMilestone[];
  scope: string;
  relevanceScore: number;
  qualityScore?: number;
  sourceUrl: string | null;
  reasoning: string;
  sectors: string[];
  region: string | null;
  estimatedValue: string | null;
  status?: RfpStatus;
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

/** Shorten a URL for display: "ungm.org/Public/Notice/123456" */
function truncateUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/$/, "");
    const full = host + path;
    return full.length > 60 ? full.slice(0, 57) + "…" : full;
  } catch {
    return url.length > 60 ? url.slice(0, 57) + "…" : url;
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
  const allTabIds = tabs.map((t) => t.id);
  const [activeTab, setActiveTab] = useState<Tab>(
    tabParam && allTabIds.includes(tabParam) ? tabParam : "overview"
  );
  const wsCtx = useWorkspaceSafe();
  const workspaceId = wsCtx?.selectedWorkspace?.id;

  // Sync tab with URL param changes
  useEffect(() => {
    if (tabParam && allTabIds.includes(tabParam)) {
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
  // Signal to auto-expand saved searches panel when navigating from overview
  const [expandSavedSearches, setExpandSavedSearches] = useState(false);

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

  // Auto-open search from URL param (for shareable links)
  const searchIdParam = searchParams.get("search");
  useEffect(() => {
    if (searchIdParam) {
      setActiveTab("discover");
    }
  }, [searchIdParam]);

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
            userRole={wsCtx?.selectedWorkspace?.role}
            onManageScans={() => { setExpandSavedSearches(true); setActiveTab("discover"); }}
          />

          {/* Tab bar */}
          <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    const url = new URL(window.location.href);
                    url.searchParams.set("tab", tab.id);
                    url.searchParams.delete("subtab");
                    window.history.replaceState({}, "", url.toString());
                  }}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-2 sm:px-4 sm:gap-2 rounded-md text-xs sm:text-sm font-medium transition-colors flex-1 justify-center",
                    activeTab === tab.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.shortLabel}</span>
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
            {activeTab === "overview" && (
              <OverviewDashboard
                workspaceId={workspaceId}
                onNavigate={(tab: Tab) => setActiveTab(tab)}
                onOpenEditor={handleOpenEditor}
                onOpenNotifications={() => setShowNotifications(true)}
                onManageScans={() => { setExpandSavedSearches(true); setActiveTab("discover"); }}
              />
            )}
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
                initialSearchId={searchIdParam}
                expandSavedSearches={expandSavedSearches}
                onSavedSearchesExpanded={() => setExpandSavedSearches(false)}
              />
            )}
            {activeTab === "all_rfps" && (
              <AllRfpsView
                workspaceId={workspaceId}
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
   Overview Dashboard
   ──────────────────────────────────────────────── */

interface DashboardStats {
  pipeline: {
    counts: Record<string, number>;
    totalActive: number;
    totalAll: number;
    estimatedValue: number;
  };
  upcomingDeadlines: {
    id: string;
    title: string;
    organisation: string;
    deadline: string;
    status: string;
    value: string | null;
  }[];
  recentOpportunities: {
    id: string;
    title: string;
    organisation: string;
    deadline: string | null;
    status: string;
    value: string | null;
    score: number | null;
    dateAdded: string;
    sourceUrl: string | null;
  }[];
  responses: {
    active: { id: string; title: string; status: string; assignedTo: string | null; totalSections: number; completedSections: number; lastUpdated: string }[];
    total: number;
    items: { id: string; title: string; status: string; opportunityId: string | null; assignedTo: string | null; totalSections: number; completedSections: number; lastUpdated: string }[];
  };
  searches: {
    recent: { id_search: string; query: string; type_provider: string; units_result_count: number; name_user_created: string; date_created: string }[];
    totalCount: number;
    savedSearches: { id: string; name: string; scheduled: boolean; schedule: string | null; lastRun: string | null; nextRun: string | null }[];
  };
}

const PIPELINE_LABELS: Record<string, { label: string; color: string }> = {
  discovered: { label: "Discovered", color: "bg-blue-500" },
  shortlisted: { label: "Shortlisted", color: "bg-cyan-500" },
  in_progress: { label: "In Progress", color: "bg-amber-500" },
  submitted: { label: "Submitted", color: "bg-emerald-500" },
  won: { label: "Won", color: "bg-green-600" },
  archived: { label: "Archived", color: "bg-muted-foreground/30" },
  ignored: { label: "Ignored", color: "bg-muted-foreground/20" },
};

const RESPONSE_STAGE_LABELS: Record<string, string> = {
  drafting: "Drafting",
  internal_review: "Internal Review",
  revision: "Revision",
  final_review: "Final Review",
  ready_to_submit: "Ready to Submit",
};

function OverviewDashboard({
  workspaceId,
  onNavigate,
  onOpenEditor,
  onOpenNotifications,
  onManageScans,
}: {
  workspaceId?: string;
  onNavigate: (tab: Tab) => void;
  onOpenEditor: (responseId: string, opportunity: RfpOpportunity | null) => void;
  onOpenNotifications: () => void;
  onManageScans: () => void;
}) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    fetch(`/api/rfp/stats?workspaceId=${workspaceId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setStats(data);
      })
      .catch((err) => console.error("Failed to load stats:", err))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  if (!workspaceId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm py-20">
        Select a workspace to view your RFP dashboard
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        Failed to load dashboard data
      </div>
    );
  }

  const { pipeline, upcomingDeadlines, recentOpportunities, responses, searches } = stats;
  const activeStages = ["discovered", "shortlisted", "in_progress", "submitted"];
  const totalFunnel = activeStages.reduce((s, k) => s + (pipeline.counts[k] || 0), 0);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      {/* Pipeline Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {activeStages.map((stage) => {
          const info = PIPELINE_LABELS[stage];
          const count = pipeline.counts[stage] || 0;
          return (
            <button
              key={stage}
              onClick={() => onNavigate("pipeline")}
              className="border rounded-lg p-3 sm:p-4 text-left hover:border-foreground/20 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={cn("h-2 w-2 rounded-full", info.color)} />
                <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{info.label}</span>
              </div>
              <p className="text-2xl font-bold">{count}</p>
            </button>
          );
        })}
      </div>

      {/* Metrics Bar */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-cyan-500" />
          <span className="text-muted-foreground">Active pipeline:</span>
          <span className="font-semibold">{pipeline.totalActive} opportunities</span>
        </div>
        {pipeline.estimatedValue > 0 && (
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-emerald-500" />
            <span className="text-muted-foreground">Est. value:</span>
            <span className="font-semibold">
              {pipeline.estimatedValue >= 1000000
                ? `$${(pipeline.estimatedValue / 1000000).toFixed(1)}M`
                : pipeline.estimatedValue >= 1000
                ? `$${(pipeline.estimatedValue / 1000).toFixed(0)}K`
                : `$${pipeline.estimatedValue.toLocaleString()}`}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-amber-500" />
          <span className="text-muted-foreground">Responses:</span>
          <span className="font-semibold">{responses.total} total</span>
        </div>
      </div>

      {/* Pipeline Funnel Bar */}
      {totalFunnel > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Pipeline Funnel</span>
            <button onClick={() => onNavigate("pipeline")} className="hover:text-foreground transition-colors">
              View Pipeline →
            </button>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-muted">
            {activeStages.map((stage) => {
              const count = pipeline.counts[stage] || 0;
              if (count === 0) return null;
              const pct = (count / totalFunnel) * 100;
              return (
                <div
                  key={stage}
                  className={cn("transition-all", PIPELINE_LABELS[stage].color)}
                  style={{ width: `${pct}%` }}
                  title={`${PIPELINE_LABELS[stage].label}: ${count}`}
                />
              );
            })}
          </div>
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
            {activeStages.map((stage) => {
              const count = pipeline.counts[stage] || 0;
              if (count === 0) return null;
              return (
                <div key={stage} className="flex items-center gap-1">
                  <div className={cn("h-1.5 w-1.5 rounded-full", PIPELINE_LABELS[stage].color)} />
                  <span>{PIPELINE_LABELS[stage].label} ({count})</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Deadlines */}
        <div className="border rounded-lg">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4 text-red-500" />
              Upcoming Deadlines
            </h3>
            <button onClick={() => onNavigate("pipeline")} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              View all →
            </button>
          </div>
          <div className="divide-y">
            {upcomingDeadlines.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No upcoming deadlines in the next 30 days
              </div>
            ) : (
              upcomingDeadlines.map((opp) => {
                const urgency = getDeadlineUrgency(opp.deadline);
                return (
                  <div key={opp.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{opp.title}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{opp.organisation}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium">{formatDeadline(opp.deadline)}</p>
                      {urgency && (
                        <span className={cn("text-[10px] font-medium", urgency.className.split(" ")[0])}>
                          {urgency.label}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Active Responses */}
        <div className="border rounded-lg">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <PenTool className="h-4 w-4 text-cyan-500" />
              Active Responses
            </h3>
            <button onClick={() => onNavigate("pipeline")} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              View all →
            </button>
          </div>
          <div className="divide-y">
            {responses.items.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No responses started yet.{" "}
                <button onClick={() => onNavigate("discover")} className="text-cyan-500 hover:underline">
                  Discover RFPs
                </button>{" "}
                to begin.
              </div>
            ) : (
              responses.items.map((r) => {
                const pct = r.totalSections > 0 ? Math.round((r.completedSections / r.totalSections) * 100) : 0;
                return (
                  <button
                    key={r.id}
                    onClick={() => onOpenEditor(r.id, null)}
                    className="px-4 py-2.5 flex items-center gap-3 w-full text-left hover:bg-muted/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{r.title}</p>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{RESPONSE_STAGE_LABELS[r.status] || r.status}</span>
                        {r.assignedTo && (
                          <>
                            <span>·</span>
                            <span>{r.assignedTo}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-cyan-500 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-7 text-right">{pct}%</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Recent Opportunities */}
        <div className="border rounded-lg">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4 text-blue-500" />
              Recently Added
            </h3>
            <button onClick={() => onNavigate("pipeline")} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              View all →
            </button>
          </div>
          <div className="divide-y">
            {recentOpportunities.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No opportunities yet.{" "}
                <button onClick={() => onNavigate("discover")} className="text-cyan-500 hover:underline">
                  Run a search
                </button>{" "}
                to discover RFPs.
              </div>
            ) : (
              recentOpportunities.map((opp) => (
                <div key={opp.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{opp.title}</p>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{opp.organisation}</span>
                      {opp.value && (
                        <>
                          <span>·</span>
                          <span className="font-medium text-foreground/70">{opp.value}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {opp.score && (
                      <div className={cn(
                        "h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold",
                        scoreColor(opp.score)
                      )}>
                        {opp.score}
                      </div>
                    )}
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                      {PIPELINE_LABELS[opp.status]?.label || opp.status}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Search Activity */}
        <div className="border rounded-lg">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <History className="h-4 w-4 text-purple-500" />
              Recent Searches
            </h3>
            <button onClick={() => onNavigate("discover")} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              New search →
            </button>
          </div>
          <div className="divide-y">
            {searches.recent.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No searches yet.{" "}
                <button onClick={() => onNavigate("discover")} className="text-cyan-500 hover:underline">
                  Discover RFPs
                </button>
              </div>
            ) : (
              searches.recent.slice(0, 5).map((s) => (
                <div key={s.id_search} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">
                      {s.query || <span className="italic text-muted-foreground">Default search</span>}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{s.name_user_created || "Unknown"}</span>
                      <span>·</span>
                      <span>{formatRelativeTime(s.date_created)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1">
                      {s.type_provider === "grok" ? <Cpu className="h-2.5 w-2.5" /> : <Sparkles className="h-2.5 w-2.5" />}
                      {s.units_result_count} results
                    </Badge>
                  </div>
                </div>
              ))
            )}
            {/* Saved searches summary */}
            {searches.savedSearches.length > 0 && (
              <div className="px-4 py-2.5 bg-muted/30">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <CircleDot className="h-3 w-3" />
                  <span>
                    {searches.savedSearches.filter((s) => s.scheduled).length} scheduled search{searches.savedSearches.filter((s) => s.scheduled).length !== 1 ? "es" : ""} active
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scheduled Scans & Notifications */}
      <div className="border rounded-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Bell className="h-4 w-4 text-amber-500" />
            Scans & Notifications
          </h3>
          <div className="flex items-center gap-3">
            <button onClick={onManageScans} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Manage Scans →
            </button>
            <button onClick={onOpenNotifications} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Notifications →
            </button>
          </div>
        </div>
        <div className="p-4 space-y-3">
          {/* Scheduled scans */}
          {searches.savedSearches.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Scheduled Scans</p>
                <button onClick={onManageScans} className="text-[11px] text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300 font-medium">
                  Edit schedules
                </button>
              </div>
              {searches.savedSearches.filter((s) => s.scheduled).length > 0 ? (
                searches.savedSearches.filter((s) => s.scheduled).map((s) => (
                  <button
                    key={s.id}
                    onClick={onManageScans}
                    className="flex items-center justify-between gap-2 text-xs bg-muted/30 rounded-lg px-3 py-2 w-full text-left hover:bg-muted/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{s.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {s.schedule === "daily" ? "Runs daily" : s.schedule === "weekly" ? "Runs weekly" : s.schedule || "Custom"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-[10px] text-muted-foreground">
                      {s.lastRun && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatRelativeTime(s.lastRun)}
                        </span>
                      )}
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800">
                        Active
                      </Badge>
                    </div>
                  </button>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">
                  No scheduled scans.{" "}
                  <button onClick={onManageScans} className="text-cyan-500 hover:underline">
                    Set up a scan schedule
                  </button>
                </p>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              <p>No saved searches yet.</p>
              <p className="mt-1">
                <button onClick={() => onNavigate("discover")} className="text-cyan-500 hover:underline">
                  Discover RFPs
                </button>{" "}
                and save your search to enable scheduled scans and notifications.
              </p>
            </div>
          )}

          {/* Notification summary */}
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Your Notifications</p>
              <button
                onClick={onOpenNotifications}
                className="text-[11px] text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300 font-medium"
              >
                Edit settings
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Configure how and when you receive alerts for new RFP opportunities. Admins can also manage team-wide notification preferences.
            </p>
          </div>
        </div>
      </div>

      {/* Quick empty state — if nothing at all */}
      {pipeline.totalAll === 0 && searches.recent.length === 0 && (
        <div className="border border-dashed rounded-lg p-8 text-center">
          <Globe className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
          <h3 className="font-medium mb-1">Get Started</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Run your first RFP search to discover procurement opportunities that match your profile.
          </p>
          <Button onClick={() => onNavigate("discover")} className="gap-2">
            <Search className="h-4 w-4" />
            Discover RFPs
          </Button>
        </div>
      )}
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

type LibrarySubTab = "profile" | "previous_response" | "target_rfp" | "supporting";

const LIBRARY_SUBTABS: { id: LibrarySubTab; label: string; shortLabel: string; description: string }[] = [
  { id: "profile", label: "Company Profile", shortLabel: "Profile", description: "AI-enhanced profile used for RFP matching" },
  { id: "previous_response", label: "Previous Responses", shortLabel: "Responses", description: "Past RFP responses we've submitted" },
  { id: "target_rfp", label: "Target RFPs", shortLabel: "Target RFPs", description: "Example RFPs that fit our profile" },
  { id: "supporting", label: "Supporting Docs", shortLabel: "Supporting", description: "Background info, credentials, case studies" },
];

function DocumentLibrary({ workspaceId }: { workspaceId?: string }) {
  const subTabParam = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("subtab") : null;
  const validSubTabs: LibrarySubTab[] = ["profile", "previous_response", "target_rfp", "supporting"];
  const [activeSubTab, setActiveSubTab] = useState<LibrarySubTab>(
    subTabParam && validSubTabs.includes(subTabParam as LibrarySubTab) ? (subTabParam as LibrarySubTab) : "profile"
  );
  const [retryingDocs, setRetryingDocs] = useState<Set<string>>(new Set());
  const [documents, setDocuments] = useState<RfpDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Per-file upload progress tracking
  type UploadProgress = { name: string; stage: "uploading" | "extracting" | "summarising" | "done" | "error"; percent: number };
  const [uploadQueue, setUploadQueue] = useState<UploadProgress[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<RfpDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocuments = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const params = new URLSearchParams({ workspaceId });
      if (activeSubTab !== "profile") params.set("type", activeSubTab);
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
  }, [workspaceId, activeSubTab]);

  useEffect(() => {
    if (activeSubTab !== "profile") {
      setLoading(true);
      fetchDocuments();
    }
  }, [fetchDocuments, activeSubTab]);

  useEffect(() => {
    const hasPending = documents.some(
      (d) => d.type_extraction_status === "pending" || d.type_extraction_status === "extracting"
    );
    if (!hasPending) return;
    const interval = setInterval(fetchDocuments, 5000);
    return () => clearInterval(interval);
  }, [documents, fetchDocuments]);

  const updateProgress = (name: string, update: Partial<UploadProgress>) => {
    setUploadQueue((prev) =>
      prev.map((p) => (p.name === name ? { ...p, ...update } : p))
    );
  };

  const handleUpload = async (files: FileList | File[]) => {
    if (!workspaceId) return;
    const fileArr = Array.from(files).filter((f) => {
      if (f.size > 50 * 1024 * 1024) {
        toast.error(`"${f.name}" exceeds the 50MB limit`);
        return false;
      }
      return true;
    });
    if (fileArr.length === 0) return;

    setUploading(true);
    setUploadQueue(fileArr.map((f) => ({ name: f.name, stage: "uploading", percent: 0 })));

    for (const file of fileArr) {
      try {
        // Stage 1: Upload to Vercel Blob
        updateProgress(file.name, { stage: "uploading", percent: 10 });
        const { upload } = await import("@vercel/blob/client");
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/media/upload",
        });
        updateProgress(file.name, { percent: 40 });

        // Stage 2: Create document record (fast)
        const res = await fetch("/api/rfp/documents/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            fileName: file.name,
            fileUrl: blob.url,
            fileSize: file.size,
            mimeType: file.type,
            documentType: activeSubTab,
          }),
        });
        const { document: doc } = await res.json();
        if (!res.ok || !doc) throw new Error("Failed to create document record");
        updateProgress(file.name, { stage: "extracting", percent: 50 });
        await fetchDocuments();

        // Stage 3: Trigger extraction (fire-and-forget from UI perspective)
        fetch(`/api/rfp/documents/${doc.id_document}/reextract`, { method: "POST" })
          .then(async (extractRes) => {
            if (extractRes.ok) {
              updateProgress(file.name, { stage: "done", percent: 100 });
            } else {
              updateProgress(file.name, { stage: "error", percent: 100 });
            }
            await fetchDocuments();
          })
          .catch(() => {
            updateProgress(file.name, { stage: "error", percent: 100 });
          });

        // Simulate progress while extraction runs
        updateProgress(file.name, { stage: "extracting", percent: 60 });
        setTimeout(() => updateProgress(file.name, { stage: "summarising", percent: 80 }), 5000);
      } catch (err: any) {
        console.error("Upload error:", err);
        updateProgress(file.name, { stage: "error", percent: 100 });
        toast.error(`${file.name}: ${err.message || "Upload failed"}`);
      }
    }

    setUploading(false);
    // Clear completed items after 3s
    setTimeout(() => {
      setUploadQueue((prev) => prev.filter((p) => p.stage !== "done" && p.stage !== "error"));
    }, 3000);
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

  const handleRetryExtraction = async (docId: string) => {
    setRetryingDocs((prev) => new Set(prev).add(docId));
    try {
      const res = await fetch(`/api/rfp/documents/${docId}/reextract`, { method: "POST" });
      if (res.ok) {
        toast.success("Document re-processed successfully");
        await fetchDocuments();
      } else {
        const data = await res.json();
        toast.error(data.error || "Re-extraction failed");
      }
    } catch (err: any) {
      toast.error(err.message || "Re-extraction failed");
    } finally {
      setRetryingDocs((prev) => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
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

  const currentSubTab = LIBRARY_SUBTABS.find((t) => t.id === activeSubTab)!;

  return (
    <div className="p-4 sm:p-6">
      {/* Sub-tab navigation */}
      <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-1 border-b">
        {LIBRARY_SUBTABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveSubTab(tab.id);
              const url = new URL(window.location.href);
              if (tab.id === "profile") {
                url.searchParams.delete("subtab");
              } else {
                url.searchParams.set("subtab", tab.id);
              }
              window.history.replaceState({}, "", url.toString());
            }}
            className={cn(
              "px-3 py-2 rounded-t-lg text-sm font-medium transition-colors whitespace-nowrap -mb-px border-b-2",
              activeSubTab === tab.id
                ? "border-violet-500 text-violet-700 dark:text-violet-300"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
            )}
          >
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.shortLabel}</span>
          </button>
        ))}
      </div>

      {/* Company Profile sub-tab */}
      {activeSubTab === "profile" && (
        <CompanyProfileEditor workspaceId={workspaceId} />
      )}

      {/* Document sub-tabs (Previous Responses, Target RFPs, Supporting) */}
      {activeSubTab !== "profile" && (
        <>
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
            {uploadQueue.length > 0 ? (
              <div className="w-full max-w-md mx-auto space-y-3">
                {uploadQueue.map((item) => (
                  <div key={item.name} className="text-left">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium truncate max-w-[70%]">{item.name}</p>
                      <span className={cn(
                        "text-xs font-medium capitalize",
                        item.stage === "done" ? "text-emerald-600" : item.stage === "error" ? "text-red-500" : "text-violet-600"
                      )}>
                        {item.stage === "done" ? "Complete" : item.stage === "error" ? "Failed" : item.stage === "summarising" ? "Summarising..." : item.stage === "extracting" ? "Extracting text..." : "Uploading..."}
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-700 ease-out",
                          item.stage === "done" ? "bg-emerald-500" : item.stage === "error" ? "bg-red-500" : "bg-violet-500"
                        )}
                        style={{ width: `${item.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : uploading ? (
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
                  {currentSubTab.description}
                </p>
              </div>
            )}
          </div>

          {/* Document list */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No {currentSubTab.label.toLowerCase()} uploaded yet.
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
                      </div>
                      <div className="flex items-center gap-1.5 mt-2">
                        {(() => {
                          const isStuck = doc.type_extraction_status === "extracting" &&
                            new Date(doc.date_created).getTime() < Date.now() - 5 * 60 * 1000;
                          if (isStuck) {
                            return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
                          }
                          return statusIcon(doc.type_extraction_status);
                        })()}
                        <span className="text-xs text-muted-foreground capitalize">
                          {doc.type_extraction_status === "ready"
                            ? "Processed"
                            : doc.type_extraction_status === "extracting" &&
                              new Date(doc.date_created).getTime() < Date.now() - 5 * 60 * 1000
                              ? "Stuck — click retry"
                              : doc.type_extraction_status}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      {(doc.type_extraction_status === "extracting" || doc.type_extraction_status === "failed") && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRetryExtraction(doc.id_document);
                          }}
                          disabled={retryingDocs.has(doc.id_document)}
                          title="Retry extraction"
                          className="p-1.5 rounded-md hover:bg-violet-50 dark:hover:bg-violet-900/20 text-muted-foreground hover:text-violet-500 transition-all disabled:opacity-50"
                        >
                          {retryingDocs.has(doc.id_document) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="h-4 w-4" />
                          )}
                        </button>
                      )}
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
        </>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────
   Company Profile Editor
   ──────────────────────────────────────────────── */

interface CompanyProfile {
  document_overview: string;
  document_services: string;
  document_sectors: string;
  document_differentiators: string;
  document_target_rfps: string;
  config_win_themes: string[];
  url_website: string;
  url_linkedin: string;
}

const PROFILE_SECTIONS: { key: keyof CompanyProfile; label: string; placeholder: string; rows: number }[] = [
  { key: "document_overview", label: "Company Overview", placeholder: "Describe your company, what you do, and who you serve...", rows: 4 },
  { key: "document_services", label: "Core Services", placeholder: "- Content strategy and production\n- Thought leadership\n- Campaign development...", rows: 6 },
  { key: "document_sectors", label: "Key Sectors", placeholder: "- Climate and environment\n- Sustainable development\n- Corporate sustainability...", rows: 5 },
  { key: "document_differentiators", label: "Differentiators", placeholder: "- Deep subject matter expertise\n- Award-winning editorial team\n- Global network...", rows: 5 },
  { key: "document_target_rfps", label: "Target RFP Types", placeholder: "- Communications and content production\n- Public awareness campaigns\n- Sustainability reporting...", rows: 5 },
];

function CompanyProfileEditor({ workspaceId }: { workspaceId: string }) {
  const [profile, setProfile] = useState<CompanyProfile>({
    document_overview: "",
    document_services: "",
    document_sectors: "",
    document_differentiators: "",
    document_target_rfps: "",
    config_win_themes: [],
    url_website: "",
    url_linkedin: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [newTheme, setNewTheme] = useState("");

  // Load profile
  useEffect(() => {
    fetch(`/api/rfp/company-profile?workspaceId=${workspaceId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.profile) {
          setProfile({
            document_overview: data.profile.document_overview || "",
            document_services: data.profile.document_services || "",
            document_sectors: data.profile.document_sectors || "",
            document_differentiators: data.profile.document_differentiators || "",
            document_target_rfps: data.profile.document_target_rfps || "",
            config_win_themes: data.profile.config_win_themes || [],
            url_website: data.profile.url_website || "",
            url_linkedin: data.profile.url_linkedin || "",
          });
        }
      })
      .catch((err) => console.error("Failed to load profile:", err))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const updateField = (key: keyof CompanyProfile, value: any) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/rfp/company-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, ...profile }),
      });
      if (res.ok) {
        toast.success("Company profile saved");
        setDirty(false);
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to save");
      }
    } catch {
      toast.error("Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/rfp/company-profile/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await res.json();
      if (res.ok && data.generated) {
        setProfile((prev) => ({
          ...prev,
          document_overview: data.generated.document_overview || prev.document_overview,
          document_services: data.generated.document_services || prev.document_services,
          document_sectors: data.generated.document_sectors || prev.document_sectors,
          document_differentiators: data.generated.document_differentiators || prev.document_differentiators,
          document_target_rfps: data.generated.document_target_rfps || prev.document_target_rfps,
          config_win_themes: data.generated.config_win_themes?.length > 0 ? data.generated.config_win_themes : prev.config_win_themes,
        }));
        setDirty(true);
        toast.success(`Profile generated from ${data.documentsUsed} documents. Review and save when ready.`);
      } else {
        toast.error(data.error || "Generation failed");
      }
    } catch {
      toast.error("Failed to generate profile");
    } finally {
      setGenerating(false);
    }
  };

  const addTheme = () => {
    if (!newTheme.trim()) return;
    updateField("config_win_themes", [...profile.config_win_themes, newTheme.trim()]);
    setNewTheme("");
  };

  const removeTheme = (idx: number) => {
    updateField("config_win_themes", profile.config_win_themes.filter((_, i) => i !== idx));
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-muted/30 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">Company Profile</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            This profile is used by AI to match and score RFP opportunities. Edit any section or generate from your uploaded documents.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleGenerate}
          disabled={generating}
          className="shrink-0"
        >
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
          )}
          {generating ? "Generating..." : "Generate from Docs"}
        </Button>
      </div>

      {/* Online Presence */}
      <div className="border rounded-xl p-4 space-y-3">
        <p className="text-sm font-medium">Online Presence</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Website</label>
            <Input
              value={profile.url_website}
              onChange={(e) => updateField("url_website", e.target.value)}
              placeholder="https://thecontentengine.com"
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">LinkedIn</label>
            <Input
              value={profile.url_linkedin}
              onChange={(e) => updateField("url_linkedin", e.target.value)}
              placeholder="https://linkedin.com/company/..."
              className="h-9 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Editable sections */}
      {PROFILE_SECTIONS.map((section) => (
        <div key={section.key} className="border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">{section.label}</label>
          </div>
          <textarea
            value={(profile[section.key] as string) || ""}
            onChange={(e) => updateField(section.key, e.target.value)}
            placeholder={section.placeholder}
            rows={section.rows}
            className="w-full text-sm rounded-lg border bg-transparent px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 resize-y"
          />
        </div>
      ))}

      {/* Win Themes */}
      <div className="border rounded-xl p-4">
        <label className="text-sm font-medium block mb-2">Win Themes</label>
        <p className="text-xs text-muted-foreground mb-3">
          Key competitive advantages highlighted in your RFP responses
        </p>
        <div className="space-y-2">
          {profile.config_win_themes.map((theme, idx) => (
            <div key={idx} className="flex items-center gap-2 group">
              <div className="flex-1 text-sm bg-muted/50 rounded-lg px-3 py-2">
                {theme}
              </div>
              <button
                onClick={() => removeTheme(idx)}
                className="p-1 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-60 hover:opacity-100 transition-all"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Input
              value={newTheme}
              onChange={(e) => setNewTheme(e.target.value)}
              placeholder="Add a win theme..."
              className="h-9 text-sm flex-1"
              onKeyDown={(e) => e.key === "Enter" && addTheme()}
            />
            <Button size="sm" variant="outline" onClick={addTheme} disabled={!newTheme.trim()}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center justify-end gap-3 pb-4">
        {dirty && (
          <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Unsaved changes
          </span>
        )}
        <Button onClick={handleSave} disabled={saving || !dirty}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
          ) : (
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
          )}
          Save Changes
        </Button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────
   Discover Panel
   ──────────────────────────────────────────────── */

/** Update a URL search param without a full page navigation */
function setUrlParam(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value) {
    url.searchParams.set(key, value);
  } else {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, "", url.toString());
}

/* ────────────────────────────────────────────────
   All RFPs — Amalgamated Table View
   ──────────────────────────────────────────────── */

interface AggregatedRfp extends DiscoveredRfp {
  firstFoundDate: string;
  lastFoundDate: string;
  foundInSearches: number;
  searchQuery: string | null;
  searchId: string;
  provider: string;
  pipelineStatus: string | null;
  opportunityId: string | null;
}

type SortField = "score" | "deadline" | "found" | "title" | "value";

function AllRfpsView({
  workspaceId,
  savedOpps,
  setSavedOpps,
}: {
  workspaceId?: string;
  savedOpps: Map<string, SavedOppInfo>;
  setSavedOpps: React.Dispatch<React.SetStateAction<Map<string, SavedOppInfo>>>;
}) {
  const [rfps, setRfps] = useState<AggregatedRfp[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "saved" | "unsaved">("all");
  const [sortField, setSortField] = useState<SortField>("found");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedRfp, setSelectedRfp] = useState<AggregatedRfp | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // Fetch all results on mount
  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    fetch(`/api/rfp/searches/all-results?workspaceId=${workspaceId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.rfps) setRfps(data.rfps);
      })
      .catch((err) => {
        console.error("Failed to fetch all RFPs:", err);
        toast.error("Failed to load RFP index");
      })
      .finally(() => setLoading(false));
  }, [workspaceId]);

  // Check if an rfp is saved in pipeline (via local savedOpps or pipelineStatus from API)
  const isInPipeline = useCallback(
    (rfp: AggregatedRfp) => {
      if (rfp.pipelineStatus && rfp.pipelineStatus !== "ignored") return true;
      const key = rfp.sourceUrl || rfp.title;
      return savedOpps.has(key);
    },
    [savedOpps]
  );

  const isIgnored = useCallback(
    (rfp: AggregatedRfp) => {
      if (rfp.pipelineStatus === "ignored") return true;
      const key = rfp.sourceUrl || rfp.title;
      const info = savedOpps.get(key);
      return info?.status === "ignored";
    },
    [savedOpps]
  );

  // Client-side filtering & sorting
  const filteredRfps = useMemo(() => {
    let result = rfps;

    // Text search
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      result = result.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.organisation.toLowerCase().includes(q) ||
          r.scope.toLowerCase().includes(q) ||
          (r.region && r.region.toLowerCase().includes(q)) ||
          r.sectors.some((s) => s.toLowerCase().includes(q)) ||
          (r.estimatedValue && r.estimatedValue.toLowerCase().includes(q))
      );
    }

    // Status filter
    if (statusFilter === "open") result = result.filter((r) => r.status !== "likely_closed");
    if (statusFilter === "saved") result = result.filter((r) => isInPipeline(r));
    if (statusFilter === "unsaved") result = result.filter((r) => !isInPipeline(r) && !isIgnored(r));

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "score":
          cmp = (a.relevanceScore || 0) - (b.relevanceScore || 0);
          break;
        case "deadline": {
          const da = a.deadline ? parseDate(a.deadline)?.getTime() || 0 : 0;
          const db = b.deadline ? parseDate(b.deadline)?.getTime() || 0 : 0;
          // Push nulls to end
          if (!da && db) return 1;
          if (da && !db) return -1;
          cmp = da - db;
          break;
        }
        case "found":
          cmp = new Date(a.lastFoundDate).getTime() - new Date(b.lastFoundDate).getTime();
          break;
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "value": {
          const va = parseFloat((a.estimatedValue || "0").replace(/[^0-9.]/g, "")) || 0;
          const vb = parseFloat((b.estimatedValue || "0").replace(/[^0-9.]/g, "")) || 0;
          cmp = va - vb;
          break;
        }
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return result;
  }, [rfps, searchFilter, statusFilter, sortField, sortDir, isInPipeline, isIgnored]);

  // Counts for filter pills
  const counts = useMemo(() => {
    const all = rfps.length;
    const open = rfps.filter((r) => r.status !== "likely_closed").length;
    const saved = rfps.filter((r) => isInPipeline(r)).length;
    const unsaved = rfps.filter((r) => !isInPipeline(r) && !isIgnored(r)).length;
    return { all, open, saved, unsaved };
  }, [rfps, isInPipeline, isIgnored]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === "desc" ? <SortDesc className="h-3 w-3" /> : <SortAsc className="h-3 w-3" />;
  };

  // Save to pipeline
  const handleSaveRfp = async (rfp: AggregatedRfp) => {
    if (!workspaceId) return;
    setSaving(rfp.title);
    try {
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
        const key = rfp.sourceUrl || rfp.title;
        setSavedOpps((prev) => new Map(prev).set(key, { oppId, status: "shortlisted" }));
        // Update local state
        setRfps((prev) =>
          prev.map((r) =>
            r === rfp ? { ...r, pipelineStatus: "shortlisted", opportunityId: oppId } : r
          )
        );
        toast.success("Saved to pipeline");
      } else {
        toast.error("Failed to save");
      }
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(null);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 bg-muted/50 rounded-lg flex-1 animate-pulse" />
        </div>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 w-24 bg-muted/50 rounded-full animate-pulse" />
          ))}
        </div>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-16 bg-muted/30 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  // Empty state
  if (rfps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
          <List className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-1">No RFPs found yet</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Run a search in the Discover tab to find RFP opportunities. All discovered RFPs will appear here as a searchable index.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Search bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Search by title, organisation, scope, region..."
            className="pl-9 h-10"
          />
          {searchFilter && (
            <button
              onClick={() => setSearchFilter("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:block">
          {filteredRfps.length === rfps.length
            ? `${rfps.length} RFPs`
            : `${filteredRfps.length} of ${rfps.length}`}
        </span>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {(
          [
            { id: "all", label: "All", count: counts.all },
            { id: "open", label: "Open", count: counts.open },
            { id: "saved", label: "In Pipeline", count: counts.saved },
            { id: "unsaved", label: "Not Saved", count: counts.unsaved },
          ] as const
        ).map((pill) => (
          <button
            key={pill.id}
            onClick={() => setStatusFilter(pill.id)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
              statusFilter === pill.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            )}
          >
            {pill.label}
            <span
              className={cn(
                "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold",
                statusFilter === pill.id
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {pill.count}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="border rounded-xl overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground uppercase tracking-wider">
                  <button onClick={() => handleSort("title")} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                    RFP <SortIcon field="title" />
                  </button>
                </th>
                <th className="text-center px-2 py-3 font-medium text-xs text-muted-foreground uppercase tracking-wider w-[52px]">
                  <button onClick={() => handleSort("score")} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                    Score <SortIcon field="score" />
                  </button>
                </th>
                <th className="text-left px-3 py-3 font-medium text-xs text-muted-foreground uppercase tracking-wider">
                  <button onClick={() => handleSort("deadline")} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                    Deadline <SortIcon field="deadline" />
                  </button>
                </th>
                <th className="text-left px-3 py-3 font-medium text-xs text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                  <button onClick={() => handleSort("value")} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                    Value <SortIcon field="value" />
                  </button>
                </th>
                <th className="text-left px-3 py-3 font-medium text-xs text-muted-foreground uppercase tracking-wider hidden lg:table-cell">
                  Source
                </th>
                <th className="text-left px-3 py-3 font-medium text-xs text-muted-foreground uppercase tracking-wider hidden sm:table-cell">
                  <button onClick={() => handleSort("found")} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                    Found <SortIcon field="found" />
                  </button>
                </th>
                <th className="text-center px-3 py-3 font-medium text-xs text-muted-foreground uppercase tracking-wider w-[100px]">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRfps.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-muted-foreground">
                    <Search className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No matching RFPs</p>
                    <p className="text-xs mt-1">Try adjusting your search or filters</p>
                  </td>
                </tr>
              ) : (
                filteredRfps.map((rfp, idx) => {
                  const urgency = rfp.deadline ? getDeadlineUrgency(rfp.deadline) : null;
                  const domain = extractDomain(rfp.sourceUrl);
                  const inPipeline = isInPipeline(rfp);
                  const ignored = isIgnored(rfp);
                  const isSaving = saving === rfp.title;

                  return (
                    <tr
                      key={`${rfp.title}-${idx}`}
                      onClick={() => setSelectedRfp(rfp)}
                      className="border-b last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer group"
                    >
                      {/* Title + Org */}
                      <td className="px-4 py-3 max-w-[320px]">
                        <p className="font-medium text-sm leading-snug line-clamp-1 group-hover:text-primary transition-colors">
                          {rfp.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{rfp.organisation}</p>
                      </td>

                      {/* Score */}
                      <td className="px-2 py-3 text-center">
                        <span
                          className={cn(
                            "inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold",
                            scoreColor(rfp.relevanceScore)
                          )}
                        >
                          {rfp.relevanceScore}
                        </span>
                      </td>

                      {/* Deadline */}
                      <td className="px-3 py-3">
                        {rfp.deadline ? (
                          <div>
                            <p className="text-xs font-medium">{formatDeadline(rfp.deadline)}</p>
                            {urgency && (
                              <span className={cn("inline-block text-[10px] font-medium px-1.5 py-0.5 rounded mt-0.5", urgency.className)}>
                                {urgency.label}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">TBD</span>
                        )}
                      </td>

                      {/* Value */}
                      <td className="px-3 py-3 hidden md:table-cell">
                        <span className="text-xs">{rfp.estimatedValue || "—"}</span>
                      </td>

                      {/* Source */}
                      <td className="px-3 py-3 hidden lg:table-cell">
                        {rfp.sourceUrl ? (
                          <a
                            href={rfp.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline max-w-[140px] truncate"
                          >
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                            {domain}
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Found */}
                      <td className="px-3 py-3 hidden sm:table-cell">
                        <div className="flex items-center gap-1.5">
                          {rfp.provider === "grok" ? (
                            <span title="Found via Grok"><Cpu className="h-3 w-3 text-muted-foreground" /></span>
                          ) : (
                            <span title="Found via Claude"><Sparkles className="h-3 w-3 text-muted-foreground" /></span>
                          )}
                          <span className="text-xs text-muted-foreground" title={new Date(rfp.lastFoundDate).toLocaleString()}>
                            {formatRelativeTime(rfp.lastFoundDate)}
                          </span>
                        </div>
                        {rfp.foundInSearches > 1 && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Found in {rfp.foundInSearches} searches
                          </p>
                        )}
                      </td>

                      {/* Status / Actions */}
                      <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        {inPipeline ? (
                          <Badge variant="secondary" className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 border-0">
                            <CheckCircle2 className="h-3 w-3 mr-0.5" />
                            Saved
                          </Badge>
                        ) : ignored ? (
                          <Badge variant="secondary" className="text-[10px] opacity-60 border-0">
                            <EyeOff className="h-3 w-3 mr-0.5" />
                            Ignored
                          </Badge>
                        ) : (
                          <button
                            onClick={() => handleSaveRfp(rfp)}
                            disabled={!!isSaving}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                          >
                            {isSaving ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Bookmark className="h-3 w-3" />
                            )}
                            Save
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Modal */}
      <Dialog open={!!selectedRfp} onOpenChange={() => setSelectedRfp(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedRfp && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg leading-snug pr-8">{selectedRfp.title}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                {/* Top row: org + score */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{selectedRfp.organisation}</p>
                    {selectedRfp.region && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <MapPin className="h-3 w-3" />
                        {selectedRfp.region}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold flex-shrink-0",
                      scoreColor(selectedRfp.relevanceScore)
                    )}
                  >
                    {selectedRfp.relevanceScore}
                  </span>
                </div>

                {/* Key details grid */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Deadline</p>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">{formatDeadline(selectedRfp.deadline)}</span>
                      {selectedRfp.deadline && (() => {
                        const u = getDeadlineUrgency(selectedRfp.deadline);
                        return u ? <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", u.className)}>{u.label}</span> : null;
                      })()}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Est. Value</p>
                    <p className="font-medium">{selectedRfp.estimatedValue || "Not specified"}</p>
                  </div>
                </div>

                {/* Milestones */}
                {selectedRfp.milestones?.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Key Milestones</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedRfp.milestones.map((m, i) => (
                        <span key={i} className="inline-flex items-center gap-1 text-xs bg-muted/50 px-2 py-1 rounded">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          {m.label}: {formatDeadline(m.date)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sectors */}
                {selectedRfp.sectors?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedRfp.sectors.map((s, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px]">
                        {s}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Scope */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Scope</p>
                  <p className="text-sm leading-relaxed">{selectedRfp.scope}</p>
                </div>

                {/* Status indicators */}
                {selectedRfp.status === "confirmed_open" && (
                  <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2">
                    <ShieldCheck className="h-4 w-4" />
                    Verified as currently open and accepting submissions
                  </div>
                )}
                {selectedRfp.status === "likely_closed" && (
                  <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                    <AlertTriangle className="h-4 w-4" />
                    This opportunity may be closed — verify before responding
                  </div>
                )}

                {/* AI Reasoning */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Why this is relevant</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{selectedRfp.reasoning}</p>
                </div>

                {/* Source URL */}
                {selectedRfp.sourceUrl && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Source</p>
                    <a
                      href={selectedRfp.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {truncateUrl(selectedRfp.sourceUrl)}
                    </a>
                  </div>
                )}

                {/* Metadata */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground border-t pt-3">
                  <span className="flex items-center gap-1">
                    {selectedRfp.provider === "grok" ? <Cpu className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                    Found via {selectedRfp.provider === "grok" ? "Grok" : "Claude"}
                  </span>
                  <span>{formatRelativeTime(selectedRfp.lastFoundDate)}</span>
                  {selectedRfp.foundInSearches > 1 && (
                    <span>Found in {selectedRfp.foundInSearches} searches</span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2 border-t">
                  {isInPipeline(selectedRfp) ? (
                    <Badge className="bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 border-0">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Saved to pipeline
                    </Badge>
                  ) : isIgnored(selectedRfp) ? (
                    <Badge variant="secondary" className="opacity-60">
                      <EyeOff className="h-3 w-3 mr-1" />
                      Ignored
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleSaveRfp(selectedRfp)}
                      disabled={!!saving}
                    >
                      {saving === selectedRfp.title ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <Bookmark className="h-4 w-4 mr-1" />
                      )}
                      Save to Pipeline
                    </Button>
                  )}
                  {selectedRfp.sourceUrl && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={selectedRfp.sourceUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 mr-1" />
                        Open Source
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

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
  initialSearchId,
  expandSavedSearches,
  onSavedSearchesExpanded,
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
  initialSearchId?: string | null;
  expandSavedSearches?: boolean;
  onSavedSearchesExpanded?: () => void;
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
  const [searchHistory, setSearchHistory] = useState<{
    id_search: string;
    query: string | null;
    type_provider: string;
    units_result_count: number;
    name_user_created: string | null;
    date_created: string;
    results?: DiscoveredRfp[];
  }[]>([]);
  const [activeSearchId, setActiveSearchId] = useState<string | null>(initialSearchId || null);

  /** Load a specific search by ID (from history click or URL param) */
  const loadSearch = useCallback((search: {
    id_search: string;
    query?: string | null;
    type_provider?: string;
    units_result_count?: number;
    name_user_created?: string | null;
    date_created: string;
    results?: DiscoveredRfp[];
    document_summary?: string;
  }) => {
    setResults(search.results || []);
    setSearchSummary(search.document_summary || "");
    setHasSearched(true);
    setQuery(search.query || "");
    setActiveSearchId(search.id_search);
    setSearchMeta({
      userName: search.name_user_created || "Unknown",
      date: search.date_created,
      provider: search.type_provider || "anthropic",
      resultCount: search.units_result_count || (search.results?.length ?? 0),
      query: search.query || null,
    });
    setUrlParam("search", search.id_search);
    setUrlParam("tab", "discover");
  }, [setResults, setSearchSummary, setHasSearched, setQuery]);

  // Load search from URL param on mount
  useEffect(() => {
    if (!initialSearchId || !workspaceId) return;
    // If we already have it in history, use it
    const cached = searchHistory.find((s) => s.id_search === initialSearchId);
    if (cached && cached.results) {
      loadSearch(cached);
      return;
    }
    // Otherwise fetch from API
    fetch(`/api/rfp/searches/${initialSearchId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.search) {
          loadSearch(data.search);
        }
      })
      .catch((err) => console.error("Failed to load search:", err));
  }, [initialSearchId, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

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
          fetch(`/api/rfp/searches?workspaceId=${workspaceId}&limit=10`),
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

        // Store search history for display
        const savedSearches = searchData.searches || [];
        setSearchHistory(savedSearches);

        // Load the latest saved search if we haven't searched yet
        // (and no specific search ID was requested via URL)
        if (savedSearches.length > 0 && !hasSearched && !initialSearchId) {
          const latest = savedSearches[0];
          loadSearch(latest);
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
          // Refresh search history and update URL
          if (saved.search) {
            setSearchHistory((prev) => [saved.search, ...prev].slice(0, 10));
            setActiveSearchId(saved.search.id_search);
            setUrlParam("search", saved.search.id_search);
          }
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
          forceExpand={expandSavedSearches}
          onForceExpandConsumed={onSavedSearchesExpanded}
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
                  setActiveSearchId(null);
                  setUrlParam("search", null);
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
                    {/* Status badge */}
                    {rfp.status === "confirmed_open" && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        <ShieldCheck className="h-3 w-3" />
                        Verified open
                      </span>
                    )}
                    {rfp.status === "likely_closed" && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-3 w-3" />
                        May be closed
                      </span>
                    )}
                  </div>

                  {/* Row 3: Scope (truncated) */}
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    {rfp.scope}
                  </p>

                  {/* Row 4: Source URL + Quick Actions */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {rfp.sourceUrl ? (
                        <span
                          role="link"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); window.open(rfp.sourceUrl!, "_blank", "noopener"); }}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); window.open(rfp.sourceUrl!, "_blank", "noopener"); } }}
                          className={cn(
                            "inline-flex items-center gap-1.5 text-xs cursor-pointer hover:underline min-w-0",
                            rfp.urlConfidence === "verified"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : rfp.urlConfidence === "trusted_domain"
                              ? "text-cyan-600 dark:text-cyan-400"
                              : "text-blue-600 dark:text-blue-400 hover:text-blue-700"
                          )}
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">{truncateUrl(rfp.sourceUrl)}</span>
                        </span>
                      ) : rfp.portalSearchUrl ? (
                        <span
                          role="link"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); window.open(rfp.portalSearchUrl!, "_blank", "noopener"); }}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); window.open(rfp.portalSearchUrl!, "_blank", "noopener"); } }}
                          className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 cursor-pointer hover:underline min-w-0"
                        >
                          <Search className="h-3 w-3 shrink-0" />
                          <span className="truncate">{truncateUrl(rfp.portalSearchUrl)}</span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/50 italic">No source URL</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {matched ? (
                        <span className={cn(
                          "text-[11px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1",
                          matched.status === "ignored"
                            ? "bg-muted text-muted-foreground"
                            : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        )}>
                          {matched.status === "ignored" ? (
                            <><EyeOff className="h-3 w-3" /> Ignored</>
                          ) : (
                            <><FolderKanban className="h-3 w-3" />
                              {matched.status === "submitted" ? "Submitted" :
                               matched.responseStatus ? getResponseStage(matched.responseStatus).label :
                               "Saved"}
                            </>
                          )}
                        </span>
                      ) : (
                        <>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={async (e) => { e.stopPropagation(); await handleSave(rfp); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); handleSave(rfp); } }}
                            className={cn(
                              "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md transition-colors cursor-pointer",
                              "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50",
                              saving === rfp.title && "opacity-60 pointer-events-none"
                            )}
                          >
                            {saving === rfp.title ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bookmark className="h-3 w-3" />}
                            Save
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={async (e) => { e.stopPropagation(); await handleIgnore(rfp); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); handleIgnore(rfp); } }}
                            className={cn(
                              "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md transition-colors cursor-pointer",
                              "text-muted-foreground hover:bg-muted",
                              saving === rfp.title && "opacity-60 pointer-events-none"
                            )}
                          >
                            <EyeOff className="h-3 w-3" />
                            Ignore
                          </span>
                        </>
                      )}
                    </div>
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

                      {/* Status indicator */}
                      {rfp.status === "likely_closed" && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800">
                          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">This opportunity may be closed</p>
                            <p className="text-xs text-amber-600 dark:text-amber-400">We detected closure signals on the source page. Check the link to confirm.</p>
                          </div>
                        </div>
                      )}
                      {rfp.status === "confirmed_open" && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-50 border border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800">
                          <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Verified: source page confirms this is still open</p>
                        </div>
                      )}

                      {/* AI Reasoning */}
                      {rfp.reasoning && (
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Why This Matches</p>
                          <p className="text-sm text-muted-foreground leading-relaxed italic">{rfp.reasoning}</p>
                        </div>
                      )}

                      {/* Source link */}
                      <div className="space-y-2">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Source</p>
                        {rfp.sourceUrl ? (
                          <a
                            href={rfp.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="group block p-3 rounded-md border hover:border-foreground/20 hover:bg-muted/30 transition-colors"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <ExternalLink className={cn(
                                "h-3.5 w-3.5 shrink-0",
                                rfp.urlConfidence === "verified"
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : rfp.urlConfidence === "trusted_domain"
                                  ? "text-cyan-600 dark:text-cyan-400"
                                  : "text-blue-600 dark:text-blue-400"
                              )} />
                              <span className="text-sm font-medium group-hover:underline">
                                {rfp.urlConfidence === "verified" ? "View RFP" :
                                 rfp.urlConfidence === "trusted_domain" ? `View on ${rfp.portalName || "portal"}` :
                                 "View source"}
                              </span>
                              {rfp.urlConfidence === "verified" && (
                                <Badge variant="outline" className="text-[9px] h-4 px-1 text-emerald-600 border-emerald-200 dark:border-emerald-800">Verified</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground break-all pl-5.5">{rfp.sourceUrl}</p>
                          </a>
                        ) : rfp.portalSearchUrl ? (
                          <a
                            href={rfp.portalSearchUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="group block p-3 rounded-md border hover:border-foreground/20 hover:bg-muted/30 transition-colors"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <Search className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                              <span className="text-sm font-medium group-hover:underline">Search on {rfp.portalName || "portal"}</span>
                            </div>
                            <p className="text-xs text-muted-foreground break-all pl-5.5">{rfp.portalSearchUrl}</p>
                          </a>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">No source URL available</p>
                        )}
                      </div>

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
        <div className="flex flex-col items-center py-12">
          <Search className="h-6 w-6 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            Search for open procurement opportunities
          </p>
        </div>
      )}

      {/* Search History */}
      {!searching && searchHistory.length > 0 && (
        <div className="max-w-3xl mx-auto mt-6 border rounded-lg">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Search History</h3>
          </div>
          <div className="divide-y">
            {searchHistory.map((s, i) => {
              const isActive = activeSearchId === s.id_search;
              const hasResults = s.results && s.results.length > 0;
              return (
                <div
                  key={s.id_search || i}
                  className={cn(
                    "flex items-center transition-colors",
                    isActive
                      ? "bg-cyan-500/5 border-l-2 border-l-cyan-500"
                      : "hover:bg-muted/30",
                    !hasResults && "opacity-50"
                  )}
                >
                  <button
                    onClick={() => {
                      if (hasResults) loadSearch(s as any);
                    }}
                    disabled={!hasResults}
                    className="flex-1 px-4 py-2.5 flex items-center gap-3 text-left min-w-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">
                        {s.query || <span className="italic text-muted-foreground">Default search</span>}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{s.name_user_created || "Unknown"}</span>
                        <span>·</span>
                        <span>{formatRelativeTime(s.date_created)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {s.type_provider === "grok" ? (
                        <Cpu className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <Sparkles className="h-3 w-3 text-muted-foreground" />
                      )}
                      <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                        {s.units_result_count || 0} results
                      </Badge>
                      {isActive && (
                        <div className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
                      )}
                    </div>
                  </button>
                  {/* Copy link button */}
                  {hasResults && (
                    <button
                      onClick={() => {
                        const url = new URL(window.location.href);
                        url.searchParams.set("tab", "discover");
                        url.searchParams.set("search", s.id_search);
                        navigator.clipboard.writeText(url.toString());
                        toast.success("Link copied");
                      }}
                      className="px-3 py-2.5 text-muted-foreground/40 hover:text-foreground transition-colors shrink-0"
                      title="Copy link to this search"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
