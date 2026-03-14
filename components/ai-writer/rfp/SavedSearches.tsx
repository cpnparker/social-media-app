"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  Play,
  Upload,
  Loader2,
  Trash2,
  Clock,
  Sparkles,
  Cpu,
  Plus,
  MoreHorizontal,
  Calendar,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface SearchConfig {
  sources: string[];
  keywords: string[];
  sectors: string[];
  regions: string[];
}

type SearchProvider = "anthropic" | "grok";

interface DeadlineMilestone {
  type: string;
  label: string;
  date: string;
}

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
}

interface SavedSearch {
  id_saved_search: string;
  name: string;
  query: string | null;
  config_search: SearchConfig;
  type_provider: string;
  type_schedule: string | null;
  config_schedule: { dayOfWeek?: number };
  flag_schedule_enabled: number;
  date_last_run: string | null;
  date_next_run: string | null;
  name_user_created: string | null;
  date_created: string;
}

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

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

function configSummary(config: SearchConfig): string {
  const parts: string[] = [];
  if (config.sectors?.length) parts.push(`${config.sectors.length} sector${config.sectors.length > 1 ? "s" : ""}`);
  if (config.regions?.length) parts.push(`${config.regions.length} region${config.regions.length > 1 ? "s" : ""}`);
  if (config.sources?.length) parts.push(`${config.sources.length} source${config.sources.length > 1 ? "s" : ""}`);
  if (config.keywords?.length) parts.push(`${config.keywords.length} keyword${config.keywords.length > 1 ? "s" : ""}`);
  return parts.length > 0 ? parts.join(", ") : "All defaults";
}

export function SavedSearchesPanel({
  workspaceId,
  currentConfig,
  currentQuery,
  currentProvider,
  onLoadSearch,
  onRunResult,
}: {
  workspaceId: string;
  currentConfig: SearchConfig;
  currentQuery: string;
  currentProvider: SearchProvider;
  onLoadSearch: (config: SearchConfig, query: string, provider: SearchProvider) => void;
  onRunResult: (opportunities: DiscoveredRfp[], summary: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [showNameInput, setShowNameInput] = useState(false);
  const [newName, setNewName] = useState("");

  const fetchSearches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rfp/saved-searches?workspaceId=${workspaceId}`);
      if (res.ok) {
        const data = await res.json();
        setSearches(data.savedSearches || []);
      }
    } catch (err) {
      console.error("Failed to fetch saved searches:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (expanded && searches.length === 0) {
      fetchSearches();
    }
  }, [expanded, fetchSearches, searches.length]);

  const handleSave = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/rfp/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          name: newName.trim(),
          query: currentQuery || null,
          config: currentConfig,
          provider: currentProvider,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSearches((prev) => [data.savedSearch, ...prev]);
        setNewName("");
        setShowNameInput(false);
        toast.success("Search saved");
      }
    } catch (err) {
      toast.error("Failed to save search");
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async (search: SavedSearch) => {
    setRunning(search.id_saved_search);
    try {
      const res = await fetch(`/api/rfp/saved-searches/${search.id_saved_search}/run`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        onRunResult(data.opportunities || [], data.searchSummary || "");
        // Update last run time locally
        setSearches((prev) =>
          prev.map((s) =>
            s.id_saved_search === search.id_saved_search
              ? { ...s, date_last_run: new Date().toISOString() }
              : s
          )
        );
        toast.success(`Search "${search.name}" completed`);
      } else {
        toast.error("Search failed");
      }
    } catch (err) {
      toast.error("Search failed");
    } finally {
      setRunning(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/rfp/saved-searches/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSearches((prev) => prev.filter((s) => s.id_saved_search !== id));
        toast.success("Saved search deleted");
      }
    } catch (err) {
      toast.error("Failed to delete");
    }
  };

  const handleScheduleChange = async (
    search: SavedSearch,
    schedule: string | null,
    dayOfWeek?: number
  ) => {
    const body: any = {};

    if (schedule === null) {
      // Turn off
      body.type_schedule = null;
      body.flag_schedule_enabled = 0;
    } else {
      body.type_schedule = schedule;
      body.flag_schedule_enabled = 1;
      if (schedule === "weekly") {
        body.config_schedule = { dayOfWeek: dayOfWeek ?? 1 };
      } else {
        body.config_schedule = {};
      }
    }

    try {
      const res = await fetch(`/api/rfp/saved-searches/${search.id_saved_search}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setSearches((prev) =>
          prev.map((s) =>
            s.id_saved_search === search.id_saved_search ? data.savedSearch : s
          )
        );
        toast.success(schedule ? `Scheduled ${schedule}` : "Schedule removed");
      }
    } catch (err) {
      toast.error("Failed to update schedule");
    }
  };

  const handleDayChange = async (search: SavedSearch, dayOfWeek: number) => {
    try {
      const res = await fetch(`/api/rfp/saved-searches/${search.id_saved_search}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config_schedule: { dayOfWeek },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSearches((prev) =>
          prev.map((s) =>
            s.id_saved_search === search.id_saved_search ? data.savedSearch : s
          )
        );
      }
    } catch (err) {
      toast.error("Failed to update");
    }
  };

  return (
    <div className="max-w-2xl mx-auto mt-3 mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Calendar className="h-3 w-3" />
        Saved Searches
        {searches.length > 0 && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 ml-1">
            {searches.length}
          </Badge>
        )}
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {expanded && (
        <div className="mt-3 border rounded-lg bg-muted/20 overflow-hidden">
          {/* Save current search */}
          <div className="p-3 border-b">
            {showNameInput ? (
              <div className="flex gap-2">
                <Input
                  placeholder="Name this search..."
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  className="text-xs h-8 flex-1"
                  autoFocus
                />
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={!newName.trim() || saving}
                  onClick={handleSave}
                >
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => { setShowNameInput(false); setNewName(""); }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs gap-1.5 h-8"
                onClick={() => { setShowNameInput(true); setNewName(currentQuery || ""); }}
              >
                <Plus className="h-3 w-3" />
                Save Current Search
              </Button>
            )}
          </div>

          {/* Search list */}
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : searches.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">
              No saved searches yet. Save your current search configuration above.
            </div>
          ) : (
            <div className="divide-y">
              {searches.map((search) => (
                <div key={search.id_saved_search} className="p-3 space-y-2">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{search.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          {search.type_provider === "anthropic" ? (
                            <Sparkles className="h-2.5 w-2.5" />
                          ) : (
                            <Cpu className="h-2.5 w-2.5" />
                          )}
                          {search.type_provider === "anthropic" ? "Claude" : "Grok"}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {configSummary(search.config_search)}
                        </span>
                      </div>
                      {search.query && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          Query: {search.query}
                        </p>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleDelete(search.id_saved_search)}
                          className="text-xs text-destructive gap-2"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Last run + schedule info */}
                  <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                    {search.date_last_run && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        Last run: {formatRelativeTime(search.date_last_run)}
                      </span>
                    )}
                    {search.flag_schedule_enabled === 1 && search.type_schedule && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                        {search.type_schedule === "daily"
                          ? "Daily"
                          : `Weekly ${DAYS.find((d) => d.value === search.config_schedule?.dayOfWeek)?.label || "Mon"}`}
                      </Badge>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      disabled={running === search.id_saved_search}
                      onClick={() => handleRun(search)}
                    >
                      {running === search.id_saved_search ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      {running === search.id_saved_search ? "Running..." : "Run"}
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      onClick={() =>
                        onLoadSearch(
                          search.config_search,
                          search.query || "",
                          search.type_provider as SearchProvider
                        )
                      }
                    >
                      <Upload className="h-3 w-3" />
                      Load
                    </Button>

                    {/* Schedule selector */}
                    <div className="flex items-center gap-0.5 bg-muted/50 rounded-md p-0.5 ml-auto">
                      <button
                        onClick={() => handleScheduleChange(search, null)}
                        className={cn(
                          "px-2 py-1 rounded text-[11px] font-medium transition-colors",
                          !search.type_schedule || search.flag_schedule_enabled === 0
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        Off
                      </button>
                      <button
                        onClick={() => handleScheduleChange(search, "daily")}
                        className={cn(
                          "px-2 py-1 rounded text-[11px] font-medium transition-colors",
                          search.type_schedule === "daily" && search.flag_schedule_enabled === 1
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        Daily
                      </button>
                      <button
                        onClick={() =>
                          handleScheduleChange(search, "weekly", search.config_schedule?.dayOfWeek || 1)
                        }
                        className={cn(
                          "px-2 py-1 rounded text-[11px] font-medium transition-colors",
                          search.type_schedule === "weekly" && search.flag_schedule_enabled === 1
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        Weekly
                      </button>
                    </div>
                  </div>

                  {/* Day picker for weekly */}
                  {search.type_schedule === "weekly" && search.flag_schedule_enabled === 1 && (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[10px] text-muted-foreground mr-1">Day:</span>
                      {DAYS.map((day) => (
                        <button
                          key={day.value}
                          onClick={() => handleDayChange(search, day.value)}
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded transition-colors",
                            (search.config_schedule?.dayOfWeek || 1) === day.value
                              ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300 font-medium"
                              : "text-muted-foreground hover:bg-muted"
                          )}
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
