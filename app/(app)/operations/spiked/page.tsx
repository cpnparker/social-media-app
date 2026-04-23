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
  BarChart3,
  ExternalLink,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Ban,
  CreditCard,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadCSV } from "@/lib/csv-utils";
import { MultiSelectFilter } from "@/components/operations/MultiSelectFilter";
import {
  categorizeContentType,
  getCategoryFilterOptions,
  getFormatFilterOptions,
} from "@/lib/content-type-utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

/* ─────────────── Types ─────────────── */

interface SpikedTaskRow {
  taskId: string;
  source: "content" | "social";
  contentId: string | null;
  contractId: string | null;
  taskTitle: string;
  taskCUs: number;
  taskCreatedAt: string;
  taskCompletedAt: string | null;
  dateSpiked: string | null;
  taskStatus: string;
  assigneeName: string | null;
  contentTitle: string;
  contentType: string;
  customerId: string | null;
  customerName: string;
  contractName: string | null;
}

/* ─────────────── Helpers ─────────────── */

const getThisMonthRange = () => {
  const d = new Date();
  return {
    from: new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0],
    to: new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split("T")[0],
  };
};

const presets = [
  { label: "This Month", getRange: getThisMonthRange },
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
  {
    label: "This Quarter",
    getRange: () => {
      const d = new Date();
      const q = Math.floor(d.getMonth() / 3);
      return {
        from: new Date(d.getFullYear(), q * 3, 1).toISOString().split("T")[0],
        to: new Date(d.getFullYear(), q * 3 + 3, 0).toISOString().split("T")[0],
      };
    },
  },
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

const fmtDay = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const CHART_COLORS = [
  "#3b82f6", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b",
  "#ef4444", "#ec4899", "#6366f1", "#14b8a6", "#f97316",
  "#84cc16", "#a855f7", "#0ea5e9", "#22c55e", "#eab308",
];

// TCE internal client IDs — spiked CUs for these are "not charged" (absorbed)
const TCE_CLIENT_ID = "1";

/* ─── Sortable header helper ─── */
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

type ChargeFilter = "all" | "charged" | "not-charged";

export default function SpikedPage() {
  const initRange = getThisMonthRange();

  const [allTasks, setAllTasks] = useState<SpikedTaskRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [dateFrom, setDateFrom] = useState(initRange.from);
  const [dateTo, setDateTo] = useState(initRange.to);
  const [activePreset, setActivePreset] = useState<string | null>("This Month");

  const [searchQuery, setSearchQuery] = useState("");
  const [excludeTestClients, setExcludeTestClients] = useState(true);

  const [chargeFilter, setChargeFilter] = useState<ChargeFilter>("all");

  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedFormats, setSelectedFormats] = useState<Set<string>>(new Set());
  const autoSelectedTaxonomyRef = useRef({ categories: false, formats: false });

  const custSort = useSort("name", true);
  const contentSort = useSort("dateSpiked", false);

  /* ─── Fetch ─── */
  const fetchTasks = useCallback(async (from: string, to: string, _excludeClients: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      // Note: we handle exclude/charge filtering client-side for flexibility
      const res = await fetch(`/api/operations/spiked?${params.toString()}`);
      const data = await res.json();
      setAllTasks(data.tasks || []);
      autoSelectedTaxonomyRef.current = { categories: false, formats: false };
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

  /* ─── Apply charge filter and exclusions ─── */
  const tasks = useMemo(() => {
    let result = allTasks;

    // Exclude test clients
    if (excludeTestClients) {
      result = result.filter((t) => t.customerId !== "2");
    }

    // Charge filter
    if (chargeFilter === "charged") {
      // Charged = billed to external clients (not TCE)
      result = result.filter((t) => t.customerId !== TCE_CLIENT_ID);
    } else if (chargeFilter === "not-charged") {
      // Not charged = absorbed by TCE
      result = result.filter((t) => t.customerId === TCE_CLIENT_ID);
    }

    return result;
  }, [allTasks, excludeTestClients, chargeFilter]);

  /* ─── Category / Format options (derived from charge-filtered tasks) ─── */
  const categoryOptions = useMemo(() => getCategoryFilterOptions(tasks), [tasks]);
  const formatOptions = useMemo(() => getFormatFilterOptions(tasks), [tasks]);

  /* ─── Auto-select all categories/formats on first populate ─── */
  useEffect(() => {
    if (categoryOptions.length > 0 && !autoSelectedTaxonomyRef.current.categories) {
      setSelectedCategories(new Set(categoryOptions.map((o) => o.value)));
      autoSelectedTaxonomyRef.current.categories = true;
    }
  }, [categoryOptions]);
  useEffect(() => {
    if (formatOptions.length > 0 && !autoSelectedTaxonomyRef.current.formats) {
      setSelectedFormats(new Set(formatOptions.map((o) => o.value)));
      autoSelectedTaxonomyRef.current.formats = true;
    }
  }, [formatOptions]);

  /* ─── Filtered tasks (search + category + format) ─── */
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      const cat = categorizeContentType(t.contentType || "");
      if (!selectedCategories.has(cat)) return false;
      if (!selectedFormats.has(t.contentType || "unknown")) return false;
      if (q) {
        const hit =
          t.contentTitle.toLowerCase().includes(q) ||
          t.customerName.toLowerCase().includes(q) ||
          t.taskTitle.toLowerCase().includes(q) ||
          t.contentType.toLowerCase().includes(q) ||
          (t.assigneeName ? t.assigneeName.toLowerCase().includes(q) : false);
        if (!hit) return false;
      }
      return true;
    });
  }, [tasks, searchQuery, selectedCategories, selectedFormats]);

  /* ─── Totals ─── */
  const totals = useMemo(() => {
    let totalCUs = 0;
    for (const t of filtered) totalCUs += t.taskCUs;

    // Calculate billable (charged) CUs — external clients only
    let billableCUs = 0;
    for (const t of filtered) {
      if (t.customerId !== TCE_CLIENT_ID) billableCUs += t.taskCUs;
    }

    const contentIds = new Set(filtered.map((t) => t.contentId).filter(Boolean));
    const customerIds = new Set(filtered.map((t) => t.customerId).filter(Boolean));
    return { totalCUs, billableCUs, tasks: filtered.length, contentItems: contentIds.size, customers: customerIds.size };
  }, [filtered]);

  const cusByType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of filtered) {
      const type = t.contentType || "other";
      map[type] = (map[type] || 0) + t.taskCUs;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  /* ─── Customer list ─── */
  const customerList = useMemo(() => {
    const map: Record<string, { name: string; cus: number; taskCount: number }> = {};
    for (const t of filtered) {
      const cid = t.customerId || "unassigned";
      if (!map[cid]) map[cid] = { name: t.customerName, cus: 0, taskCount: 0 };
      map[cid].cus += t.taskCUs;
      map[cid].taskCount += 1;
    }
    const list = Object.entries(map).map(([id, d]) => ({ id, ...d }));
    return sortRows(list, custSort.currentSort, custSort.currentAsc);
  }, [filtered, custSort.currentSort, custSort.currentAsc]);

  /* ─── Client chart ─── */
  const clientChartData = useMemo(() => {
    const byCUs = [...customerList].sort((a, b) => b.cus - a.cus).slice(0, 15);
    return byCUs.map((c) => ({
      name: c.name.length > 18 ? c.name.slice(0, 16) + "\u2026" : c.name,
      cus: Math.round(c.cus * 10) / 10,
    }));
  }, [customerList]);

  /* ─── Daily chart (by spike date) ─── */
  const dailyData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of filtered) {
      if (!t.dateSpiked) continue;
      const day = t.dateSpiked.split("T")[0];
      map[day] = (map[day] || 0) + t.taskCUs;
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, cus]) => ({ day: fmtDay(day), cus: Math.round(cus * 10) / 10 }));
  }, [filtered]);

  /* ─── Content list (sorted) ─── */
  const contentList = useMemo(() => {
    const map: Record<string, {
      contentId: string; title: string; type: string; customer: string; customerId: string | null;
      cus: number; dateSpiked: string | null; createdAt: string;
    }> = {};
    for (const t of filtered) {
      const cid = t.contentId || t.taskId;
      if (!map[cid]) {
        map[cid] = {
          contentId: t.contentId || "", title: t.contentTitle, type: t.contentType,
          customer: t.customerName, customerId: t.customerId, cus: 0,
          dateSpiked: t.dateSpiked, createdAt: t.taskCreatedAt,
        };
      }
      map[cid].cus += t.taskCUs;
    }
    return sortRows(Object.values(map), contentSort.currentSort, contentSort.currentAsc);
  }, [filtered, contentSort.currentSort, contentSort.currentAsc]);

  const isFiltered = dateFrom || dateTo;

  /* ─────────────── Render ─────────────── */
  return (
    <div className="max-w-[1400px] space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Spiked Content Units</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Spiked content {isFiltered ? "for the selected period" : "across all time"}.
          {!loading && ` ${totals.tasks} spiked tasks, ${totals.billableCUs.toFixed(1)} billable CUs.`}
        </p>
      </div>

      {/* Filter bar */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-end gap-4">
            <div className="flex items-end gap-2.5 flex-1">
              <div className="w-[160px]">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">From (spiked)</label>
                <div className="relative">
                  <CalendarDays className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
                  <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setActivePreset(null); }} className="h-8 text-xs pl-7" />
                </div>
              </div>
              <span className="text-muted-foreground/30 pb-1.5 text-xs">&ndash;</span>
              <div className="w-[160px]">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">To (spiked)</label>
                <div className="relative">
                  <CalendarDays className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
                  <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setActivePreset(null); }} className="h-8 text-xs pl-7" />
                </div>
              </div>
              {isFiltered && (
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
                Hide test clients
              </label>
            </div>
          </div>

          {/* Charged / Not Charged toggle */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mr-2">Show:</span>
            {([
              { value: "all" as ChargeFilter, label: "All", icon: null },
              { value: "charged" as ChargeFilter, label: "Charged", icon: CreditCard },
              { value: "not-charged" as ChargeFilter, label: "Not Charged", icon: Ban },
            ]).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setChargeFilter(opt.value)}
                className={cn(
                  "px-2.5 py-1 rounded text-[11px] font-medium transition-colors inline-flex items-center gap-1.5",
                  chargeFilter === opt.value
                    ? "bg-foreground text-background"
                    : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.icon && <opt.icon className="h-3 w-3" />}
                {opt.label}
              </button>
            ))}
            <span className="text-[10px] text-muted-foreground ml-2">
              {chargeFilter === "charged" && "(Billed to external clients)"}
              {chargeFilter === "not-charged" && "(Absorbed by TCE)"}
            </span>
          </div>

          {/* Category + Format filters */}
          <div className="flex flex-wrap items-end gap-3">
            <MultiSelectFilter label="Category" options={categoryOptions} selected={selectedCategories} onChange={setSelectedCategories} allLabel="All categories" />
            <MultiSelectFilter label="Format" options={formatOptions} selected={selectedFormats} onChange={setSelectedFormats} allLabel="All formats" />
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
              { icon: Package, color: "text-red-500", label: "Spiked CUs", value: totals.totalCUs.toFixed(1) },
              { icon: CreditCard, color: "text-amber-500", label: "Billable CUs", value: totals.billableCUs.toFixed(1) },
              { icon: FileText, color: "text-violet-500", label: "Content Items", value: String(totals.contentItems) },
              { icon: Users, color: "text-cyan-500", label: "Customers", value: String(totals.customers) },
            ].map((kpi) => (
              <Card key={kpi.label} className="border-0 shadow-sm">
                <CardContent className="p-3.5">
                  <div className="flex items-center gap-2 mb-1">
                    <kpi.icon className={cn("h-3.5 w-3.5", kpi.color)} />
                    <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{kpi.label}</span>
                  </div>
                  <p className="text-2xl font-bold tabular-nums">{kpi.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* CU by type */}
          {cusByType.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground/50" />
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mr-1">CUs by type:</span>
              {cusByType.map(([type, cus]) => (
                <Badge key={type} variant="secondary" className="text-[10px] gap-1 capitalize py-0.5">
                  {type} <span className="font-bold">{cus.toFixed(1)}</span>
                </Badge>
              ))}
            </div>
          )}

          {/* Customers table */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="px-4 py-2.5 border-b flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Spiked CUs by Customer</h2>
                {customerList.length > 0 && (
                  <button onClick={() => downloadCSV(customerList.map(row => ({ Customer: row.name, CUs: Math.round(row.cus * 10) / 10, Tasks: row.taskCount })), "spiked-cus-by-customer.csv")} className="text-muted-foreground hover:text-foreground transition-colors" title="Download CSV">
                    <Download className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {customerList.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No spiked content found.</p>
              ) : (
                <div className="overflow-x-auto max-h-[340px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background z-[1]">
                      <tr className="border-b">
                        <SortHeader label="Customer" sortKey="name" {...custSort} onSort={custSort.toggle} />
                        <SortHeader label="CUs" sortKey="cus" {...custSort} onSort={custSort.toggle} align="right" />
                        <SortHeader label="Tasks" sortKey="taskCount" {...custSort} onSort={custSort.toggle} align="right" />
                      </tr>
                    </thead>
                    <tbody>
                      {customerList.map((c) => (
                        <tr key={c.id} className="border-b border-border/30 hover:bg-muted/40">
                          <td className="px-3 py-2 font-medium">{c.name}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{c.cus.toFixed(1)}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{c.taskCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Spiked Content List */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="px-4 py-2.5 border-b flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Spiked Content ({contentList.length})
                </h2>
                {contentList.length > 0 && (
                  <button onClick={() => downloadCSV(contentList.map(row => ({ Content: row.title, Customer: row.customer, Type: row.type, CUs: Math.round(row.cus * 10) / 10, Spiked: row.dateSpiked || "", Created: row.createdAt || "" })), "spiked-content.csv")} className="text-muted-foreground hover:text-foreground transition-colors" title="Download CSV">
                    <Download className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {contentList.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No spiked content found.</p>
              ) : (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background z-[1]">
                      <tr className="border-b">
                        <SortHeader label="Content" sortKey="title" {...contentSort} onSort={contentSort.toggle} />
                        <SortHeader label="Customer" sortKey="customer" {...contentSort} onSort={contentSort.toggle} />
                        <SortHeader label="Type" sortKey="type" {...contentSort} onSort={contentSort.toggle} />
                        <SortHeader label="CUs" sortKey="cus" {...contentSort} onSort={contentSort.toggle} align="right" />
                        <SortHeader label="Spiked" sortKey="dateSpiked" {...contentSort} onSort={contentSort.toggle} />
                        <SortHeader label="Created" sortKey="createdAt" {...contentSort} onSort={contentSort.toggle} />
                        <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-center">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contentList.map((c) => (
                        <tr key={c.contentId || c.title} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium max-w-[250px] truncate">{c.title}</td>
                          <td className="px-3 py-2 text-muted-foreground truncate max-w-[150px]">{c.customer}</td>
                          <td className="px-3 py-2"><Badge variant="secondary" className="text-[9px] capitalize">{c.type}</Badge></td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{c.cus.toFixed(1)}</td>
                          <td className="px-3 py-2 text-muted-foreground tabular-nums">{fmtDate(c.dateSpiked)}</td>
                          <td className="px-3 py-2 text-muted-foreground tabular-nums">{fmtDate(c.createdAt)}</td>
                          <td className="px-3 py-2 text-center">
                            {c.contentId && (
                              <a href={`https://app.thecontentengine.com/all/contents/${c.contentId}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600"><ExternalLink className="h-3 w-3 inline" /></a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Daily Spikes Chart */}
          {dailyData.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Daily Spikes</h2>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={dailyData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={35} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }} formatter={(value) => [`${value} CUs`, "Spiked"]} />
                    <Bar dataKey="cus" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Spikes by Client Chart */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Spiked CUs by Client</h2>
              {clientChartData.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No data.</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(200, clientChartData.length * 28)}>
                  <BarChart data={clientChartData} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={120} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }} formatter={(value) => [`${value} CUs`, "Spiked"]} />
                    <Bar dataKey="cus" radius={[0, 3, 3, 0]} maxBarSize={20}>
                      {clientChartData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
