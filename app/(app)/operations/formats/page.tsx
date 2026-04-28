"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Loader2,
  CalendarDays,
  X,
  Search,
  ExternalLink,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  categorizeContentType,
  CATEGORY_ORDER,
  CATEGORY_ICONS,
  typeHexColors,
  typeIcons,
  typeColors,
} from "@/lib/content-type-utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from "recharts";
import {
  startOfWeek,
  startOfMonth,
  format as fnsFormat,
} from "date-fns";

/* ─────────────── Types ─────────────── */

interface FormatTask {
  taskId: string;
  contentId: string | null;
  taskType: string;
  cus: number;
  dateCreated: string;
  contentName: string;
  contentType: string;
  clientId: string | null;
  clientName: string;
  contractId: string | null;
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

const CATEGORY_HEX: Record<string, string> = {
  Written: "#3b82f6",
  Video: "#ef4444",
  Visual: "#ec4899",
  Strategy: "#f59e0b",
  Other: "#6b7280",
};

import { downloadCSV } from "@/lib/csv-utils";

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

export default function FormatsPage() {
  const initRange = getThisMonthRange();

  const [tasks, setTasks] = useState<FormatTask[]>([]);
  const [loading, setLoading] = useState(true);

  const [dateFrom, setDateFrom] = useState(initRange.from);
  const [dateTo, setDateTo] = useState(initRange.to);
  const [activePreset, setActivePreset] = useState<string | null>("This Month");

  const [searchQuery, setSearchQuery] = useState("");
  const [excludeTestClients, setExcludeTestClients] = useState(true);
  const EXCLUDE_CLIENT_IDS = "1,2";

  // Tab 1 state
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<"daily" | "weekly" | "monthly">("weekly");

  // Tab 2 state
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // Sort states
  const formatSort = useSort("cus", false);
  const contentSort = useSort("dateCreated", false);
  const customerSort = useSort("total", false);
  const customerDetailSort = useSort("dateCreated", false);

  /* ─── Fetch ─── */
  const fetchTasks = useCallback(async (from: string, to: string, excludeClients: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (excludeClients) params.set("excludeClients", EXCLUDE_CLIENT_IDS);
      const res = await fetch(`/api/operations/formats?${params.toString()}`);
      const data = await res.json();
      setTasks(data.tasks || []);
      setSelectedFormat(null);
      setSelectedCustomerId(null);
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

  /* ─── Filtered tasks ─── */
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return tasks;
    const q = searchQuery.toLowerCase();
    return tasks.filter(
      (t) =>
        t.contentName.toLowerCase().includes(q) ||
        t.clientName.toLowerCase().includes(q) ||
        t.contentType.toLowerCase().includes(q) ||
        t.taskType.toLowerCase().includes(q)
    );
  }, [tasks, searchQuery]);

  /* ─── Category summaries ─── */
  const categorySummary = useMemo(() => {
    const map: Record<string, { cus: number; count: number }> = {};
    for (const cat of CATEGORY_ORDER) map[cat] = { cus: 0, count: 0 };
    for (const t of filtered) {
      const cat = categorizeContentType(t.contentType);
      if (!map[cat]) map[cat] = { cus: 0, count: 0 };
      map[cat].cus += t.cus;
      map[cat].count += 1;
    }
    return map;
  }, [filtered]);

  /* ─── Format list (By Type tab) ─── */
  const formatList = useMemo(() => {
    const map: Record<string, { type: string; category: string; cus: number; count: number }> = {};
    for (const t of filtered) {
      const type = t.contentType;
      if (!map[type]) map[type] = { type, category: categorizeContentType(type), cus: 0, count: 0 };
      map[type].cus += t.cus;
      map[type].count += 1;
    }
    return sortRows(Object.values(map), formatSort.currentSort, formatSort.currentAsc);
  }, [filtered, formatSort.currentSort, formatSort.currentAsc]);

  // Auto-select first format
  useEffect(() => {
    if (formatList.length > 0 && !selectedFormat) {
      setSelectedFormat(formatList[0].type);
    }
  }, [formatList, selectedFormat]);

  /* ─── Content for selected format ─── */
  const formatContent = useMemo(() => {
    if (!selectedFormat) return [];
    const map: Record<string, {
      contentId: string; name: string; clientName: string; contractName: string | null;
      cus: number; dateCreated: string;
    }> = {};
    for (const t of filtered) {
      if (t.contentType !== selectedFormat) continue;
      const cid = t.contentId || t.taskId;
      if (!map[cid]) {
        map[cid] = {
          contentId: t.contentId || "", name: t.contentName, clientName: t.clientName,
          contractName: t.contractName, cus: 0, dateCreated: t.dateCreated,
        };
      }
      map[cid].cus += t.cus;
    }
    return sortRows(Object.values(map), contentSort.currentSort, contentSort.currentAsc);
  }, [filtered, selectedFormat, contentSort.currentSort, contentSort.currentAsc]);

  /* ─── Bar chart data (replaces pie chart) ─── */
  const barData = useMemo(() => {
    const top = formatList.slice(0, 15);
    const rest = formatList.slice(15);
    const rows = top.map((f) => ({
      name: f.type.replace(/_/g, " "),
      value: Math.round(f.cus * 10) / 10,
      category: f.category,
    }));
    if (rest.length > 0) {
      const otherCUs = rest.reduce((sum, f) => sum + f.cus, 0);
      rows.push({ name: "Other", value: Math.round(otherCUs * 10) / 10, category: "Other" });
    }
    return rows;
  }, [formatList]);

  /* ─── Line chart data ─── */
  const timeSeriesData = useMemo(() => {
    const bucketMap: Record<string, Record<string, number>> = {};

    for (const t of filtered) {
      if (!t.dateCreated) continue;
      const d = new Date(t.dateCreated);
      let bucketKey: string;

      if (granularity === "daily") {
        bucketKey = fnsFormat(d, "d MMM");
      } else if (granularity === "weekly") {
        const weekStart = startOfWeek(d, { weekStartsOn: 1 });
        bucketKey = fnsFormat(weekStart, "d MMM");
      } else {
        const monthStart = startOfMonth(d);
        bucketKey = fnsFormat(monthStart, "MMM yyyy");
      }

      if (!bucketMap[bucketKey]) bucketMap[bucketKey] = {};
      const cat = categorizeContentType(t.contentType);
      bucketMap[bucketKey][cat] = (bucketMap[bucketKey][cat] || 0) + t.cus;
    }

    // Sort by underlying date
    const sortedKeys = Object.keys(bucketMap).sort((a, b) => {
      // Re-parse for ordering — use the first task date per bucket
      return a.localeCompare(b);
    });

    // Build a proper sort: we need to build sortable keys
    const bucketWithDate: { key: string; sortDate: Date }[] = [];
    for (const t of filtered) {
      if (!t.dateCreated) continue;
      const d = new Date(t.dateCreated);
      let bucketKey: string;
      let sortDate: Date;

      if (granularity === "daily") {
        bucketKey = fnsFormat(d, "d MMM");
        sortDate = d;
      } else if (granularity === "weekly") {
        const weekStart = startOfWeek(d, { weekStartsOn: 1 });
        bucketKey = fnsFormat(weekStart, "d MMM");
        sortDate = weekStart;
      } else {
        const monthStart = startOfMonth(d);
        bucketKey = fnsFormat(monthStart, "MMM yyyy");
        sortDate = monthStart;
      }

      if (!bucketWithDate.find((b) => b.key === bucketKey)) {
        bucketWithDate.push({ key: bucketKey, sortDate });
      }
    }
    bucketWithDate.sort((a, b) => a.sortDate.getTime() - b.sortDate.getTime());

    return bucketWithDate.map(({ key }) => {
      const row: Record<string, string | number> = { period: key };
      for (const cat of CATEGORY_ORDER) {
        row[cat] = Math.round((bucketMap[key]?.[cat] || 0) * 10) / 10;
      }
      return row;
    });
  }, [filtered, granularity]);

  /* ─── Customer format matrix (By Customer tab) ─── */
  interface CustomerFormatRow {
    id: string;
    name: string;
    Written: number;
    Video: number;
    Visual: number;
    Strategy: number;
    Other: number;
    total: number;
    [key: string]: string | number;
  }

  const customerFormatData = useMemo(() => {
    const map: Record<string, CustomerFormatRow> = {};
    for (const t of filtered) {
      const cid = t.clientId || "unassigned";
      if (!map[cid]) map[cid] = { id: cid, name: t.clientName, Written: 0, Video: 0, Visual: 0, Strategy: 0, Other: 0, total: 0 };
      const cat = categorizeContentType(t.contentType);
      map[cid][cat] = ((map[cid][cat] as number) || 0) + t.cus;
      map[cid].total += t.cus;
    }
    return sortRows(Object.values(map), customerSort.currentSort, customerSort.currentAsc);
  }, [filtered, customerSort.currentSort, customerSort.currentAsc]);

  // Auto-select first customer
  useEffect(() => {
    if (customerFormatData.length > 0 && !selectedCustomerId) {
      setSelectedCustomerId(customerFormatData[0].id);
    }
  }, [customerFormatData, selectedCustomerId]);

  /* ─── Stacked bar chart data ─── */
  const stackedBarData = useMemo(() => {
    const sorted = [...customerFormatData].sort((a, b) => b.total - a.total).slice(0, 15);
    return sorted.map((c) => ({
      name: c.name.length > 18 ? c.name.slice(0, 16) + "\u2026" : c.name,
      Written: Math.round(c.Written * 10) / 10,
      Video: Math.round(c.Video * 10) / 10,
      Visual: Math.round(c.Visual * 10) / 10,
      Strategy: Math.round(c.Strategy * 10) / 10,
      Other: Math.round(c.Other * 10) / 10,
    }));
  }, [customerFormatData]);

  /* ─── Customer detail content ─── */
  const customerDetailContent = useMemo(() => {
    if (!selectedCustomerId) return [];
    const map: Record<string, {
      contentId: string; name: string; contentType: string; category: string;
      cus: number; dateCreated: string;
    }> = {};
    for (const t of filtered) {
      const cid = t.clientId || "unassigned";
      if (cid !== selectedCustomerId) continue;
      const key = t.contentId || t.taskId;
      if (!map[key]) {
        map[key] = {
          contentId: t.contentId || "", name: t.contentName, contentType: t.contentType,
          category: categorizeContentType(t.contentType), cus: 0, dateCreated: t.dateCreated,
        };
      }
      map[key].cus += t.cus;
    }
    return sortRows(Object.values(map), customerDetailSort.currentSort, customerDetailSort.currentAsc);
  }, [filtered, selectedCustomerId, customerDetailSort.currentSort, customerDetailSort.currentAsc]);

  const isFiltered = dateFrom || dateTo;
  const selectedCustomerName = customerFormatData.find((c) => c.id === selectedCustomerId)?.name;

  /* ─────────────── Render ─────────────── */
  return (
    <div className="max-w-[1400px] space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Formats</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Content format tracking {isFiltered ? "for the selected period" : "across all time"}.
          {!loading && ` ${filtered.length} tasks across ${formatList.length} formats.`}
        </p>
      </div>

      {/* Date range + search */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-end gap-4">
            <div className="flex items-end gap-2.5 flex-1">
              <div className="w-[160px]">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">From</label>
                <div className="relative">
                  <CalendarDays className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
                  <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setActivePreset(null); }} className="h-8 text-xs pl-7" />
                </div>
              </div>
              <span className="text-muted-foreground/30 pb-1.5 text-xs">&ndash;</span>
              <div className="w-[160px]">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">To</label>
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
                Hide TCE and test clients
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs defaultValue="byType">
          <TabsList>
            <TabsTrigger value="byType">By Type</TabsTrigger>
            <TabsTrigger value="byCustomer">By Customer</TabsTrigger>
          </TabsList>

          {/* ═══════════════════════════════════════════
              TAB 1: BY TYPE
              ═══════════════════════════════════════════ */}
          <TabsContent value="byType" className="space-y-5">
            {/* ── KPI cards ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {CATEGORY_ORDER.filter((c) => c !== "Other").map((category) => (
                <Card key={category} className="border-0 shadow-sm">
                  <CardContent className="p-3.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span>{CATEGORY_ICONS[category]}</span>
                      <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                        {category}
                      </span>
                    </div>
                    <p className="text-2xl font-bold tabular-nums">
                      {(categorySummary[category]?.cus || 0).toFixed(1)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {categorySummary[category]?.count || 0} tasks
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* ── Formats list + Pie chart (side by side) ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Formats table */}
              <Card className="border-0 shadow-sm">
                <CardContent className="p-0">
                  <div className="px-4 py-2.5 border-b flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Formats Commissioned</h2>
                    {formatList.length > 0 && (
                      <button
                        onClick={() => downloadCSV(
                          formatList.map((f) => ({ Format: f.type.replace(/_/g, " "), Category: f.category, CUs: Math.round(f.cus * 10) / 10, Tasks: f.count })),
                          `formats-commissioned-${dateFrom || "all"}-to-${dateTo || "all"}.csv`
                        )}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="Download CSV"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {formatList.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8">No formats found.</p>
                  ) : (
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-background z-[1]">
                          <tr className="border-b">
                            <SortHeader label="Format" sortKey="type" {...formatSort} onSort={formatSort.toggle} />
                            <SortHeader label="Category" sortKey="category" {...formatSort} onSort={formatSort.toggle} />
                            <SortHeader label="CUs" sortKey="cus" {...formatSort} onSort={formatSort.toggle} align="right" />
                            <SortHeader label="Tasks" sortKey="count" {...formatSort} onSort={formatSort.toggle} align="right" />
                          </tr>
                        </thead>
                        <tbody>
                          {formatList.map((f) => (
                            <tr
                              key={f.type}
                              onClick={() => setSelectedFormat(f.type)}
                              className={cn(
                                "border-b border-border/30 cursor-pointer transition-colors hover:bg-muted/40",
                                selectedFormat === f.type && "bg-blue-500/8 border-l-2 border-l-blue-500"
                              )}
                            >
                              <td className={cn("px-3 py-2 font-medium", selectedFormat === f.type && "text-blue-600")}>
                                <span className="inline-flex items-center gap-1.5">
                                  <span>{typeIcons[f.type.toLowerCase()] || typeIcons.other}</span>
                                  <span className="capitalize">{f.type.replace(/_/g, " ")}</span>
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <Badge variant="secondary" className="text-[9px]">{f.category}</Badge>
                              </td>
                              <td className="px-3 py-2 text-right font-semibold tabular-nums">{f.cus.toFixed(1)}</td>
                              <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{f.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Horizontal bar chart */}
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Format Breakdown</h2>
                  <div className="flex items-center gap-3 mb-3">
                    {CATEGORY_ORDER.map((cat) => (
                      <span key={cat} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: CATEGORY_HEX[cat] }} />
                        {cat}
                      </span>
                    ))}
                  </div>
                  {barData.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8">No data.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(200, barData.length * 28 + 20)}>
                      <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 40, top: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.3} />
                        <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={150}
                          tick={{ fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                          style={{ textTransform: "capitalize" }}
                        />
                        <Tooltip
                          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }}
                          formatter={(value) => [`${value} CUs`, "Commissioned"]}
                          labelFormatter={(label) => String(label).replace(/_/g, " ")}
                        />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={20}
                          label={{ position: "right", fontSize: 10, fill: "#6b7280", formatter: (v: any) => Number(v).toFixed(1) }}
                        >
                          {barData.map((entry, i) => (
                            <Cell key={i} fill={CATEGORY_HEX[entry.category] || CATEGORY_HEX.Other} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ── Content commissioned table (linked to selected format) ── */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                <div className="px-4 py-2.5 border-b flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Content Commissioned{selectedFormat ? ` \u2014 ${selectedFormat.replace(/_/g, " ")}` : ""}
                  </h2>
                  {formatContent.length > 0 && (
                    <button
                      onClick={() => downloadCSV(
                        formatContent.map((c) => ({ Content: c.name, Client: c.clientName, Contract: c.contractName || "", CUs: Math.round(c.cus * 10) / 10, Commissioned: fmtDate(c.dateCreated) })),
                        `content-${(selectedFormat || "all").replace(/_/g, "-")}-${dateFrom || "all"}-to-${dateTo || "all"}.csv`
                      )}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="Download CSV"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {!selectedFormat ? (
                  <p className="text-xs text-muted-foreground text-center py-6">Select a format above to view content.</p>
                ) : formatContent.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No content found in this period.</p>
                ) : (
                  <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background z-[1]">
                        <tr className="border-b">
                          <SortHeader label="Content" sortKey="name" {...contentSort} onSort={contentSort.toggle} />
                          <SortHeader label="Client" sortKey="clientName" {...contentSort} onSort={contentSort.toggle} />
                          <SortHeader label="Contract" sortKey="contractName" {...contentSort} onSort={contentSort.toggle} />
                          <SortHeader label="CUs" sortKey="cus" {...contentSort} onSort={contentSort.toggle} align="right" />
                          <SortHeader label="Commissioned" sortKey="dateCreated" {...contentSort} onSort={contentSort.toggle} />
                          <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-center">Link</th>
                        </tr>
                      </thead>
                      <tbody>
                        {formatContent.map((c) => (
                          <tr key={c.contentId || c.name} className="border-b border-border/50 hover:bg-muted/30">
                            <td className="px-3 py-2 font-medium max-w-[250px] truncate">{c.name}</td>
                            <td className="px-3 py-2 text-muted-foreground truncate max-w-[140px]">{c.clientName}</td>
                            <td className="px-3 py-2 text-muted-foreground truncate max-w-[140px]">{c.contractName || "\u2014"}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{c.cus.toFixed(1)}</td>
                            <td className="px-3 py-2 text-muted-foreground tabular-nums">{fmtDate(c.dateCreated)}</td>
                            <td className="px-3 py-2 text-center">
                              {c.contentId && (
                                <a href={`/content/${c.contentId}`} className="text-blue-500 hover:text-blue-600">
                                  <ExternalLink className="h-3 w-3 inline" />
                                </a>
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

            {/* ── Line graph: Commissions Over Time ── */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Commissions Over Time</h2>
                  <div className="flex items-center gap-1">
                    {(["daily", "weekly", "monthly"] as const).map((g) => (
                      <button
                        key={g}
                        onClick={() => setGranularity(g)}
                        className={cn(
                          "px-2 py-1 rounded text-[11px] font-medium transition-colors capitalize",
                          granularity === g ? "bg-foreground text-background" : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
                {timeSeriesData.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No data.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={timeSeriesData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="period" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={35} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }}
                        formatter={(value, name) => [`${value} CUs`, name]}
                      />
                      <Legend iconType="circle" iconSize={8} formatter={(value) => <span className="text-xs">{value as string}</span>} />
                      {CATEGORY_ORDER.map((cat) => (
                        <Line
                          key={cat}
                          type="monotone"
                          dataKey={cat}
                          stroke={CATEGORY_HEX[cat]}
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══════════════════════════════════════════
              TAB 2: BY CUSTOMER
              ═══════════════════════════════════════════ */}
          <TabsContent value="byCustomer" className="space-y-5">
            {/* ── Customer format matrix table ── */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                <div className="px-4 py-2.5 border-b flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Customer Format Breakdown</h2>
                  {customerFormatData.length > 0 && (
                    <button
                      onClick={() => downloadCSV(
                        customerFormatData.map((c) => ({ Customer: c.name, Written: Math.round(c.Written * 10) / 10, Video: Math.round(c.Video * 10) / 10, Visual: Math.round(c.Visual * 10) / 10, Strategy: Math.round(c.Strategy * 10) / 10, "Total CUs": Math.round(c.total * 10) / 10 })),
                        `customer-format-breakdown-${dateFrom || "all"}-to-${dateTo || "all"}.csv`
                      )}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="Download CSV"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {customerFormatData.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No customers found.</p>
                ) : (
                  <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background z-[1]">
                        <tr className="border-b">
                          <SortHeader label="Customer" sortKey="name" {...customerSort} onSort={customerSort.toggle} />
                          <SortHeader label="Written" sortKey="Written" {...customerSort} onSort={customerSort.toggle} align="right" />
                          <SortHeader label="Video" sortKey="Video" {...customerSort} onSort={customerSort.toggle} align="right" />
                          <SortHeader label="Visual" sortKey="Visual" {...customerSort} onSort={customerSort.toggle} align="right" />
                          <SortHeader label="Strategy" sortKey="Strategy" {...customerSort} onSort={customerSort.toggle} align="right" />
                          <SortHeader label="Total CUs" sortKey="total" {...customerSort} onSort={customerSort.toggle} align="right" />
                        </tr>
                      </thead>
                      <tbody>
                        {customerFormatData.map((c) => (
                          <tr
                            key={c.id}
                            onClick={() => setSelectedCustomerId(c.id)}
                            className={cn(
                              "border-b border-border/30 cursor-pointer transition-colors hover:bg-muted/40",
                              selectedCustomerId === c.id && "bg-blue-500/8 border-l-2 border-l-blue-500"
                            )}
                          >
                            <td className={cn("px-3 py-2 font-medium", selectedCustomerId === c.id && "text-blue-600")}>{c.name}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{c.Written > 0 ? c.Written.toFixed(1) : "\u2014"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{c.Video > 0 ? c.Video.toFixed(1) : "\u2014"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{c.Visual > 0 ? c.Visual.toFixed(1) : "\u2014"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{c.Strategy > 0 ? c.Strategy.toFixed(1) : "\u2014"}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{c.total.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Stacked bar chart ── */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Format Mix by Customer (Top 15)</h2>
                {stackedBarData.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No data.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(280, stackedBarData.length * 32)}>
                    <BarChart data={stackedBarData} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={130} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }}
                        formatter={(value, name) => [`${value} CUs`, name]}
                      />
                      <Legend iconType="circle" iconSize={8} formatter={(value) => <span className="text-xs">{value as string}</span>} />
                      <Bar dataKey="Written" stackId="a" fill={CATEGORY_HEX.Written} radius={0} />
                      <Bar dataKey="Video" stackId="a" fill={CATEGORY_HEX.Video} radius={0} />
                      <Bar dataKey="Visual" stackId="a" fill={CATEGORY_HEX.Visual} radius={0} />
                      <Bar dataKey="Strategy" stackId="a" fill={CATEGORY_HEX.Strategy} radius={0} />
                      <Bar dataKey="Other" stackId="a" fill={CATEGORY_HEX.Other} radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* ── Customer detail table ── */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                <div className="px-4 py-2.5 border-b flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Content{selectedCustomerName ? ` \u2014 ${selectedCustomerName}` : ""}
                  </h2>
                  {customerDetailContent.length > 0 && (
                    <button
                      onClick={() => downloadCSV(
                        customerDetailContent.map((c) => ({ Content: c.name, Type: c.contentType.replace(/_/g, " "), Category: c.category, CUs: Math.round(c.cus * 10) / 10, Commissioned: fmtDate(c.dateCreated) })),
                        `content-${(selectedCustomerName || "customer").replace(/\s+/g, "-").toLowerCase()}.csv`
                      )}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="Download CSV"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {!selectedCustomerId ? (
                  <p className="text-xs text-muted-foreground text-center py-6">Select a customer above to view their content.</p>
                ) : customerDetailContent.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No content found.</p>
                ) : (
                  <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background z-[1]">
                        <tr className="border-b">
                          <SortHeader label="Content" sortKey="name" {...customerDetailSort} onSort={customerDetailSort.toggle} />
                          <SortHeader label="Type" sortKey="contentType" {...customerDetailSort} onSort={customerDetailSort.toggle} />
                          <SortHeader label="Category" sortKey="category" {...customerDetailSort} onSort={customerDetailSort.toggle} />
                          <SortHeader label="CUs" sortKey="cus" {...customerDetailSort} onSort={customerDetailSort.toggle} align="right" />
                          <SortHeader label="Commissioned" sortKey="dateCreated" {...customerDetailSort} onSort={customerDetailSort.toggle} />
                          <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-center">Link</th>
                        </tr>
                      </thead>
                      <tbody>
                        {customerDetailContent.map((c) => (
                          <tr key={c.contentId || c.name} className="border-b border-border/50 hover:bg-muted/30">
                            <td className="px-3 py-2 font-medium max-w-[250px] truncate">{c.name}</td>
                            <td className="px-3 py-2">
                              <Badge variant="secondary" className={cn("text-[9px] capitalize", typeColors[c.contentType.toLowerCase()] || typeColors.other)}>
                                {c.contentType.replace(/_/g, " ")}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{c.category}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{c.cus.toFixed(1)}</td>
                            <td className="px-3 py-2 text-muted-foreground tabular-nums">{fmtDate(c.dateCreated)}</td>
                            <td className="px-3 py-2 text-center">
                              {c.contentId && (
                                <a href={`/content/${c.contentId}`} className="text-blue-500 hover:text-blue-600">
                                  <ExternalLink className="h-3 w-3 inline" />
                                </a>
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
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
