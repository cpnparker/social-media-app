"use client";

import { useState, useEffect, useCallback, Suspense, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  FileText,
  Plus,
  Loader2,
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  Zap,
  User,
  ArrowUpDown,
  X,
  SlidersHorizontal,
  ChevronDown,
  Calendar,
  Hash,
  Filter,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";
import { typeColors, categorizeContentType, CATEGORY_ORDER } from "@/lib/content-type-utils";

// ── Helpers ──────────────────────────────────────────────────────────

function deriveStatus(totalTasks: number, doneTasks: number, itemStatus: string) {
  if (itemStatus === "published") return { label: "Published", color: "bg-emerald-500/10 text-emerald-600" };
  if (itemStatus === "spiked") return { label: "Spiked", color: "bg-red-500/10 text-red-500" };
  if (totalTasks === 0) return { label: "No Tasks", color: "bg-muted text-muted-foreground" };
  if (doneTasks === totalTasks) return { label: "Complete", color: "bg-green-500/10 text-green-600" };
  if (doneTasks > 0) return { label: "In Progress", color: "bg-blue-500/10 text-blue-600" };
  return { label: "Not Started", color: "bg-gray-500/10 text-gray-500" };
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "\u2014";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "\u2014";
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;

    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return "\u2014";
  }
}

function formatDeadline(dateStr: string | null) {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / 86400000);

    const dateLabel = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

    if (diffDays < 0) return { label: `${dateLabel} (overdue)`, isOverdue: true };
    if (diffDays === 0) return { label: `${dateLabel} (today)`, isOverdue: false };
    if (diffDays <= 3) return { label: `${dateLabel} (${diffDays}d)`, isOverdue: false };
    return { label: dateLabel, isOverdue: false };
  } catch {
    return null;
  }
}

// Category → left-border colour
const categoryBorderColors: Record<string, string> = {
  Written: "border-l-blue-500",
  Video: "border-l-red-500",
  Visual: "border-l-pink-500",
  Strategy: "border-l-gray-400",
  Other: "border-l-gray-300",
};

// ── Filter Chip component ────────────────────────────────────────────

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 text-blue-700 px-2.5 py-1 text-xs font-medium">
      {label}
      <button onClick={onClear} className="hover:bg-blue-500/20 rounded-full p-0.5 -mr-1 transition-colors">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ── Sort options ─────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { value: "commissioned_desc", label: "Commissioned (newest)" },
  { value: "commissioned_asc", label: "Commissioned (oldest)" },
  { value: "updated_desc", label: "Last Updated" },
  { value: "deadline_asc", label: "Deadline (soonest)" },
  { value: "completed_desc", label: "Completed Date" },
];

// ── Sidebar status mapping ───────────────────────────────────────────

const sidebarStatusMap: Record<string, string> = {
  "in-progress": "in_progress",
};

// ── Main Content ─────────────────────────────────────────────────────

function ContentPageContent() {
  const customerCtx = useCustomerSafe();
  const selectedCustomerId = customerCtx?.selectedCustomerId ?? null;

  const router = useRouter();
  const searchParams = useSearchParams();
  const statusParam = searchParams.get("status");
  const isInProgressView = statusParam === "in-progress";
  const isAllContentView = !statusParam;

  // Data
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerFilter, setCustomerFilter] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [formatFilter, setFormatFilter] = useState("all");
  const [contractFilter, setContractFilter] = useState("");
  const [cuMin, setCuMin] = useState("");
  const [cuMax, setCuMax] = useState("");
  const [currentTaskFilter, setCurrentTaskFilter] = useState("");
  const [commissionedAfter, setCommissionedAfter] = useState("");
  const [contentLeadFilter, setContentLeadFilter] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const advancedRef = useRef<HTMLDivElement>(null);

  // Sort
  const [sortBy, setSortBy] = useState("commissioned_desc");

  // Close advanced popover on outside click
  useEffect(() => {
    if (!showAdvancedFilters) return;
    function handleClick(e: MouseEvent) {
      if (advancedRef.current && !advancedRef.current.contains(e.target as Node)) {
        setShowAdvancedFilters(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showAdvancedFilters]);

  // Fetch customers for filter
  useEffect(() => {
    fetch("/api/customers?status=active&limit=200")
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers || []))
      .catch(() => {});
  }, []);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    try {
      let url = "/api/content-objects?limit=200";
      const effectiveCustomerId = selectedCustomerId || customerFilter;
      if (effectiveCustomerId) url += `&customerId=${effectiveCustomerId}`;
      const res = await fetch(url);
      const data = await res.json();
      setItems(data.contentObjects || []);
    } catch (err) {
      console.error("Failed to fetch content:", err);
    } finally {
      setLoading(false);
    }
  }, [customerFilter, selectedCustomerId]);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  // ── Derive filter options from data ──

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.contentType) set.add(categorizeContentType(item.contentType));
    }
    return CATEGORY_ORDER.filter((c) => set.has(c));
  }, [items]);

  const availableFormats = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.contentType) {
        if (categoryFilter === "all" || categorizeContentType(item.contentType) === categoryFilter) {
          set.add(item.contentType);
        }
      }
    }
    return Array.from(set).sort();
  }, [items, categoryFilter]);

  const availableContracts = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      if (item.contractId && item.contractName) {
        map.set(item.contractId, item.contractName);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const availableTaskTypes = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.currentTask?.type) set.add(item.currentTask.type);
    }
    return Array.from(set).sort();
  }, [items]);

  const availableLeads = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.contentLeadName) set.add(item.contentLeadName);
    }
    return Array.from(set).sort();
  }, [items]);

  // Count active advanced filters
  const advancedFilterCount = [cuMin, cuMax, currentTaskFilter, commissionedAfter, contentLeadFilter].filter(Boolean).length;

  const hasAnyFilter = categoryFilter !== "all" || formatFilter !== "all" || contractFilter || cuMin || cuMax || currentTaskFilter || commissionedAfter || contentLeadFilter || search;

  function clearAllFilters() {
    setCategoryFilter("all");
    setFormatFilter("all");
    setContractFilter("");
    setCuMin("");
    setCuMax("");
    setCurrentTaskFilter("");
    setCommissionedAfter("");
    setContentLeadFilter("");
    setSearch("");
  }

  // ── Filter + Sort ──

  const filtered = useMemo(() => {
    let result = items;

    // View mode filter (from sidebar URL param)
    if (isInProgressView) {
      result = result.filter((i) => {
        if (i.status === "published" || i.status === "spiked") return false;
        const total = Number(i.totalTasks) || 0;
        const done = Number(i.doneTasks) || 0;
        // Include items that are actively in the pipeline (not completed)
        if (total === 0) return true; // no tasks yet — still needs work
        return done < total; // exclude fully completed
      });
    }

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) =>
          (i.workingTitle || "").toLowerCase().includes(q) ||
          (i.contentType || "").toLowerCase().includes(q) ||
          (i.customerName || "").toLowerCase().includes(q) ||
          (i.contentLeadName || "").toLowerCase().includes(q) ||
          (i.contractName || "").toLowerCase().includes(q) ||
          (i.currentTask?.type || "").toLowerCase().includes(q)
      );
    }

    // Category filter
    if (categoryFilter !== "all") {
      result = result.filter((i) => categorizeContentType(i.contentType || "") === categoryFilter);
    }

    // Format filter (specific content type)
    if (formatFilter !== "all") {
      result = result.filter((i) => i.contentType === formatFilter);
    }

    // Contract filter
    if (contractFilter) {
      result = result.filter((i) => i.contractId === contractFilter);
    }

    // CU range
    if (cuMin) {
      const min = Number(cuMin);
      result = result.filter((i) => (i.contentUnits || 0) >= min);
    }
    if (cuMax) {
      const max = Number(cuMax);
      result = result.filter((i) => (i.contentUnits || 0) <= max);
    }

    // Current task type
    if (currentTaskFilter) {
      result = result.filter((i) => i.currentTask?.type === currentTaskFilter);
    }

    // Commissioned after date
    if (commissionedAfter) {
      const after = new Date(commissionedAfter).getTime();
      result = result.filter((i) => i.createdAt && new Date(i.createdAt).getTime() >= after);
    }

    // Content lead
    if (contentLeadFilter) {
      result = result.filter((i) => i.contentLeadName === contentLeadFilter);
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case "commissioned_asc":
          return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
        case "updated_desc":
          return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
        case "deadline_asc": {
          const dA = a.deadlineProduction ? new Date(a.deadlineProduction).getTime() : Infinity;
          const dB = b.deadlineProduction ? new Date(b.deadlineProduction).getTime() : Infinity;
          return dA - dB;
        }
        case "completed_desc":
          return new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime();
        default: // commissioned_desc
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      }
    });

    return result;
  }, [items, search, categoryFilter, formatFilter, contractFilter, cuMin, cuMax, currentTaskFilter, commissionedAfter, contentLeadFilter, sortBy, isInProgressView]);

  // ── Stats ──

  const stats = useMemo(() => {
    const source = isInProgressView ? filtered : items;
    const total = filtered.length;
    const inProgress = items.filter((i) => {
      const t = Number(i.totalTasks) || 0;
      const d = Number(i.doneTasks) || 0;
      return i.status !== "published" && i.status !== "spiked" && d > 0 && d < t;
    }).length;

    // Due this week
    const now = new Date();
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
    const dueThisWeek = items.filter((i) => {
      if (!i.deadlineProduction || i.status === "published" || i.status === "spiked") return false;
      const d = new Date(i.deadlineProduction);
      return d.getTime() >= now.getTime() && d.getTime() <= endOfWeek.getTime();
    }).length;

    const overdue = items.filter((i) => {
      if (!i.deadlineProduction || i.status === "published" || i.status === "spiked") return false;
      const total = Number(i.totalTasks) || 0;
      const done = Number(i.doneTasks) || 0;
      if (total > 0 && done === total) return false;
      return new Date(i.deadlineProduction).getTime() < Date.now();
    }).length;

    const fastTurnaround = items.filter((i) => i.isFastTurnaround && i.status !== "published" && i.status !== "spiked").length;

    return { total, inProgress, dueThisWeek, overdue, fastTurnaround };
  }, [items, filtered, isInProgressView]);

  // Available sort options (conditional on view)
  const sortOptions = useMemo(() => {
    return SORT_OPTIONS.filter((o) => {
      if (o.value === "completed_desc" && isInProgressView) return false;
      return true;
    });
  }, [isInProgressView]);

  return (
    <div className="space-y-5 max-w-7xl">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <FileText className="h-6 w-6 text-blue-500" />
            {isInProgressView ? "Content in Progress" : "All Content"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isInProgressView
              ? `${stats.total} item${stats.total !== 1 ? "s" : ""} currently in production`
              : `${items.length} content item${items.length !== 1 ? "s" : ""} across all stages`}
          </p>
        </div>
        <Link href="/ideas">
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Commission an Idea
          </Button>
        </Link>
      </div>

      {/* ── Stats cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3 px-4">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">{isInProgressView ? "In Pipeline" : "Total Items"}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3 px-4">
            <p className="text-2xl font-bold text-blue-600">{stats.dueThisWeek}</p>
            <p className="text-xs text-muted-foreground">Due This Week</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3 px-4">
            <p className={cn("text-2xl font-bold", stats.overdue > 0 ? "text-red-600" : "text-gray-400")}>
              {stats.overdue}
            </p>
            <p className="text-xs text-muted-foreground">Overdue</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3 px-4">
            <p className={cn("text-2xl font-bold", stats.fastTurnaround > 0 ? "text-amber-600" : "text-gray-400")}>
              {stats.fastTurnaround}
            </p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Zap className="h-3 w-3" /> Fast Turnaround
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Filter Bar ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search content..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Category dropdown */}
          {availableCategories.length > 1 && (
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setFormatFilter("all"); // reset format when category changes
              }}
              className="h-9 rounded-md border bg-background px-3 text-sm min-w-[130px]"
            >
              <option value="all">All Categories</option>
              {availableCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}

          {/* Format (specific content type) dropdown */}
          {availableFormats.length > 1 && (
            <select
              value={formatFilter}
              onChange={(e) => setFormatFilter(e.target.value)}
              className="h-9 rounded-md border bg-background px-3 text-sm min-w-[130px] capitalize"
            >
              <option value="all">All Formats</option>
              {availableFormats.map((f) => (
                <option key={f} value={f} className="capitalize">{f.replace(/_/g, " ")}</option>
              ))}
            </select>
          )}

          {/* Contract dropdown */}
          {availableContracts.length > 0 && (
            <select
              value={contractFilter}
              onChange={(e) => setContractFilter(e.target.value)}
              className="h-9 rounded-md border bg-background px-3 text-sm min-w-[140px] max-w-[200px]"
            >
              <option value="">All Contracts</option>
              {availableContracts.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}

          {/* Customer filter (only show if no context customer) */}
          {!selectedCustomerId && customers.length > 0 && (
            <select
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="h-9 rounded-md border bg-background px-3 text-sm min-w-[140px] max-w-[200px]"
            >
              <option value="">All Customers</option>
              {customers.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}

          {/* + Filters button */}
          <div className="relative" ref={advancedRef}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className={cn("gap-1.5", advancedFilterCount > 0 && "border-blue-500 text-blue-600")}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
              {advancedFilterCount > 0 && (
                <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white px-1">
                  {advancedFilterCount}
                </span>
              )}
            </Button>

            {/* Advanced filters popover */}
            {showAdvancedFilters && (
              <div className="absolute right-0 top-full mt-2 z-50 w-72 rounded-lg border bg-background shadow-lg p-4 space-y-4">
                {/* CU Value range */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">CU Value</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      placeholder="Min"
                      value={cuMin}
                      onChange={(e) => setCuMin(e.target.value)}
                      className="h-8 text-sm"
                      min="0"
                      step="0.5"
                    />
                    <span className="text-muted-foreground text-xs">\u2014</span>
                    <Input
                      type="number"
                      placeholder="Max"
                      value={cuMax}
                      onChange={(e) => setCuMax(e.target.value)}
                      className="h-8 text-sm"
                      min="0"
                      step="0.5"
                    />
                  </div>
                </div>

                {/* Current Task */}
                {availableTaskTypes.length > 0 && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Current Task</label>
                    <select
                      value={currentTaskFilter}
                      onChange={(e) => setCurrentTaskFilter(e.target.value)}
                      className="w-full h-8 rounded-md border bg-background px-2.5 text-sm"
                    >
                      <option value="">All Tasks</option>
                      {availableTaskTypes.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Commissioned After */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Commissioned After</label>
                  <Input
                    type="date"
                    value={commissionedAfter}
                    onChange={(e) => setCommissionedAfter(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>

                {/* Content Lead */}
                {availableLeads.length > 0 && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Content Lead</label>
                    <select
                      value={contentLeadFilter}
                      onChange={(e) => setContentLeadFilter(e.target.value)}
                      className="w-full h-8 rounded-md border bg-background px-2.5 text-sm"
                    >
                      <option value="">All Leads</option>
                      {availableLeads.map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-between pt-2 border-t">
                  <button
                    onClick={() => {
                      setCuMin("");
                      setCuMax("");
                      setCurrentTaskFilter("");
                      setCommissionedAfter("");
                      setContentLeadFilter("");
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear filters
                  </button>
                  <Button
                    size="sm"
                    onClick={() => setShowAdvancedFilters(false)}
                    className="h-7 text-xs"
                  >
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1" />

          {/* Sort dropdown */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {/* Results count */}
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {filtered.length} item{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* ── Active filter chips ── */}
        {hasAnyFilter && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {search && (
              <FilterChip label={`Search: "${search}"`} onClear={() => setSearch("")} />
            )}
            {categoryFilter !== "all" && (
              <FilterChip label={`Category: ${categoryFilter}`} onClear={() => { setCategoryFilter("all"); setFormatFilter("all"); }} />
            )}
            {formatFilter !== "all" && (
              <FilterChip label={`Format: ${formatFilter.replace(/_/g, " ")}`} onClear={() => setFormatFilter("all")} />
            )}
            {contractFilter && (
              <FilterChip
                label={`Contract: ${availableContracts.find(([id]) => id === contractFilter)?.[1] || contractFilter}`}
                onClear={() => setContractFilter("")}
              />
            )}
            {cuMin && <FilterChip label={`CU \u2265 ${cuMin}`} onClear={() => setCuMin("")} />}
            {cuMax && <FilterChip label={`CU \u2264 ${cuMax}`} onClear={() => setCuMax("")} />}
            {currentTaskFilter && (
              <FilterChip label={`Task: ${currentTaskFilter}`} onClear={() => setCurrentTaskFilter("")} />
            )}
            {commissionedAfter && (
              <FilterChip
                label={`After: ${new Date(commissionedAfter).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
                onClear={() => setCommissionedAfter("")}
              />
            )}
            {contentLeadFilter && (
              <FilterChip label={`Lead: ${contentLeadFilter}`} onClear={() => setContentLeadFilter("")} />
            )}
            <button
              onClick={clearAllFilters}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* ── Content Table ── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold mb-2">
              {items.length === 0 ? "No content yet" : "No content matches filters"}
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              {items.length === 0
                ? "Commission an idea to start producing content"
                : "Try adjusting your search or filters"}
            </p>
            {items.length === 0 && (
              <Link href="/ideas">
                <Button size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Go to Ideas
                </Button>
              </Link>
            )}
            {items.length > 0 && hasAnyFilter && (
              <Button variant="outline" size="sm" onClick={clearAllFilters} className="gap-2">
                <X className="h-4 w-4" />
                Clear Filters
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground w-4"></th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground">Title</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground">Customer</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground">Type</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground">Contract</th>
                  <th className="text-center px-3 py-3 font-medium text-muted-foreground">CU</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground">Current Task</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground">Progress</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground">Deadline</th>
                  <th className="text-left px-3 py-3 font-medium text-muted-foreground">Commissioned</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const total = Number(item.totalTasks) || 0;
                  const done = Number(item.doneTasks) || 0;
                  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                  const status = deriveStatus(total, done, item.status);
                  const deadline = formatDeadline(item.deadlineProduction);
                  const category = categorizeContentType(item.contentType || "");
                  const borderColor = categoryBorderColors[category] || categoryBorderColors.Other;
                  const isOverdue = deadline?.isOverdue && item.status !== "published" && item.status !== "spiked";

                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        "border-b hover:bg-muted/50 cursor-pointer transition-colors",
                        isOverdue && "bg-red-500/[0.03]"
                      )}
                      onClick={() => router.push(`/content/${item.id}`)}
                    >
                      {/* Category colour bar */}
                      <td className={cn("w-1 px-0 border-l-[3px]", borderColor)} />

                      {/* Title */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate max-w-[220px]">
                            {item.workingTitle || "Untitled"}
                          </p>
                          {item.isFastTurnaround && (
                            <span title="Fast turnaround"><Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" /></span>
                          )}
                        </div>
                        {item.contentLeadName && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                            <User className="h-2.5 w-2.5" />
                            {item.contentLeadName}
                          </p>
                        )}
                      </td>

                      {/* Customer */}
                      <td className="px-3 py-3">
                        {item.customerName ? (
                          <span className="text-xs text-emerald-600 bg-emerald-500/10 rounded-full px-2 py-0.5 font-medium whitespace-nowrap">
                            {item.customerName}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{"\u2014"}</span>
                        )}
                      </td>

                      {/* Type */}
                      <td className="px-3 py-3">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "border-0 text-[10px] capitalize whitespace-nowrap",
                            typeColors[item.contentType?.toLowerCase()] || typeColors.other
                          )}
                        >
                          {(item.contentType || "\u2014").replace(/_/g, " ")}
                        </Badge>
                      </td>

                      {/* Contract */}
                      <td className="px-3 py-3">
                        {item.contractName ? (
                          <span className="text-xs text-violet-600 bg-violet-500/10 rounded-full px-2 py-0.5 font-medium whitespace-nowrap truncate max-w-[120px] inline-block">
                            {item.contractName}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{"\u2014"}</span>
                        )}
                      </td>

                      {/* CU */}
                      <td className="px-3 py-3 text-center">
                        {item.contentUnits > 0 ? (
                          <span className="text-xs font-medium bg-muted rounded-md px-1.5 py-0.5">
                            {item.contentUnits}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{"\u2014"}</span>
                        )}
                      </td>

                      {/* Current Task */}
                      <td className="px-3 py-3">
                        {item.currentTask ? (
                          <div>
                            <p className="text-xs font-medium truncate max-w-[140px]">
                              {item.currentTask.type}
                            </p>
                            {item.currentTask.assignee && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                {item.currentTask.assignee}
                              </p>
                            )}
                          </div>
                        ) : item.status === "published" ? (
                          <span className="text-xs text-emerald-600 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Published
                          </span>
                        ) : total > 0 && done === total ? (
                          <span className="text-xs text-green-600 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            All done
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{"\u2014"}</span>
                        )}
                      </td>

                      {/* Production progress */}
                      <td className="px-3 py-3">
                        {total > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all",
                                  pct === 100 ? "bg-green-500" : "bg-blue-500"
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {done}/{total}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No tasks</span>
                        )}
                      </td>

                      {/* Deadline */}
                      <td className="px-3 py-3">
                        {deadline ? (
                          <span
                            className={cn(
                              "text-xs flex items-center gap-1 whitespace-nowrap",
                              deadline.isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"
                            )}
                          >
                            {deadline.isOverdue && <AlertCircle className="h-3 w-3" />}
                            {deadline.label}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{"\u2014"}</span>
                        )}
                      </td>

                      {/* Commissioned date */}
                      <td className="px-3 py-3 text-muted-foreground text-xs whitespace-nowrap">
                        {formatDate(item.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function ContentPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <ContentPageContent />
    </Suspense>
  );
}
