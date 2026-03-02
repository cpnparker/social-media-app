"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
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
  BarChart3,
  ExternalLink,
  UserCheck,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

interface ContractRow {
  contractId: string;
  contractName: string;
  clientId: string | null;
  clientName: string;
  totalContractCUs: number;
  completedContractCUs: number;
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
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
};

const fmtDay = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const CHART_BLUE = "#3b82f6";
const CHART_COLORS = [
  "#3b82f6", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b",
  "#ef4444", "#ec4899", "#6366f1", "#14b8a6", "#f97316",
  "#84cc16", "#a855f7", "#0ea5e9", "#22c55e", "#eab308",
];

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

export default function CommissionedCUsPage() {
  const initRange = getThisMonthRange();

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [dateFrom, setDateFrom] = useState(initRange.from);
  const [dateTo, setDateTo] = useState(initRange.to);
  const [activePreset, setActivePreset] = useState<string | null>("This Month");

  const [searchQuery, setSearchQuery] = useState("");
  const [excludeTestClients, setExcludeTestClients] = useState(true);
  const EXCLUDE_CLIENT_IDS = "1,2";

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedCommissioner, setSelectedCommissioner] = useState<string | null>(null);

  // Sort states for each table
  const custSort = useSort("name", true);
  const contractSort = useSort("contractName", true);
  const contentSort = useSort("title", true);
  const teamSort = useSort("cus", false);
  const userContentSort = useSort("createdAt", false);

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
      setTasks(data.tasks || []);
      setContracts(data.contracts || []);
      setSelectedCustomerId(null);
      setSelectedCommissioner(null);
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
        t.contentTitle.toLowerCase().includes(q) ||
        t.customerName.toLowerCase().includes(q) ||
        t.taskTitle.toLowerCase().includes(q) ||
        t.contentType.toLowerCase().includes(q) ||
        (t.assigneeName && t.assigneeName.toLowerCase().includes(q)) ||
        (t.commissionedByName && t.commissionedByName.toLowerCase().includes(q))
    );
  }, [tasks, searchQuery]);

  /* ─── Totals ─── */
  const totals = useMemo(() => {
    let totalCUs = 0;
    let done = 0;
    for (const t of filtered) {
      totalCUs += t.taskCUs;
      if (t.taskStatus === "done") done += 1;
    }
    const contentIds = new Set(filtered.map((t) => t.contentId).filter(Boolean));
    const customerIds = new Set(filtered.map((t) => t.customerId).filter(Boolean));
    return { totalCUs, tasks: filtered.length, doneTasks: done, contentItems: contentIds.size, customers: customerIds.size };
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

  // Auto-select first customer
  useEffect(() => {
    if (customerList.length > 0 && !selectedCustomerId) {
      setSelectedCustomerId(customerList[0].id);
    }
  }, [customerList, selectedCustomerId]);

  /* ─── Contracts for selected customer ─── */
  const customerContracts = useMemo(() => {
    if (!selectedCustomerId) return [];
    const relevant = contracts.filter((c) => c.clientId === selectedCustomerId);
    const periodCUsByContract: Record<string, number> = {};
    for (const t of filtered) {
      if (t.customerId === selectedCustomerId && t.contractId) {
        periodCUsByContract[t.contractId] = (periodCUsByContract[t.contractId] || 0) + t.taskCUs;
      }
    }
    const rows = relevant.map((c) => ({
      ...c,
      periodCUs: periodCUsByContract[c.contractId] || 0,
      remaining: Math.max(0, c.totalContractCUs - c.completedContractCUs),
    }));
    return sortRows(rows, contractSort.currentSort, contractSort.currentAsc);
  }, [selectedCustomerId, contracts, filtered, contractSort.currentSort, contractSort.currentAsc]);

  /* ─── Content for selected customer ─── */
  const customerContent = useMemo(() => {
    if (!selectedCustomerId) return [];
    const map: Record<string, {
      contentId: string; title: string; type: string; commissionedBy: string | null;
      cus: number; completedAt: string | null; createdAt: string;
    }> = {};
    for (const t of filtered) {
      if (t.customerId !== selectedCustomerId) continue;
      const cid = t.contentId || t.taskId;
      if (!map[cid]) {
        map[cid] = {
          contentId: t.contentId || "", title: t.contentTitle, type: t.contentType,
          commissionedBy: t.commissionedByName, cus: 0, completedAt: t.taskCompletedAt, createdAt: t.taskCreatedAt,
        };
      }
      map[cid].cus += t.taskCUs;
    }
    return sortRows(Object.values(map), contentSort.currentSort, contentSort.currentAsc);
  }, [filtered, selectedCustomerId, contentSort.currentSort, contentSort.currentAsc]);

  /* ─── Daily chart ─── */
  const dailyData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of filtered) {
      if (!t.taskCreatedAt) continue;
      const day = t.taskCreatedAt.split("T")[0];
      map[day] = (map[day] || 0) + t.taskCUs;
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, cus]) => ({ day: fmtDay(day), cus: Math.round(cus * 10) / 10 }));
  }, [filtered]);

  /* ─── Client chart ─── */
  const clientChartData = useMemo(() => {
    // Use name-sorted list for chart
    const byCUs = [...customerList].sort((a, b) => b.cus - a.cus).slice(0, 15);
    return byCUs.map((c) => ({
      name: c.name.length > 18 ? c.name.slice(0, 16) + "…" : c.name,
      cus: Math.round(c.cus * 10) / 10,
    }));
  }, [customerList]);

  /* ─── Team commissions ─── */
  const teamList = useMemo(() => {
    const map: Record<string, { name: string; cus: number; count: number }> = {};
    for (const t of filtered) {
      const who = t.commissionedByName || "Unknown";
      if (!map[who]) map[who] = { name: who, cus: 0, count: 0 };
      map[who].cus += t.taskCUs;
      map[who].count += 1;
    }
    return sortRows(Object.values(map), teamSort.currentSort, teamSort.currentAsc);
  }, [filtered, teamSort.currentSort, teamSort.currentAsc]);

  /* ─── Content by commissioner ─── */
  const commissionerContent = useMemo(() => {
    if (!selectedCommissioner) return [];
    const map: Record<string, {
      contentId: string; title: string; type: string; customer: string;
      cus: number; completedAt: string | null; createdAt: string;
    }> = {};
    for (const t of filtered) {
      if ((t.commissionedByName || "Unknown") !== selectedCommissioner) continue;
      const cid = t.contentId || t.taskId;
      if (!map[cid]) {
        map[cid] = {
          contentId: t.contentId || "", title: t.contentTitle, type: t.contentType,
          customer: t.customerName, cus: 0, completedAt: t.taskCompletedAt, createdAt: t.taskCreatedAt,
        };
      }
      map[cid].cus += t.taskCUs;
    }
    return sortRows(Object.values(map), userContentSort.currentSort, userContentSort.currentAsc);
  }, [filtered, selectedCommissioner, userContentSort.currentSort, userContentSort.currentAsc]);

  const isFiltered = dateFrom || dateTo;
  const selectedCustomerName = customerList.find((c) => c.id === selectedCustomerId)?.name;

  /* ─────────────── Render ─────────────── */
  return (
    <div className="max-w-[1400px] space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Commissioned Content Units</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Task-level content units {isFiltered ? "for the selected period" : "across all time"}.
          {!loading && ` ${totals.tasks} tasks across ${totals.contentItems} content items.`}
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
              <span className="text-muted-foreground/30 pb-1.5 text-xs">–</span>
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
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { icon: Package, color: "text-blue-500", label: "Total CUs", value: totals.totalCUs.toFixed(1) },
              { icon: FileText, color: "text-violet-500", label: "Tasks", value: String(totals.tasks) },
              { icon: CheckCircle2, color: "text-green-500", label: "Completed", value: String(totals.doneTasks) },
              { icon: Clock, color: "text-amber-500", label: "In Progress", value: String(totals.tasks - totals.doneTasks) },
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

          {/* ── ② Active Customers (full width table) ── */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="px-4 py-2.5 border-b">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active Customers</h2>
              </div>
              {customerList.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No customers found.</p>
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
                        <tr
                          key={c.id}
                          onClick={() => setSelectedCustomerId(c.id)}
                          className={cn(
                            "border-b border-border/30 cursor-pointer transition-colors hover:bg-muted/40",
                            selectedCustomerId === c.id && "bg-blue-500/8 border-l-2 border-l-blue-500"
                          )}
                        >
                          <td className={cn("px-3 py-2 font-medium", selectedCustomerId === c.id && "text-blue-600")}>{c.name}</td>
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

          {/* ── ③ Contract Activity (full width) ── */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="px-4 py-2.5 border-b">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Contract Activity{selectedCustomerName ? ` — ${selectedCustomerName}` : ""}
                </h2>
              </div>
              {!selectedCustomerId ? (
                <p className="text-xs text-muted-foreground text-center py-6">Select a customer above to view contracts.</p>
              ) : customerContracts.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No contracts found for this customer.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <SortHeader label="Contract" sortKey="contractName" {...contractSort} onSort={contractSort.toggle} />
                        <SortHeader label="Total CUs" sortKey="totalContractCUs" {...contractSort} onSort={contractSort.toggle} align="right" />
                        <SortHeader label="Commissioned" sortKey="completedContractCUs" {...contractSort} onSort={contractSort.toggle} align="right" />
                        <SortHeader label="Remaining" sortKey="remaining" {...contractSort} onSort={contractSort.toggle} align="right" />
                        <SortHeader label="Period CUs" sortKey="periodCUs" {...contractSort} onSort={contractSort.toggle} align="right" />
                        <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-center">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerContracts.map((c) => (
                        <tr key={c.contractId} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium">{c.contractName}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{c.totalContractCUs.toFixed(1)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{c.completedContractCUs.toFixed(1)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">
                            <span className={c.remaining <= 0 ? "text-red-500" : "text-green-600"}>{c.remaining.toFixed(1)}</span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">{c.periodCUs.toFixed(1)}</td>
                          <td className="px-3 py-2 text-center">
                            <a href={`https://app.thecontentengine.com/admin/contracts/${c.contractId}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600"><ExternalLink className="h-3 w-3 inline" /></a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── ④ Content Commissioned (full width) ── */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="px-4 py-2.5 border-b">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Content Commissioned{selectedCustomerName ? ` — ${selectedCustomerName}` : ""}
                </h2>
              </div>
              {!selectedCustomerId ? (
                <p className="text-xs text-muted-foreground text-center py-6">Select a customer above to view content.</p>
              ) : customerContent.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No content found in this period.</p>
              ) : (
                <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background z-[1]">
                      <tr className="border-b">
                        <SortHeader label="Content" sortKey="title" {...contentSort} onSort={contentSort.toggle} />
                        <SortHeader label="Type" sortKey="type" {...contentSort} onSort={contentSort.toggle} />
                        <SortHeader label="Commissioned By" sortKey="commissionedBy" {...contentSort} onSort={contentSort.toggle} />
                        <SortHeader label="CUs" sortKey="cus" {...contentSort} onSort={contentSort.toggle} align="right" />
                        <SortHeader label="Completed" sortKey="completedAt" {...contentSort} onSort={contentSort.toggle} />
                        <SortHeader label="Commissioned" sortKey="createdAt" {...contentSort} onSort={contentSort.toggle} />
                        <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-center">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerContent.map((c) => (
                        <tr key={c.contentId || c.title} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium max-w-[250px] truncate">{c.title}</td>
                          <td className="px-3 py-2"><Badge variant="secondary" className="text-[9px] capitalize">{c.type}</Badge></td>
                          <td className="px-3 py-2 text-muted-foreground">{c.commissionedBy || "—"}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{c.cus.toFixed(1)}</td>
                          <td className="px-3 py-2 text-muted-foreground tabular-nums">{fmtDate(c.completedAt)}</td>
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

          {/* ── ⑤ Daily Commissions Chart ── */}
          {dailyData.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Daily Commissions</h2>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={dailyData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={35} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }} formatter={(value) => [`${value} CUs`, "Commissioned"]} />
                    <Bar dataKey="cus" fill={CHART_BLUE} radius={[3, 3, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* ── ⑥ Commissions by Client Chart ── */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Commissions by Client</h2>
              {clientChartData.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No data.</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(200, clientChartData.length * 28)}>
                  <BarChart data={clientChartData} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={120} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }} formatter={(value) => [`${value} CUs`, "Commissioned"]} />
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

          {/* ── ⑦ + ⑧ Team Commissions | Content by User (side by side) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* ⑦ Team Commissions */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                <div className="px-4 py-2.5 border-b">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Team Commissions</h2>
                </div>
                {teamList.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No data.</p>
                ) : (
                  <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background z-[1]">
                        <tr className="border-b">
                          <SortHeader label="Name" sortKey="name" {...teamSort} onSort={teamSort.toggle} />
                          <SortHeader label="Items" sortKey="count" {...teamSort} onSort={teamSort.toggle} align="right" />
                          <SortHeader label="CUs" sortKey="cus" {...teamSort} onSort={teamSort.toggle} align="right" />
                        </tr>
                      </thead>
                      <tbody>
                        {teamList.map((u) => (
                          <tr
                            key={u.name}
                            onClick={() => setSelectedCommissioner(selectedCommissioner === u.name ? null : u.name)}
                            className={cn(
                              "border-b border-border/30 cursor-pointer transition-colors hover:bg-muted/40",
                              selectedCommissioner === u.name && "bg-violet-500/8 border-l-2 border-l-violet-500"
                            )}
                          >
                            <td className="px-3 py-2">
                              <span className="flex items-center gap-1.5">
                                <UserCheck className={cn("h-3 w-3 shrink-0", selectedCommissioner === u.name ? "text-violet-500" : "text-muted-foreground/40")} />
                                <span className={cn("font-medium", selectedCommissioner === u.name && "text-violet-600")}>{u.name}</span>
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{u.count}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{u.cus.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ⑧ Content by Selected User */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                <div className="px-4 py-2.5 border-b">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {selectedCommissioner ? `Content — ${selectedCommissioner}` : "Content by User"}
                  </h2>
                </div>
                {!selectedCommissioner ? (
                  <p className="text-xs text-muted-foreground text-center py-8">Select a team member to view their content.</p>
                ) : commissionerContent.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No content found.</p>
                ) : (
                  <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background z-[1]">
                        <tr className="border-b">
                          <SortHeader label="Content" sortKey="title" {...userContentSort} onSort={userContentSort.toggle} />
                          <SortHeader label="Customer" sortKey="customer" {...userContentSort} onSort={userContentSort.toggle} />
                          <SortHeader label="Type" sortKey="type" {...userContentSort} onSort={userContentSort.toggle} />
                          <SortHeader label="CUs" sortKey="cus" {...userContentSort} onSort={userContentSort.toggle} align="right" />
                          <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-center">Link</th>
                        </tr>
                      </thead>
                      <tbody>
                        {commissionerContent.map((c) => (
                          <tr key={c.contentId || c.title} className="border-b border-border/50 hover:bg-muted/30">
                            <td className="px-3 py-2 font-medium max-w-[180px] truncate">{c.title}</td>
                            <td className="px-3 py-2 text-muted-foreground truncate max-w-[120px]">{c.customer}</td>
                            <td className="px-3 py-2"><Badge variant="secondary" className="text-[9px] capitalize">{c.type}</Badge></td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{c.cus.toFixed(1)}</td>
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
          </div>
        </>
      )}
    </div>
  );
}
