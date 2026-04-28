"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Package,
  Users,
  CalendarDays,
  X,
  Search,
  FileText,
  CheckCircle2,
  Clock,
  Ban,
  ExternalLink,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadCSV } from "@/lib/csv-utils";
import { MultiSelectFilter, type MultiSelectOption } from "@/components/operations/MultiSelectFilter";
import {
  categorizeContentType,
  getCategoryFilterOptions,
  getFormatFilterOptions,
} from "@/lib/content-type-utils";

/* ─────────────── Types ─────────────── */

interface TaskRow {
  taskId: string;
  source: "content" | "social";
  contentId: string | null;
  contractId: string | null;
  taskTitle: string;
  taskCUs: number;
  taskCreatedAt: string;
  taskCompletedAt: string | null;
  taskStatus: string;
  assigneeName: string | null;
  contentTitle: string;
  contentType: string;
  customerId: string | null;
  customerName: string;
  contractName: string | null;
  contentStatus: string;
  contentLeadName: string | null;
  commissionedByName: string | null;
}

type ContentStatus = "delivered" | "in_progress" | "spiked";

interface ContentRow {
  rowKey: string;
  contentId: string;
  contentTitle: string;
  contentType: string;
  customerId: string | null;
  customerName: string;
  contractId: string | null;
  contractName: string | null;
  totalCUs: number;
  taskCount: number;
  status: ContentStatus;
  assignees: string[];
  commissionedByName: string | null;
  contentLeadName: string | null;
  firstCreatedAt: string;
  lastCompletedAt: string | null;
  source: "content" | "social";
  // Flat fields for sorting
  assigneesDisplay: string;
}

/* ─────────────── Helpers ─────────────── */

const getThisQuarterRange = () => {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3);
  return {
    from: new Date(d.getFullYear(), q * 3, 1).toISOString().split("T")[0],
    to: new Date(d.getFullYear(), q * 3 + 3, 0).toISOString().split("T")[0],
  };
};

const presets = [
  {
    label: "This Month",
    getRange: () => {
      const d = new Date();
      return {
        from: new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0],
        to: new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split("T")[0],
      };
    },
  },
  {
    label: "Last Month",
    getRange: () => {
      const d = new Date();
      return {
        from: new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().split("T")[0],
        to: new Date(d.getFullYear(), d.getMonth(), 0).toISOString().split("T")[0],
      };
    },
  },
  { label: "This Quarter", getRange: getThisQuarterRange },
  {
    label: "This Year",
    getRange: () => {
      const y = new Date().getFullYear();
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    },
  },
];

const fmtDate = (d: string | null) => {
  if (!d) return "\u2014";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
};

const prettyType = (s: string) => s.replace(/_/g, " ");
const titleCase = (s: string) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

/* ─── Sortable header ─── */
function SortHeader({ label, sortKey, currentSort, currentAsc, onSort, align = "left" }: {
  label: string;
  sortKey: string;
  currentSort: string;
  currentAsc: boolean;
  onSort: (key: string) => void;
  align?: "left" | "right" | "center";
}) {
  const active = currentSort === sortKey;
  return (
    <th
      className={cn(
        "px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors group",
        align === "right" && "text-right",
        align === "center" && "text-center",
        active && "text-foreground"
      )}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active ? (
          currentAsc ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />
        ) : (
          <ArrowUpDown className="h-2.5 w-2.5 opacity-0 group-hover:opacity-40 transition-opacity" />
        )}
      </span>
    </th>
  );
}

function useSort(defaultKey: string, defaultAsc = true) {
  const [currentSort, setCurrentSort] = useState(defaultKey);
  const [currentAsc, setCurrentAsc] = useState(defaultAsc);
  const toggle = (key: string) => {
    if (currentSort === key) setCurrentAsc(!currentAsc);
    else { setCurrentSort(key); setCurrentAsc(true); }
  };
  return { currentSort, currentAsc, toggle };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sortRows<T extends Record<string, any>>(rows: T[], key: string, asc: boolean): T[] {
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    let cmp = 0;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return asc ? cmp : -cmp;
  });
}

/* ─────────────── Component ─────────────── */

export default function AllContentPage() {
  const initRange = getThisQuarterRange();

  const [allTasks, setAllTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [dateFrom, setDateFrom] = useState(initRange.from);
  const [dateTo, setDateTo] = useState(initRange.to);
  const [activePreset, setActivePreset] = useState<string | null>("This Quarter");

  const [searchQuery, setSearchQuery] = useState("");
  const [excludeTestClients, setExcludeTestClients] = useState(true);
  const EXCLUDE_CLIENT_IDS = "1,2";

  const [selectedCustomers, setSelectedCustomers] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedFormats, setSelectedFormats] = useState<Set<string>>(new Set());
  const [selectedAssignees, setSelectedAssignees] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<"all" | ContentStatus>("all");
  const [cuMin, setCuMin] = useState<string>("");
  const [cuMax, setCuMax] = useState<string>("");
  const autoSelectedRef = useRef({ customers: false, categories: false, formats: false, assignees: false });

  const sortState = useSort("firstCreatedAt", false);

  /* ─── Fetch ─── */
  const fetchTasks = useCallback(async (from: string, to: string, excludeClients: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (excludeClients) params.set("excludeClients", EXCLUDE_CLIENT_IDS);
      const res = await fetch(`/api/operations/commissioned-cus?${params.toString()}`);
      const data = await res.json();
      setAllTasks(data.tasks || []);
      autoSelectedRef.current = { customers: false, categories: false, formats: false, assignees: false };
    } catch (err) {
      console.error("Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks(dateFrom, dateTo, excludeTestClients);
  }, [dateFrom, dateTo, excludeTestClients, fetchTasks]);

  const applyPreset = (preset: (typeof presets)[0]) => {
    const range = preset.getRange();
    setDateFrom(range.from);
    setDateTo(range.to);
    setActivePreset(preset.label);
  };

  const clearDates = () => {
    setDateFrom("");
    setDateTo("");
    setActivePreset(null);
  };

  /* ─── Aggregate tasks into content rows ─── */
  const contentRows: ContentRow[] = useMemo(() => {
    const map: Record<string, {
      row: ContentRow;
      anySpiked: boolean;
      allCompleted: boolean;
      latestCompletedAt: string | null;
      assigneeSet: Set<string>;
    }> = {};

    for (const t of allTasks) {
      const key = t.contentId || t.taskId;
      if (!map[key]) {
        map[key] = {
          row: {
            rowKey: key,
            contentId: t.contentId || "",
            contentTitle: t.contentTitle,
            contentType: t.contentType || "unknown",
            customerId: t.customerId,
            customerName: t.customerName,
            contractId: t.contractId,
            contractName: t.contractName,
            totalCUs: 0,
            taskCount: 0,
            status: "in_progress",
            assignees: [],
            commissionedByName: t.commissionedByName,
            contentLeadName: t.contentLeadName,
            firstCreatedAt: t.taskCreatedAt,
            lastCompletedAt: null,
            source: t.source,
            assigneesDisplay: "",
          },
          anySpiked: false,
          allCompleted: true,
          latestCompletedAt: null,
          assigneeSet: new Set<string>(),
        };
      }
      const agg = map[key];
      agg.row.totalCUs += t.taskCUs || 0;
      agg.row.taskCount += 1;
      if (t.taskCreatedAt && (!agg.row.firstCreatedAt || t.taskCreatedAt < agg.row.firstCreatedAt)) {
        agg.row.firstCreatedAt = t.taskCreatedAt;
      }
      if (t.taskCompletedAt) {
        if (!agg.latestCompletedAt || t.taskCompletedAt > agg.latestCompletedAt) {
          agg.latestCompletedAt = t.taskCompletedAt;
        }
      } else {
        agg.allCompleted = false;
      }
      if (t.contentStatus === "spiked") agg.anySpiked = true;
      if (t.assigneeName) agg.assigneeSet.add(t.assigneeName);
    }

    return Object.values(map).map((m) => {
      const row = m.row;
      row.lastCompletedAt = m.latestCompletedAt;
      row.assignees = Array.from(m.assigneeSet).sort();
      row.assigneesDisplay = row.assignees.join(", ");
      row.status = m.anySpiked ? "spiked" : m.allCompleted && m.row.taskCount > 0 ? "delivered" : "in_progress";
      row.totalCUs = Math.round(row.totalCUs * 1000) / 1000;
      return row;
    });
  }, [allTasks]);

  /* ─── Build filter option lists ─── */
  const customerOptions: MultiSelectOption[] = useMemo(() => {
    const map: Record<string, { name: string; count: number }> = {};
    for (const r of contentRows) {
      const id = r.customerId || "__none__";
      if (!map[id]) map[id] = { name: r.customerName || "Unknown", count: 0 };
      map[id].count += 1;
    }
    return Object.entries(map)
      .map(([value, { name, count }]) => ({ value, label: name, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [contentRows]);

  const categoryOptions: MultiSelectOption[] = useMemo(
    () => getCategoryFilterOptions(contentRows),
    [contentRows]
  );

  const formatOptions: MultiSelectOption[] = useMemo(
    () => getFormatFilterOptions(contentRows),
    [contentRows]
  );

  const assigneeOptions: MultiSelectOption[] = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of contentRows) {
      if (r.assignees.length === 0) {
        map["__unassigned__"] = (map["__unassigned__"] || 0) + 1;
        continue;
      }
      for (const a of r.assignees) {
        map[a] = (map[a] || 0) + 1;
      }
    }
    return Object.entries(map)
      .map(([value, count]) => ({
        value,
        label: value === "__unassigned__" ? "Unassigned" : value,
        count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [contentRows]);

  /* ─── Auto-select-all on first populate ─── */
  useEffect(() => {
    if (customerOptions.length > 0 && !autoSelectedRef.current.customers) {
      setSelectedCustomers(new Set(customerOptions.map((o) => o.value)));
      autoSelectedRef.current.customers = true;
    }
  }, [customerOptions]);
  useEffect(() => {
    if (categoryOptions.length > 0 && !autoSelectedRef.current.categories) {
      setSelectedCategories(new Set(categoryOptions.map((o) => o.value)));
      autoSelectedRef.current.categories = true;
    }
  }, [categoryOptions]);
  useEffect(() => {
    if (formatOptions.length > 0 && !autoSelectedRef.current.formats) {
      setSelectedFormats(new Set(formatOptions.map((o) => o.value)));
      autoSelectedRef.current.formats = true;
    }
  }, [formatOptions]);
  useEffect(() => {
    if (assigneeOptions.length > 0 && !autoSelectedRef.current.assignees) {
      setSelectedAssignees(new Set(assigneeOptions.map((o) => o.value)));
      autoSelectedRef.current.assignees = true;
    }
  }, [assigneeOptions]);

  /* ─── Apply filters ─── */
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const minCU = cuMin.trim() === "" ? -Infinity : parseFloat(cuMin);
    const maxCU = cuMax.trim() === "" ? Infinity : parseFloat(cuMax);
    return contentRows.filter((r) => {
      // Status
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      // Customer
      const customerKey = r.customerId || "__none__";
      if (!selectedCustomers.has(customerKey)) return false;
      // Category
      const cat = categorizeContentType(r.contentType || "");
      if (!selectedCategories.has(cat)) return false;
      // Format
      if (!selectedFormats.has(r.contentType || "unknown")) return false;
      // Assignee (OR match — content matches if any of its assignees is selected, or unassigned filter is on)
      if (r.assignees.length === 0) {
        if (!selectedAssignees.has("__unassigned__")) return false;
      } else {
        const anyMatch = r.assignees.some((a) => selectedAssignees.has(a));
        if (!anyMatch) return false;
      }
      // CU range
      if (r.totalCUs < minCU || r.totalCUs > maxCU) return false;
      // Keyword
      if (q) {
        const hay = [
          r.contentTitle,
          r.contentType,
          r.customerName,
          r.contractName || "",
          r.assigneesDisplay,
          r.commissionedByName || "",
          r.contentLeadName || "",
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [contentRows, searchQuery, cuMin, cuMax, statusFilter, selectedCustomers, selectedCategories, selectedFormats, selectedAssignees]);

  const sorted = useMemo(() => sortRows(filtered, sortState.currentSort, sortState.currentAsc), [filtered, sortState.currentSort, sortState.currentAsc]);

  /* ─── Status counts for toggle buttons ─── */
  const statusCounts = useMemo(() => {
    const counts = { all: 0, in_progress: 0, delivered: 0, spiked: 0 };
    // Compute counts with status filter OFF, other filters on
    const q = searchQuery.trim().toLowerCase();
    const minCU = cuMin.trim() === "" ? -Infinity : parseFloat(cuMin);
    const maxCU = cuMax.trim() === "" ? Infinity : parseFloat(cuMax);
    for (const r of contentRows) {
      const customerKey = r.customerId || "__none__";
      if (!selectedCustomers.has(customerKey)) continue;
      const cat = categorizeContentType(r.contentType || "");
      if (!selectedCategories.has(cat)) continue;
      if (!selectedFormats.has(r.contentType || "unknown")) continue;
      if (r.assignees.length === 0) {
        if (!selectedAssignees.has("__unassigned__")) continue;
      } else {
        if (!r.assignees.some((a) => selectedAssignees.has(a))) continue;
      }
      if (r.totalCUs < minCU || r.totalCUs > maxCU) continue;
      if (q) {
        const hay = [r.contentTitle, r.contentType, r.customerName, r.contractName || "", r.assigneesDisplay, r.commissionedByName || "", r.contentLeadName || ""].join(" ").toLowerCase();
        if (!hay.includes(q)) continue;
      }
      counts.all += 1;
      counts[r.status] += 1;
    }
    return counts;
  }, [contentRows, searchQuery, cuMin, cuMax, selectedCustomers, selectedCategories, selectedFormats, selectedAssignees]);

  /* ─── Totals (KPI cards) ─── */
  const totals = useMemo(() => {
    let totalCUs = 0;
    let taskCount = 0;
    const customerIds = new Set<string>();
    for (const r of filtered) {
      totalCUs += r.totalCUs;
      taskCount += r.taskCount;
      if (r.customerId) customerIds.add(r.customerId);
    }
    return {
      totalCUs: Math.round(totalCUs * 10) / 10,
      contentItems: filtered.length,
      tasks: taskCount,
      customers: customerIds.size,
    };
  }, [filtered]);

  const isDateFiltered = dateFrom || dateTo;

  /* ─────────────── Render ─────────────── */
  const statusBadge = (s: ContentStatus) => {
    if (s === "delivered") return <Badge className="bg-green-500/15 text-green-700 hover:bg-green-500/15 border-0 text-[10px]">Delivered</Badge>;
    if (s === "spiked") return <Badge className="bg-red-500/15 text-red-700 hover:bg-red-500/15 border-0 text-[10px]">Spiked</Badge>;
    return <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 border-0 text-[10px]">In Progress</Badge>;
  };

  return (
    <div className="max-w-[1600px] space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">All Content</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Every piece of content {isDateFiltered ? "created in the selected period" : "across all time"}.
          {!loading && ` ${totals.contentItems} items, ${totals.totalCUs.toFixed(1)} CUs across ${totals.customers} customers.`}
        </p>
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          {/* Row 1: Dates + presets */}
          <div className="flex flex-col lg:flex-row lg:items-end gap-4">
            <div className="flex items-end gap-2.5 flex-1 flex-wrap">
              <div className="w-[150px]">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">From</label>
                <div className="relative">
                  <CalendarDays className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
                  <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setActivePreset(null); }} className="h-8 text-xs pl-7" />
                </div>
              </div>
              <span className="text-muted-foreground/30 pb-1.5 text-xs">&ndash;</span>
              <div className="w-[150px]">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">To</label>
                <div className="relative">
                  <CalendarDays className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
                  <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setActivePreset(null); }} className="h-8 text-xs pl-7" />
                </div>
              </div>
              {isDateFiltered && (
                <button onClick={clearDates} className="h-8 px-2 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors shrink-0">
                  <X className="h-3 w-3" /> Clear
                </button>
              )}
              <div className="flex items-center gap-1 ml-2">
                {presets.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => applyPreset(p)}
                    className={cn(
                      "px-2 py-1 rounded text-[11px] font-medium transition-colors",
                      activePreset === p.label ? "bg-foreground text-background" : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative w-full lg:w-[220px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
                <Input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-8 text-xs pl-8" />
              </div>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0 select-none">
                <input type="checkbox" checked={excludeTestClients} onChange={(e) => setExcludeTestClients(e.target.checked)} className="rounded border-muted-foreground/30 h-3.5 w-3.5" />
                Hide TCE and test clients
              </label>
            </div>
          </div>

          {/* Row 2: Multi-selects + CU range */}
          <div className="flex flex-wrap items-end gap-3">
            <MultiSelectFilter label="Customer" options={customerOptions} selected={selectedCustomers} onChange={setSelectedCustomers} allLabel="All customers" />
            <MultiSelectFilter label="Category" options={categoryOptions} selected={selectedCategories} onChange={setSelectedCategories} allLabel="All categories" />
            <MultiSelectFilter label="Format" options={formatOptions} selected={selectedFormats} onChange={setSelectedFormats} allLabel="All formats" />
            <MultiSelectFilter label="Assignee" options={assigneeOptions} selected={selectedAssignees} onChange={setSelectedAssignees} allLabel="All assignees" />
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">CU min</label>
              <Input type="number" step="0.1" placeholder="0" value={cuMin} onChange={(e) => setCuMin(e.target.value)} className="h-8 text-xs w-[90px]" />
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">CU max</label>
              <Input type="number" step="0.1" placeholder={"\u221e"} value={cuMax} onChange={(e) => setCuMax(e.target.value)} className="h-8 text-xs w-[90px]" />
            </div>
            {/* Status toggle */}
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Status</label>
              <div className="inline-flex items-center rounded-md border bg-background p-0.5 text-xs">
                {([
                  { value: "all" as const, label: "All" },
                  { value: "in_progress" as const, label: "In Progress" },
                  { value: "delivered" as const, label: "Delivered" },
                  { value: "spiked" as const, label: "Spiked" },
                ]).map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setStatusFilter(s.value)}
                    className={cn(
                      "px-2 py-1 rounded text-[11px] font-medium transition-colors",
                      statusFilter === s.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {s.label} <span className="opacity-60 tabular-nums">{statusCounts[s.value]}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: Package, color: "text-blue-500", label: "Total CUs", value: totals.totalCUs.toFixed(1) },
              { icon: FileText, color: "text-violet-500", label: "Content Items", value: String(totals.contentItems) },
              { icon: CheckCircle2, color: "text-green-500", label: "Tasks", value: String(totals.tasks) },
              { icon: Users, color: "text-cyan-500", label: "Customers", value: String(totals.customers) },
            ].map((kpi) => (
              <Card key={kpi.label} className="border-0 shadow-sm">
                <CardContent className="p-3.5">
                  <div className="flex items-center gap-2 mb-1">
                    <kpi.icon className={cn("h-3.5 w-3.5", kpi.color)} />
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{kpi.label}</span>
                  </div>
                  <p className="text-2xl font-semibold tabular-nums">{kpi.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Main content table */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="px-4 py-2.5 border-b flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Content ({sorted.length.toLocaleString()})
                </h2>
                {sorted.length > 0 && (
                  <button
                    onClick={() => downloadCSV(
                      sorted.map((r) => ({
                        Content: r.contentTitle,
                        Type: titleCase(prettyType(r.contentType)),
                        Customer: r.customerName,
                        Contract: r.contractName || "",
                        CUs: Math.round(r.totalCUs * 10) / 10,
                        Tasks: r.taskCount,
                        Assignees: r.assigneesDisplay,
                        Status: r.status === "in_progress" ? "In Progress" : titleCase(r.status),
                        "Commissioned By": r.commissionedByName || "",
                        "Content Lead": r.contentLeadName || "",
                        Created: fmtDate(r.firstCreatedAt),
                        Completed: fmtDate(r.lastCompletedAt),
                      })),
                      `all-content-${dateFrom || "all"}-to-${dateTo || "all"}.csv`
                    )}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Download CSV"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {sorted.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-10">No content matches the current filters.</p>
              ) : (
                <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background z-[1]">
                      <tr className="border-b">
                        <SortHeader label="Content" sortKey="contentTitle" {...sortState} onSort={sortState.toggle} />
                        <SortHeader label="Type" sortKey="contentType" {...sortState} onSort={sortState.toggle} />
                        <SortHeader label="Customer" sortKey="customerName" {...sortState} onSort={sortState.toggle} />
                        <SortHeader label="Contract" sortKey="contractName" {...sortState} onSort={sortState.toggle} />
                        <SortHeader label="CUs" sortKey="totalCUs" {...sortState} onSort={sortState.toggle} align="right" />
                        <SortHeader label="Assignees" sortKey="assigneesDisplay" {...sortState} onSort={sortState.toggle} />
                        <SortHeader label="Status" sortKey="status" {...sortState} onSort={sortState.toggle} />
                        <SortHeader label="Created" sortKey="firstCreatedAt" {...sortState} onSort={sortState.toggle} />
                        <SortHeader label="Completed" sortKey="lastCompletedAt" {...sortState} onSort={sortState.toggle} />
                        <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-center">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((r) => {
                        const visibleAssignees = r.assignees.slice(0, 2);
                        const extra = r.assignees.length - visibleAssignees.length;
                        return (
                          <tr key={r.rowKey} className="border-b border-border/50 hover:bg-muted/30">
                            <td className="px-3 py-2 font-medium max-w-[260px] truncate" title={r.contentTitle}>{r.contentTitle}</td>
                            <td className="px-3 py-2 text-muted-foreground capitalize">{prettyType(r.contentType)}</td>
                            <td className="px-3 py-2 text-muted-foreground truncate max-w-[140px]" title={r.customerName}>{r.customerName}</td>
                            <td className="px-3 py-2 text-muted-foreground truncate max-w-[160px]" title={r.contractName || ""}>{r.contractName || "\u2014"}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.totalCUs.toFixed(1)}</td>
                            <td className="px-3 py-2 text-muted-foreground max-w-[180px] truncate" title={r.assigneesDisplay}>
                              {visibleAssignees.length === 0 ? "\u2014" : (
                                <>
                                  {visibleAssignees.join(", ")}
                                  {extra > 0 && <span className="text-muted-foreground/60"> +{extra}</span>}
                                </>
                              )}
                            </td>
                            <td className="px-3 py-2">{statusBadge(r.status)}</td>
                            <td className="px-3 py-2 text-muted-foreground tabular-nums">{fmtDate(r.firstCreatedAt)}</td>
                            <td className="px-3 py-2 text-muted-foreground tabular-nums">{fmtDate(r.lastCompletedAt)}</td>
                            <td className="px-3 py-2 text-center">
                              {r.contentId && (
                                <a href={`https://app.thecontentengine.com/all/contents/${r.contentId}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600">
                                  <ExternalLink className="h-3 w-3 inline" />
                                </a>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
