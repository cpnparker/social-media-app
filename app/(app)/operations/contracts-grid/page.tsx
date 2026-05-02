"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  CalendarDays,
  Search,
  FileText,
  Package,
  CheckCircle2,
  ClipboardList,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadCSV } from "@/lib/csv-utils";

/* ─────────────── Types ─────────────── */

interface ContractRow {
  contractId: string;
  clientId: string | null;
  clientName: string;
  contractName: string;
  dateStart: string | null;
  dateEnd: string | null;
  cusContract: number;
  cusCommissioned: number;
  cusComplete: number;
}

interface EnrichedContract extends ContractRow {
  remainingCommission: number;
  remainingComplete: number;
  pctDuration: number;
  pctCommission: number;
  pctComplete: number;
  gapCommission: number;
  rowColor: string;
}

/* ─────────────── Helpers ─────────────── */

const fmtDate = (d: string | null) => {
  if (!d) return "\u2014";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
};

const fmtPct = (n: number) => `${Math.round(n * 100)}%`;

const fmtNum = (n: number) => {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
};

/** 5-tier row color based on gap between pctDuration and pctCommission */
function getRowColor(pctDuration: number, pctCommission: number): string {
  const diff = pctDuration - pctCommission;
  if (diff > 0.15) return "#e67c73";    // Very behind
  if (diff > 0.05) return "#ecb8b2";    // Slightly behind
  if (diff < -0.15) return "#56bb8a";   // Well ahead
  if (diff < -0.05) return "#a5d7be";   // Slightly ahead
  return "#f3f3f3";                      // On track
}

function enrichContract(c: ContractRow): EnrichedContract {
  const cusContract = c.cusContract || 0;
  const cusCommissioned = c.cusCommissioned || 0;
  const cusComplete = c.cusComplete || 0;

  const remainingCommission = cusContract - cusCommissioned;
  const remainingComplete = cusContract - cusComplete;

  // Calculate % duration elapsed
  let pctDuration = 0;
  if (c.dateStart && c.dateEnd) {
    const start = new Date(c.dateStart).getTime();
    const end = new Date(c.dateEnd).getTime();
    const now = Date.now();
    const total = end - start;
    if (total > 0) {
      pctDuration = Math.max(0, Math.min(1, (now - start) / total));
    }
  }

  const pctCommission = cusContract > 0 ? cusCommissioned / cusContract : 0;
  const pctComplete = cusContract > 0 ? cusComplete / cusContract : 0;
  const gapCommission = pctDuration * cusContract - cusCommissioned;
  const rowColor = getRowColor(pctDuration, pctCommission);

  return {
    ...c,
    remainingCommission,
    remainingComplete,
    pctDuration,
    pctCommission,
    pctComplete,
    gapCommission,
    rowColor,
  };
}

/* ─── Sortable header helper ─── */
function SortHeader({ label, sortKey, currentSort, currentAsc, onSort, align = "left", title }: {
  label: string;
  sortKey: string;
  currentSort: string;
  currentAsc: boolean;
  onSort: (key: string) => void;
  align?: "left" | "right" | "center";
  title?: string;
}) {
  const active = currentSort === sortKey;
  return (
    <th
      className={cn(
        "px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors group whitespace-nowrap",
        align === "right" && "text-right",
        align === "center" && "text-center",
        active && "text-foreground"
      )}
      onClick={() => onSort(sortKey)}
      title={title}
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

export default function ContractsGridPage() {
  const today = new Date().toISOString().split("T")[0];

  const [contracts, setContracts] = useState<EnrichedContract[]>([]);
  const [loading, setLoading] = useState(true);

  const [endAfter, setEndAfter] = useState(today);
  const [searchQuery, setSearchQuery] = useState("");
  const [excludeTestClients, setExcludeTestClients] = useState(true);
  const EXCLUDE_CLIENT_IDS = "1,2";

  const gridSort = useSort("gapCommission", false);

  /* ─── Fetch ─── */
  const fetchContracts = useCallback(async (endAfterDate: string, excludeClients: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (endAfterDate) params.set("endAfter", endAfterDate);
      if (excludeClients) params.set("excludeClients", EXCLUDE_CLIENT_IDS);
      const res = await fetch(`/api/operations/contracts-grid?${params.toString()}`);
      const data = await res.json();
      const enriched = (data.contracts || []).map(enrichContract);
      setContracts(enriched);
    } catch (err) {
      console.error("Failed to fetch contracts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContracts(endAfter, excludeTestClients);
  }, [endAfter, excludeTestClients, fetchContracts]);

  /* ─── Filtered contracts ─── */
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return contracts;
    const q = searchQuery.toLowerCase();
    return contracts.filter(
      (c) =>
        c.clientName.toLowerCase().includes(q) ||
        c.contractName.toLowerCase().includes(q)
    );
  }, [contracts, searchQuery]);

  /* ─── Sorted contracts ─── */
  const sorted = useMemo(
    () => sortRows(filtered, gridSort.currentSort, gridSort.currentAsc),
    [filtered, gridSort.currentSort, gridSort.currentAsc]
  );

  /* ─── Totals ─── */
  const totals = useMemo(() => {
    let totalContracted = 0;
    let totalCommissioned = 0;
    let totalComplete = 0;
    for (const c of filtered) {
      totalContracted += c.cusContract;
      totalCommissioned += c.cusCommissioned;
      totalComplete += c.cusComplete;
    }
    return {
      count: filtered.length,
      totalContracted,
      totalCommissioned,
      totalComplete,
    };
  }, [filtered]);

  /* ─────────────── Render ─────────────── */
  return (
    <div className="max-w-[1600px] space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Contracts Grid</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Active contracts with commissioning progress vs. contract timeline.
          {!loading && ` ${totals.count} contracts shown.`}
        </p>
      </div>

      {/* Filter bar */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row lg:items-end gap-4">
            <div className="flex items-end gap-2.5">
              <div className="w-[200px]">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                  Contracts ending after
                </label>
                <div className="relative">
                  <CalendarDays className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
                  <Input
                    type="date"
                    value={endAfter}
                    onChange={(e) => setEndAfter(e.target.value)}
                    className="h-8 text-xs pl-7"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-1 lg:justify-end">
              <div className="relative w-full lg:w-[220px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
                <Input
                  type="text"
                  placeholder="Search client or contract..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 text-xs pl-8"
                />
              </div>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0 select-none">
                <input
                  type="checkbox"
                  checked={excludeTestClients}
                  onChange={(e) => setExcludeTestClients(e.target.checked)}
                  className="rounded border-muted-foreground/30 h-3.5 w-3.5"
                />
                Hide test clients
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: ClipboardList, color: "text-blue-500", label: "Contracts", value: String(totals.count) },
              { icon: Package, color: "text-violet-500", label: "CUs Contracted", value: fmtNum(totals.totalContracted) },
              { icon: FileText, color: "text-amber-500", label: "CUs Commissioned", value: fmtNum(totals.totalCommissioned) },
              { icon: CheckCircle2, color: "text-green-500", label: "CUs Complete", value: fmtNum(totals.totalComplete) },
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

          {/* Color legend */}
          <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
            <span className="font-medium uppercase tracking-wider">Legend:</span>
            {[
              { color: "#56bb8a", label: "Well ahead" },
              { color: "#a5d7be", label: "Slightly ahead" },
              { color: "#f3f3f3", label: "On track" },
              { color: "#ecb8b2", label: "Slightly behind" },
              { color: "#e67c73", label: "Very behind" },
            ].map((item) => (
              <span key={item.label} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded-sm border border-border/50"
                  style={{ backgroundColor: item.color }}
                />
                {item.label}
              </span>
            ))}
          </div>

          {/* Main contracts table */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="px-4 py-2.5 border-b flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Contracts ({sorted.length})
                </h2>
                {sorted.length > 0 && (
                  <button
                    onClick={() => downloadCSV(sorted.map(row => ({
                      Client: row.clientName,
                      Contract: row.contractName,
                      Start: row.dateStart ?? "",
                      End: row.dateEnd ?? "",
                      "CUs Contract": Math.round(row.cusContract),
                      "CUs Commissioned": Math.round(row.cusCommissioned),
                      "CUs Complete": Math.round(row.cusComplete),
                      "Remaining (Comm.)": Math.round(row.remainingCommission),
                      "Remaining (Comp.)": Math.round(row.remainingComplete),
                      "% Duration": fmtPct(row.pctDuration),
                      "% Commissioned": fmtPct(row.pctCommission),
                      "% Complete": fmtPct(row.pctComplete),
                      Gap: Math.round(row.gapCommission),
                    })), "contracts-grid.csv")}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Download CSV"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {sorted.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No contracts found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background z-[1]">
                      <tr className="border-b">
                        <SortHeader label="Client" sortKey="clientName" {...gridSort} onSort={gridSort.toggle} title="Client name" />
                        <SortHeader label="Contract" sortKey="contractName" {...gridSort} onSort={gridSort.toggle} title="Contract name" />
                        <SortHeader label="Start" sortKey="dateStart" {...gridSort} onSort={gridSort.toggle} title="Contract start date" />
                        <SortHeader label="End" sortKey="dateEnd" {...gridSort} onSort={gridSort.toggle} title="Contract end date" />
                        <SortHeader label="CUs Contract" sortKey="cusContract" {...gridSort} onSort={gridSort.toggle} align="right" title="Total content units in the contract" />
                        <SortHeader label="CUs Comm." sortKey="cusCommissioned" {...gridSort} onSort={gridSort.toggle} align="right" title="Content units commissioned (all tasks created against this contract)" />
                        <SortHeader label="CUs Complete" sortKey="cusComplete" {...gridSort} onSort={gridSort.toggle} align="right" title="Content units completed (tasks marked as done)" />
                        <SortHeader label="Rem. (Comm.)" sortKey="remainingCommission" {...gridSort} onSort={gridSort.toggle} align="right" title="Remaining to commission: contract CUs minus commissioned CUs" />
                        <SortHeader label="Rem. (Comp.)" sortKey="remainingComplete" {...gridSort} onSort={gridSort.toggle} align="right" title="Remaining to complete: contract CUs minus completed CUs" />
                        <SortHeader label="% Duration" sortKey="pctDuration" {...gridSort} onSort={gridSort.toggle} align="right" title="Percentage of the contract period that has elapsed" />
                        <SortHeader label="% Comm." sortKey="pctCommission" {...gridSort} onSort={gridSort.toggle} align="right" title="Percentage of contract CUs that have been commissioned" />
                        <SortHeader label="% Complete" sortKey="pctComplete" {...gridSort} onSort={gridSort.toggle} align="right" title="Percentage of contract CUs that have been completed" />
                        <SortHeader label="Gap" sortKey="gapCommission" {...gridSort} onSort={gridSort.toggle} align="right" title="Commission gap: expected CUs based on time elapsed minus actual CUs commissioned. Positive = behind, negative = ahead." />
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((c) => (
                        <tr
                          key={c.contractId}
                          className="border-b border-border/30 hover:opacity-90 transition-opacity"
                          style={{ backgroundColor: c.rowColor }}
                        >
                          <td className="px-3 py-2 font-medium text-gray-900 max-w-[160px] truncate">{c.clientName}</td>
                          <td className="px-3 py-2 text-gray-800 max-w-[200px] truncate">{c.contractName}</td>
                          <td className="px-3 py-2 text-gray-700 tabular-nums whitespace-nowrap">{fmtDate(c.dateStart)}</td>
                          <td className="px-3 py-2 text-gray-700 tabular-nums whitespace-nowrap">{fmtDate(c.dateEnd)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-gray-900 tabular-nums">{fmtNum(c.cusContract)}</td>
                          <td className="px-3 py-2 text-right text-gray-800 tabular-nums">{fmtNum(c.cusCommissioned)}</td>
                          <td className="px-3 py-2 text-right text-gray-800 tabular-nums">{fmtNum(c.cusComplete)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            <span className={c.remainingCommission < 0 ? "text-red-700 font-semibold" : "text-gray-800"}>
                              {fmtNum(c.remainingCommission)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            <span className={c.remainingComplete < 0 ? "text-red-700 font-semibold" : "text-gray-800"}>
                              {fmtNum(c.remainingComplete)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-800 tabular-nums">{fmtPct(c.pctDuration)}</td>
                          <td className="px-3 py-2 text-right text-gray-800 tabular-nums">{fmtPct(c.pctCommission)}</td>
                          <td className="px-3 py-2 text-right text-gray-800 tabular-nums">{fmtPct(c.pctComplete)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">
                            <span className={c.gapCommission > 0 ? "text-red-700" : "text-green-800"}>
                              {fmtNum(c.gapCommission)}
                            </span>
                          </td>
                        </tr>
                      ))}
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
