"use client";

import { useState, useEffect, useCallback, Suspense, useMemo } from "react";
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
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";
import { typeColors } from "@/lib/content-type-utils";

function deriveStatus(totalTasks: number, doneTasks: number, itemStatus: string) {
  if (itemStatus === "published") return { label: "Published", color: "bg-emerald-500/10 text-emerald-600" };
  if (itemStatus === "spiked") return { label: "Spiked", color: "bg-red-500/10 text-red-500" };
  if (totalTasks === 0) return { label: "No Tasks", color: "bg-muted text-muted-foreground" };
  if (doneTasks === totalTasks) return { label: "Complete", color: "bg-green-500/10 text-green-600" };
  if (doneTasks > 0) return { label: "In Progress", color: "bg-blue-500/10 text-blue-600" };
  return { label: "Not Started", color: "bg-gray-500/10 text-gray-500" };
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "—";
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
    return "—";
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

    if (diffDays < 0) return { label: `${dateLabel} (overdue)`, isOverdue: true, isPast: true };
    if (diffDays === 0) return { label: `${dateLabel} (today)`, isOverdue: false, isPast: false };
    if (diffDays <= 3) return { label: `${dateLabel} (${diffDays}d)`, isOverdue: false, isPast: false };
    return { label: dateLabel, isOverdue: false, isPast: false };
  } catch {
    return null;
  }
}

const filterTabs = ["all", "not_started", "in_progress", "complete", "published", "spiked"];

const sidebarStatusMap: Record<string, string> = {
  "in-progress": "in_progress",
};

function ContentPageContent() {
  const customerCtx = useCustomerSafe();
  const selectedCustomerId = customerCtx?.selectedCustomerId ?? null;

  const router = useRouter();
  const searchParams = useSearchParams();
  const statusParam = searchParams.get("status");
  const initialTab = statusParam ? (sidebarStatusMap[statusParam] || statusParam.replace("-", "_")) : "all";

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerFilter, setCustomerFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "deadline">("newest");

  // Sync URL param changes
  useEffect(() => {
    const newTab = statusParam ? (sidebarStatusMap[statusParam] || statusParam.replace("-", "_")) : "all";
    setActiveTab(newTab);
  }, [statusParam]);

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
      // Context customer overrides local filter when set
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

  // Derive available content types
  const availableTypes = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.contentType) set.add(item.contentType);
    }
    return Array.from(set).sort();
  }, [items]);

  // Filter + sort
  const filtered = useMemo(() => {
    let result = items;

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) =>
          (i.workingTitle || "").toLowerCase().includes(q) ||
          (i.contentType || "").toLowerCase().includes(q) ||
          (i.customerName || "").toLowerCase().includes(q) ||
          (i.contentLeadName || "").toLowerCase().includes(q) ||
          (i.currentTask?.type || "").toLowerCase().includes(q)
      );
    }

    // Content type filter
    if (typeFilter !== "all") {
      result = result.filter((i) => i.contentType === typeFilter);
    }

    // Status tab filter
    if (activeTab !== "all") {
      result = result.filter((i) => {
        const total = Number(i.totalTasks) || 0;
        const done = Number(i.doneTasks) || 0;

        if (activeTab === "published") return i.status === "published";
        if (activeTab === "spiked") return i.status === "spiked";
        if (activeTab === "not_started") return i.status !== "published" && i.status !== "spiked" && (total === 0 || done === 0);
        if (activeTab === "in_progress") return i.status !== "published" && i.status !== "spiked" && done > 0 && done < total;
        if (activeTab === "complete") return i.status !== "spiked" && total > 0 && done === total;
        return true;
      });
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sortBy === "oldest") {
        return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      }
      if (sortBy === "deadline") {
        const deadA = a.deadlineProduction ? new Date(a.deadlineProduction).getTime() : Infinity;
        const deadB = b.deadlineProduction ? new Date(b.deadlineProduction).getTime() : Infinity;
        return deadA - deadB;
      }
      // newest (default)
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });

    return result;
  }, [items, search, typeFilter, activeTab, sortBy]);

  // Stats
  const stats = useMemo(() => {
    const total = items.length;
    const inProgress = items.filter((i) => {
      const t = Number(i.totalTasks) || 0;
      const d = Number(i.doneTasks) || 0;
      return i.status !== "published" && i.status !== "spiked" && d > 0 && d < t;
    }).length;
    const published = items.filter((i) => i.status === "published").length;
    const overdue = items.filter((i) => {
      if (!i.deadlineProduction || i.status === "published" || i.status === "spiked") return false;
      return new Date(i.deadlineProduction).getTime() < Date.now();
    }).length;
    return { total, inProgress, published, overdue };
  }, [items]);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-blue-500" />
            Content
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage content through the production pipeline
          </p>
        </div>
        <Link href="/ideas">
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Commission an Idea
          </Button>
        </Link>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3 px-4">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total Items</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3 px-4">
            <p className="text-2xl font-bold text-blue-600">{stats.inProgress}</p>
            <p className="text-xs text-muted-foreground">In Progress</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-3 px-4">
            <p className="text-2xl font-bold text-emerald-600">{stats.published}</p>
            <p className="text-xs text-muted-foreground">Published</p>
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
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            {filterTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  activeTab === tab
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab === "not_started"
                  ? "Not Started"
                  : tab === "in_progress"
                    ? "In Progress"
                    : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          <div className="relative flex-1 max-w-sm">
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
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Content type filter */}
          {availableTypes.length > 1 && (
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="all">All types</option>
              {availableTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}

          {/* Customer filter (only show if no context customer) */}
          {!selectedCustomerId && customers.length > 0 && (
            <select
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">All Customers</option>
              {customers.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}

          <div className="flex-1" />

          {/* Sort */}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setSortBy((prev) =>
                prev === "newest" ? "deadline" : prev === "deadline" ? "oldest" : "newest"
              )
            }
            className="gap-1.5"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {sortBy === "newest" ? "Newest" : sortBy === "deadline" ? "Deadline" : "Oldest"}
          </Button>

          {/* Results count */}
          <span className="text-xs text-muted-foreground">
            {filtered.length} items
          </span>
        </div>
      </div>

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
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Title
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Customer
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Current Task
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Production
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Deadline
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const total = Number(item.totalTasks) || 0;
                  const done = Number(item.doneTasks) || 0;
                  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                  const status = deriveStatus(total, done, item.status);
                  const deadline = formatDeadline(item.deadlineProduction);

                  return (
                    <tr
                      key={item.id}
                      className="border-b hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => router.push(`/content/${item.id}`)}
                    >
                      {/* Title */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate max-w-xs">
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
                      <td className="px-4 py-3">
                        {item.customerName ? (
                          <span className="text-xs text-emerald-600 bg-emerald-500/10 rounded-full px-2 py-0.5 font-medium">
                            {item.customerName}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Type */}
                      <td className="px-4 py-3">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "border-0 text-[10px] capitalize",
                            typeColors[item.contentType?.toLowerCase()] || typeColors.other
                          )}
                        >
                          {item.contentType || "—"}
                        </Badge>
                      </td>

                      {/* Current Task */}
                      <td className="px-4 py-3">
                        {item.currentTask ? (
                          <div>
                            <p className="text-xs font-medium truncate max-w-[160px]">
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
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Production progress */}
                      <td className="px-4 py-3">
                        {total > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
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
                            {pct === 100 && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            No tasks
                          </span>
                        )}
                      </td>

                      {/* Deadline */}
                      <td className="px-4 py-3">
                        {deadline ? (
                          <span
                            className={cn(
                              "text-xs flex items-center gap-1",
                              deadline.isOverdue
                                ? "text-red-600 font-medium"
                                : "text-muted-foreground"
                            )}
                          >
                            {deadline.isOverdue && (
                              <AlertCircle className="h-3 w-3" />
                            )}
                            {deadline.label}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Created */}
                      <td className="px-4 py-3 text-muted-foreground text-xs">
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
