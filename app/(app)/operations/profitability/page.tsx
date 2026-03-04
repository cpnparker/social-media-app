"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Clock,
  TrendingUp,
  BarChart3,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  Legend,
} from "recharts";

/* ─────────────── Types ─────────────── */

interface ContractInfo {
  contractId: string;
  contractName: string;
  cusDelivered: number;
  cusContracted: number;
  dateStart: string | null;
  dateEnd: string | null;
  active: boolean;
}

interface ClientRow {
  clockifyClientId: string;
  clientName: string;
  totalHours: number;
  billableHours: number;
  activityBreakdown: Record<string, number>;
  supabaseClientId: string | null;
  supabaseClientName: string | null;
  cusInPeriod: number;
  cusContracted: number;
  hoursPerCU: number | null;
  contracts: ContractInfo[];
}

interface Totals {
  totalHours: number;
  totalBillableHours: number;
  totalCUsInPeriod: number;
  overallHoursPerCU: number | null;
  activityTotals: Record<string, number>;
}

/* ─────────────── Helpers ─────────────── */

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const fmtHours = (h: number) => {
  if (h === 0) return "0h";
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
};

/* ─────────────── Sort helpers ─────────────── */

type SortDir = "asc" | "desc";
type SortKey = string;

function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = currentKey === sortKey;
  return (
    <button
      className="flex items-center gap-1 font-medium hover:text-foreground transition-colors"
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active ? (
        currentDir === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}

function sortRows<T>(rows: T[], key: SortKey, dir: SortDir): T[] {
  return [...rows].sort((a, b) => {
    const av = (a as any)[key] ?? 0;
    const bv = (b as any)[key] ?? 0;
    if (typeof av === "string") return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    return dir === "asc" ? av - bv : bv - av;
  });
}

/* ─────────────── Activity colors ─────────────── */

const ACTIVITY_COLORS: Record<string, string> = {
  "Content Production": "#3b82f6", // blue
  "Account Management": "#f59e0b", // amber
  Strategy: "#10b981", // green
  Other: "#8b5cf6", // purple
};

const getActivityColor = (activity: string) =>
  ACTIVITY_COLORS[activity] || "#6b7280";

/* ─────────────── Efficiency badge ─────────────── */

function EfficiencyBadge({ hoursPerCU }: { hoursPerCU: number | null }) {
  if (hoursPerCU === null) return <span className="text-muted-foreground text-xs">N/A</span>;
  let color = "bg-green-100 text-green-800";
  if (hoursPerCU > 8) color = "bg-red-100 text-red-800";
  else if (hoursPerCU > 5) color = "bg-amber-100 text-amber-800";
  return (
    <Badge variant="outline" className={cn("text-xs font-mono", color)}>
      {hoursPerCU.toFixed(1)}h
    </Badge>
  );
}

/* ═══════════════ Page ═══════════════ */

export default function ProfitabilityPage() {
  // ── State ──
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [unmatchedProjects, setUnmatchedProjects] = useState<string[]>([]);
  const [meta, setMeta] = useState<any>(null);

  // Filters
  const now = new Date();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const [fromDate, setFromDate] = useState(twelveMonthsAgo.toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(now.toISOString().slice(0, 10));

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("totalHours");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Expanded client
  const [expandedClient, setExpandedClient] = useState<string | null>(null);

  // ── Fetch data ──
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const res = await fetch(`/api/operations/profitability?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setClients(data.clients || []);
      setTotals(data.totals || null);
      setUnmatchedProjects(data.unmatchedProjects || []);
      setMeta(data.meta || null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sort handler ──
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // ── Derived data ──
  const sortedClients = useMemo(() => sortRows(clients, sortKey, sortDir), [clients, sortKey, sortDir]);

  // Activity pie chart data
  const activityPieData = useMemo(() => {
    if (!totals) return [];
    return Object.entries(totals.activityTotals)
      .map(([name, value]) => ({ name, value: Math.round(value * 10) / 10 }))
      .sort((a, b) => b.value - a.value);
  }, [totals]);

  // Hours per CU bar chart data (only clients with hoursPerCU)
  const barChartData = useMemo(() => {
    return clients
      .filter((c) => c.hoursPerCU !== null && c.hoursPerCU > 0)
      .sort((a, b) => (b.hoursPerCU || 0) - (a.hoursPerCU || 0))
      .map((c) => ({
        name: c.clientName.length > 20 ? c.clientName.slice(0, 18) + "…" : c.clientName,
        fullName: c.clientName,
        hoursPerCU: c.hoursPerCU,
        totalHours: c.totalHours,
      }));
  }, [clients]);

  // ── Render ──
  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Profitability</h1>
        <p className="text-muted-foreground text-sm">
          Hours per content unit by client — powered by Clockify
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-2">
          <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-red-800">Failed to load profitability data</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">From</label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-40"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">To</label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-40"
              />
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "Loading…" : "Apply"}
            </button>
            {meta && (
              <span className="text-xs text-muted-foreground ml-auto">
                {meta.timeEntriesCount.toLocaleString()} time entries from {meta.clockifyClientsCount} Clockify clients
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-3 text-muted-foreground">Fetching Clockify data…</span>
        </div>
      )}

      {!loading && !error && totals && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> Total Hours
                </div>
                <div className="text-2xl font-bold mt-1">{fmtHours(totals.totalHours)}</div>
                <div className="text-xs text-muted-foreground">
                  {fmtHours(totals.totalBillableHours)} billable
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <BarChart3 className="h-3.5 w-3.5" /> CUs Delivered (period)
                </div>
                <div className="text-2xl font-bold mt-1">{totals.totalCUsInPeriod}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-3.5 w-3.5" /> Avg Hours / CU
                </div>
                <div className="text-2xl font-bold mt-1">
                  {totals.overallHoursPerCU !== null ? `${totals.overallHoursPerCU.toFixed(1)}h` : "—"}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs font-medium text-muted-foreground">Clients Tracked</div>
                <div className="text-2xl font-bold mt-1">{clients.length}</div>
                <div className="text-xs text-muted-foreground">
                  {clients.filter((c) => c.supabaseClientId).length} matched to contracts
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Hours per CU bar chart */}
            {barChartData.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold mb-4">Hours per CU by Client</h3>
                  <ResponsiveContainer width="100%" height={Math.max(300, barChartData.length * 32)}>
                    <BarChart
                      data={barChartData}
                      layout="vertical"
                      margin={{ top: 0, right: 30, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={140}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip
                        formatter={(value: any) => [`${Number(value).toFixed(1)}h`, "Hours / CU"]}
                        labelFormatter={(label: any, payload: any) => {
                          if (payload?.[0]?.payload?.fullName) return payload[0].payload.fullName;
                          return label;
                        }}
                      />
                      <Bar
                        dataKey="hoursPerCU"
                        radius={[0, 4, 4, 0]}
                        fill="#3b82f6"
                      >
                        {barChartData.map((entry, index) => {
                          const v = entry.hoursPerCU || 0;
                          let fill = "#22c55e"; // green ≤5
                          if (v > 8) fill = "#ef4444"; // red >8
                          else if (v > 5) fill = "#f59e0b"; // amber 5-8
                          return <Cell key={index} fill={fill} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Activity distribution pie */}
            {activityPieData.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold mb-4">Activity Distribution</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={activityPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }) =>
                          `${name as string} ${((percent as number) * 100).toFixed(0)}%`
                        }
                      >
                        {activityPieData.map((entry, index) => (
                          <Cell
                            key={index}
                            fill={getActivityColor(entry.name)}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: any) => [`${Number(value).toFixed(1)}h`, "Hours"]}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Client table */}
          <Card>
            <CardContent className="p-0">
              <div className="p-4 border-b">
                <h3 className="text-sm font-semibold">Client Breakdown</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 w-8"></th>
                      <th className="text-left p-3">
                        <SortHeader label="Client" sortKey="clientName" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                      </th>
                      <th className="text-right p-3">
                        <SortHeader label="Total Hours" sortKey="totalHours" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                      </th>
                      <th className="text-right p-3">
                        <SortHeader label="Content Prod" sortKey="contentProd" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                      </th>
                      <th className="text-right p-3">
                        <SortHeader label="Strategy" sortKey="strategy" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                      </th>
                      <th className="text-right p-3">
                        <SortHeader label="Acct Mgmt" sortKey="acctMgmt" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                      </th>
                      <th className="text-right p-3">
                        <SortHeader label="CUs (period)" sortKey="cusInPeriod" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                      </th>
                      <th className="text-right p-3">
                        <SortHeader label="Hours / CU" sortKey="hoursPerCU" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedClients.map((client) => {
                      const isExpanded = expandedClient === client.clockifyClientId;
                      // Add computed sort-friendly fields
                      const enriched = {
                        ...client,
                        contentProd: client.activityBreakdown["Content Production"] || 0,
                        strategy: client.activityBreakdown["Strategy"] || 0,
                        acctMgmt: client.activityBreakdown["Account Management"] || 0,
                      };

                      return (
                        <tr key={client.clockifyClientId} className="group">
                          <td colSpan={8} className="p-0">
                            {/* Main row */}
                            <button
                              className={cn(
                                "w-full flex items-center text-left hover:bg-muted/30 transition-colors",
                                isExpanded && "bg-muted/20"
                              )}
                              onClick={() =>
                                setExpandedClient(isExpanded ? null : client.clockifyClientId)
                              }
                            >
                              <div className="p-3 w-8 shrink-0">
                                {client.contracts.length > 0 ? (
                                  isExpanded ? (
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                  )
                                ) : (
                                  <span className="h-4 w-4 block" />
                                )}
                              </div>
                              <div className="p-3 flex-1 font-medium">
                                {client.clientName}
                                {client.supabaseClientName &&
                                  client.supabaseClientName !== client.clientName && (
                                    <span className="ml-2 text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                      → {client.supabaseClientName}
                                    </span>
                                  )}
                                {!client.supabaseClientId && (
                                  <span className="ml-2 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                    no contract match
                                  </span>
                                )}
                              </div>
                              <div className="p-3 w-28 text-right font-mono text-xs">
                                {fmtHours(enriched.totalHours)}
                              </div>
                              <div className="p-3 w-28 text-right font-mono text-xs">
                                {enriched.contentProd > 0 ? fmtHours(enriched.contentProd) : "—"}
                              </div>
                              <div className="p-3 w-28 text-right font-mono text-xs">
                                {enriched.strategy > 0 ? fmtHours(enriched.strategy) : "—"}
                              </div>
                              <div className="p-3 w-28 text-right font-mono text-xs">
                                {enriched.acctMgmt > 0 ? fmtHours(enriched.acctMgmt) : "—"}
                              </div>
                              <div className="p-3 w-28 text-right font-mono text-xs">
                                {client.cusInPeriod > 0 ? client.cusInPeriod : "—"}
                              </div>
                              <div className="p-3 w-28 text-right">
                                <EfficiencyBadge hoursPerCU={client.hoursPerCU} />
                              </div>
                            </button>

                            {/* Expanded contracts detail */}
                            {isExpanded && client.contracts.length > 0 && (
                              <div className="bg-muted/10 border-t px-8 py-3">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-muted-foreground">
                                      <th className="text-left py-1.5 font-medium">Contract</th>
                                      <th className="text-center py-1.5 font-medium">Period</th>
                                      <th className="text-right py-1.5 font-medium">Contracted</th>
                                      <th className="text-right py-1.5 font-medium">Delivered</th>
                                      <th className="text-center py-1.5 font-medium">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {client.contracts.map((contract) => (
                                      <tr key={contract.contractId} className="border-t border-muted/30">
                                        <td className="py-1.5 font-medium">{contract.contractName}</td>
                                        <td className="py-1.5 text-center text-muted-foreground">
                                          {fmtDate(contract.dateStart)} — {fmtDate(contract.dateEnd)}
                                        </td>
                                        <td className="py-1.5 text-right font-mono">{contract.cusContracted}</td>
                                        <td className="py-1.5 text-right font-mono">{contract.cusDelivered}</td>
                                        <td className="py-1.5 text-center">
                                          <Badge
                                            variant="outline"
                                            className={cn(
                                              "text-[10px]",
                                              contract.active
                                                ? "bg-green-50 text-green-700 border-green-200"
                                                : "bg-gray-50 text-gray-500 border-gray-200"
                                            )}
                                          >
                                            {contract.active ? "Active" : "Ended"}
                                          </Badge>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>

                                {/* Activity breakdown mini bars */}
                                <div className="mt-3 pt-3 border-t border-muted/30">
                                  <p className="text-xs font-medium text-muted-foreground mb-2">Activity hours breakdown</p>
                                  <div className="flex gap-4 flex-wrap">
                                    {Object.entries(client.activityBreakdown)
                                      .sort((a, b) => b[1] - a[1])
                                      .map(([activity, hours]) => (
                                        <div key={activity} className="flex items-center gap-2">
                                          <div
                                            className="w-2.5 h-2.5 rounded-full"
                                            style={{ backgroundColor: getActivityColor(activity) }}
                                          />
                                          <span className="text-xs text-muted-foreground">{activity}</span>
                                          <span className="text-xs font-mono font-medium">{fmtHours(hours)}</span>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}

                    {sortedClients.length === 0 && (
                      <tr>
                        <td colSpan={8} className="text-center py-12 text-muted-foreground">
                          No client data found for this date range
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Unmatched projects info */}
          {unmatchedProjects.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">{unmatchedProjects.length} Clockify project(s)</span>{" "}
              could not be matched to any data.
            </div>
          )}
        </>
      )}
    </div>
  );
}
