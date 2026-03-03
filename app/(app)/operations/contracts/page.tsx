"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  CalendarDays,
  Search,
  ExternalLink,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Building2,
  FileText,
  Zap,
  Clock,
  Globe,
  User,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getTypeHex,
  typeColors,
} from "@/lib/content-type-utils";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

/* ─────────────── Types ─────────────── */

interface Client {
  clientId: string;
  name: string;
  description: string | null;
  industry: string | null;
  accountManager: string | null;
  website: string | null;
  linkedin: string | null;
  size: string | null;
  timezone: string | null;
}

interface Contract {
  contractId: string;
  clientId: string | null;
  clientName: string;
  contractName: string;
  dateStart: string | null;
  dateEnd: string | null;
  cusContract: number;
  cusDelivered: number;
  active: boolean;
  accountManager: string | null;
  description: string | null;
}

interface ContentItem {
  taskId: string;
  contentId: string | null;
  name: string;
  type: string;
  cus: number;
  dateCreated: string | null;
  dateCompleted: string | null;
  assignee: string | null;
}

interface ContractDetail {
  commissionedCUs: number;
  spikedCUs: number;
  avgProductionTime: { category: string; avgDays: number; sampleCount: number }[];
  contentTypes: { name: string; count: number; cus: number }[];
  contentFormats: { name: string; count: number; cus: number }[];
  content: ContentItem[];
}

/* ─────────────── Helpers ─────────────── */

const getThisYearRange = () => {
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31` };
};

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

export default function ContractsPage() {
  const initRange = getThisYearRange();

  // Filters
  const [dateFrom, setDateFrom] = useState(initRange.from);
  const [dateTo, setDateTo] = useState(initRange.to);
  const [statusFilter, setStatusFilter] = useState<"1" | "0" | "all">("1");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);

  // Data
  const [clients, setClients] = useState<Client[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractDetail, setContractDetail] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  // Sort states
  const contractSort = useSort("contractName", true);
  const contentSort = useSort("dateCreated", false);
  const typeSort = useSort("cus", false);
  const formatSort = useSort("cus", false);

  // ── Fetch base data ──
  const fetchBase = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedClientId) params.set("clientId", selectedClientId);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      params.set("active", statusFilter);

      const res = await fetch(`/api/operations/contracts?${params}`);
      const data = await res.json();
      if (data.clients) setClients(data.clients);
      if (data.contracts) setContracts(data.contracts);
    } catch (err) {
      console.error("Failed to fetch contracts:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedClientId, dateFrom, dateTo, statusFilter]);

  // ── Fetch contract detail ──
  const fetchDetail = useCallback(async (cId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/operations/contracts?contractId=${cId}`);
      const data = await res.json();
      if (data.contractDetail) setContractDetail(data.contractDetail);
    } catch (err) {
      console.error("Failed to fetch contract detail:", err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBase();
  }, [fetchBase]);

  useEffect(() => {
    if (selectedContractId) {
      fetchDetail(selectedContractId);
    } else {
      setContractDetail(null);
    }
  }, [selectedContractId, fetchDetail]);

  // Reset contract selection when client changes
  useEffect(() => {
    setSelectedContractId(null);
  }, [selectedClientId]);

  // ── Derived data ──
  const selectedClient = useMemo(
    () => clients.find((c) => c.clientId === selectedClientId) || null,
    [clients, selectedClientId]
  );

  const selectedContract = useMemo(
    () => contracts.find((c) => c.contractId === selectedContractId) || null,
    [contracts, selectedContractId]
  );

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients;
    const q = clientSearch.toLowerCase();
    return clients.filter((c) => c.name.toLowerCase().includes(q));
  }, [clients, clientSearch]);

  const sortedContracts = useMemo(
    () => sortRows(contracts, contractSort.currentSort, contractSort.currentAsc),
    [contracts, contractSort.currentSort, contractSort.currentAsc]
  );

  const sortedContent = useMemo(() => {
    if (!contractDetail) return [];
    return sortRows(contractDetail.content, contentSort.currentSort, contentSort.currentAsc);
  }, [contractDetail, contentSort.currentSort, contentSort.currentAsc]);

  const sortedTypes = useMemo(() => {
    if (!contractDetail) return [];
    return sortRows(contractDetail.contentTypes, typeSort.currentSort, typeSort.currentAsc);
  }, [contractDetail, typeSort.currentSort, typeSort.currentAsc]);

  const sortedFormats = useMemo(() => {
    if (!contractDetail) return [];
    return sortRows(contractDetail.contentFormats, formatSort.currentSort, formatSort.currentAsc);
  }, [contractDetail, formatSort.currentSort, formatSort.currentAsc]);

  // ── Render ──
  if (loading && clients.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold">Contracts</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Explore contract details, content types, production times, and commissioned content.
        </p>
      </div>

      {/* ── Filter Bar ── */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            {/* Customer dropdown */}
            <div className="min-w-[220px]">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                Customer
              </label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Search customers..."
                  className="h-8 text-xs pl-8"
                />
              </div>
              {clientSearch && filteredClients.length > 0 && (
                <div className="absolute z-50 mt-1 max-h-48 w-[220px] overflow-auto rounded-md border bg-background shadow-lg">
                  {filteredClients.slice(0, 20).map((c) => (
                    <button
                      key={c.clientId}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                      onClick={() => {
                        setSelectedClientId(c.clientId);
                        setClientSearch("");
                      }}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              {selectedClientId && (
                <div className="flex items-center gap-1 mt-1.5">
                  <Badge variant="secondary" className="text-[10px] gap-1">
                    {selectedClient?.name || "Customer"}
                    <button
                      onClick={() => setSelectedClientId(null)}
                      className="ml-0.5 hover:text-destructive"
                    >
                      &times;
                    </button>
                  </Badge>
                </div>
              )}
            </div>

            {/* Date range */}
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                From
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 text-xs w-[140px]"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                To
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 text-xs w-[140px]"
              />
            </div>

            {/* Status toggle */}
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                Status
              </label>
              <div className="flex rounded-md border overflow-hidden">
                {(["1", "0", "all"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setStatusFilter(v)}
                    className={cn(
                      "px-3 py-1.5 text-[11px] font-medium transition-colors",
                      statusFilter === v
                        ? "bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted"
                    )}
                  >
                    {v === "1" ? "Active" : v === "0" ? "Inactive" : "All"}
                  </button>
                ))}
              </div>
            </div>

            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </CardContent>
      </Card>

      {/* ── Customer Details ── */}
      {selectedClient && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="shrink-0 h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-blue-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold">{selectedClient.name}</h2>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {selectedClient.industry && (
                    <Badge variant="secondary" className="text-[10px]">{selectedClient.industry}</Badge>
                  )}
                  {selectedClient.size && (
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <User className="h-2.5 w-2.5" />
                      {selectedClient.size}
                    </Badge>
                  )}
                  {selectedClient.timezone && (
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <MapPin className="h-2.5 w-2.5" />
                      {selectedClient.timezone}
                    </Badge>
                  )}
                </div>
                {selectedClient.description && (
                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                    {selectedClient.description}
                  </p>
                )}
                <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                  {selectedClient.accountManager && (
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" /> {selectedClient.accountManager}
                    </span>
                  )}
                  {selectedClient.website && (
                    <a
                      href={selectedClient.website.startsWith("http") ? selectedClient.website : `https://${selectedClient.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      <Globe className="h-3 w-3" /> Website
                    </a>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Contract Selector Table ── */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="px-4 pt-4 pb-2">
            <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Contracts ({contracts.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <SortHeader label="Contract" sortKey="contractName" {...contractSort} onSort={contractSort.toggle} />
                  <SortHeader label="Client" sortKey="clientName" {...contractSort} onSort={contractSort.toggle} />
                  <SortHeader label="Start" sortKey="dateStart" {...contractSort} onSort={contractSort.toggle} />
                  <SortHeader label="End" sortKey="dateEnd" {...contractSort} onSort={contractSort.toggle} />
                  <SortHeader label="Contracted" sortKey="cusContract" align="right" {...contractSort} onSort={contractSort.toggle} />
                  <SortHeader label="Delivered" sortKey="cusDelivered" align="right" {...contractSort} onSort={contractSort.toggle} />
                </tr>
              </thead>
              <tbody>
                {sortedContracts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      No contracts found
                    </td>
                  </tr>
                ) : (
                  sortedContracts.map((c) => (
                    <tr
                      key={c.contractId}
                      onClick={() => setSelectedContractId(
                        selectedContractId === c.contractId ? null : c.contractId
                      )}
                      className={cn(
                        "border-b cursor-pointer transition-colors",
                        selectedContractId === c.contractId
                          ? "bg-primary/5"
                          : "hover:bg-muted/50"
                      )}
                    >
                      <td className="px-3 py-2 font-medium">{c.contractName}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.clientName}</td>
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(c.dateStart)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(c.dateEnd)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.cusContract}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.cusDelivered}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Contract Detail Section ── */}
      {selectedContractId && (
        <>
          {detailLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : contractDetail && selectedContract ? (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: "Start", value: fmtDate(selectedContract.dateStart), icon: CalendarDays, color: "blue" },
                  { label: "End", value: fmtDate(selectedContract.dateEnd), icon: CalendarDays, color: "blue" },
                  { label: "Contracted CUs", value: String(selectedContract.cusContract), icon: FileText, color: "violet" },
                  { label: "Delivered CUs", value: String(selectedContract.cusDelivered), icon: Zap, color: "green" },
                  { label: "Commissioned CUs", value: String(contractDetail.commissionedCUs), icon: Zap, color: "amber" },
                  { label: "Spiked CUs", value: String(contractDetail.spikedCUs), icon: Zap, color: "red" },
                ].map((kpi) => (
                  <Card key={kpi.label} className="border-0 shadow-sm">
                    <CardContent className="p-3">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        {kpi.label}
                      </p>
                      <p className="text-lg font-semibold mt-1">{kpi.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Avg Production Time */}
              {contractDetail.avgProductionTime.length > 0 && (
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-0">
                    <div className="px-4 pt-4 pb-2">
                      <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        Average Production Time
                      </h3>
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b">
                          <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Category</th>
                          <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Avg Days</th>
                          <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Sample</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contractDetail.avgProductionTime.map((row) => (
                          <tr key={row.category} className="border-b last:border-0">
                            <td className="px-3 py-2 font-medium">{row.category}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{row.avgDays}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.sampleCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}

              {/* Content Types — table + pie */}
              {contractDetail.contentTypes.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <Card className="border-0 shadow-sm">
                    <CardContent className="p-0">
                      <div className="px-4 pt-4 pb-2">
                        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                          Content Types
                        </h3>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b">
                            <SortHeader label="Type" sortKey="name" {...typeSort} onSort={typeSort.toggle} />
                            <SortHeader label="Count" sortKey="count" align="right" {...typeSort} onSort={typeSort.toggle} />
                            <SortHeader label="CUs" sortKey="cus" align="right" {...typeSort} onSort={typeSort.toggle} />
                          </tr>
                        </thead>
                        <tbody>
                          {sortedTypes.map((t) => (
                            <tr key={t.name} className="border-b last:border-0">
                              <td className="px-3 py-2 font-medium">
                                <span className="inline-flex items-center gap-1.5">
                                  <span
                                    className="h-2 w-2 rounded-full shrink-0"
                                    style={{ backgroundColor: CATEGORY_HEX[t.name] || "#6b7280" }}
                                  />
                                  {t.name}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">{t.count}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{t.cus}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                  <Card className="border-0 shadow-sm">
                    <CardContent className="p-4 flex items-center justify-center">
                      <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                          <Pie
                            data={contractDetail.contentTypes}
                            dataKey="cus"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            outerRadius={90}
                            innerRadius={40}
                            paddingAngle={2}
                            label={({ name, percent }) =>
                              `${name as string} ${((percent as number) * 100).toFixed(0)}%`
                            }
                            labelLine={false}
                            style={{ fontSize: 10 }}
                          >
                            {contractDetail.contentTypes.map((entry) => (
                              <Cell
                                key={entry.name}
                                fill={CATEGORY_HEX[entry.name] || "#6b7280"}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value) => [`${value} CUs`, "Content Units"]}
                            contentStyle={{ fontSize: 11 }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Content Formats — table + pie */}
              {contractDetail.contentFormats.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <Card className="border-0 shadow-sm">
                    <CardContent className="p-0">
                      <div className="px-4 pt-4 pb-2">
                        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                          Content Formats
                        </h3>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b">
                            <SortHeader label="Format" sortKey="name" {...formatSort} onSort={formatSort.toggle} />
                            <SortHeader label="Count" sortKey="count" align="right" {...formatSort} onSort={formatSort.toggle} />
                            <SortHeader label="CUs" sortKey="cus" align="right" {...formatSort} onSort={formatSort.toggle} />
                          </tr>
                        </thead>
                        <tbody>
                          {sortedFormats.map((f) => (
                            <tr key={f.name} className="border-b last:border-0">
                              <td className="px-3 py-2 font-medium">
                                <span className="inline-flex items-center gap-1.5">
                                  <span
                                    className="h-2 w-2 rounded-full shrink-0"
                                    style={{ backgroundColor: getTypeHex(f.name) }}
                                  />
                                  {f.name.replace(/_/g, " ")}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">{f.count}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{f.cus}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                  <Card className="border-0 shadow-sm">
                    <CardContent className="p-4 flex items-center justify-center">
                      <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                          <Pie
                            data={contractDetail.contentFormats}
                            dataKey="cus"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            outerRadius={90}
                            innerRadius={40}
                            paddingAngle={2}
                            label={({ name, percent }) =>
                              `${(name as string).replace(/_/g, " ")} ${((percent as number) * 100).toFixed(0)}%`
                            }
                            labelLine={false}
                            style={{ fontSize: 10 }}
                          >
                            {contractDetail.contentFormats.map((entry) => (
                              <Cell
                                key={entry.name}
                                fill={getTypeHex(entry.name)}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value) => [`${value} CUs`, "Content Units"]}
                            contentStyle={{ fontSize: 11 }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* All Content Commissioned */}
              <Card className="border-0 shadow-sm">
                <CardContent className="p-0">
                  <div className="px-4 pt-4 pb-2">
                    <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      All Content Commissioned ({contractDetail.content.length})
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b">
                          <SortHeader label="Name" sortKey="name" {...contentSort} onSort={contentSort.toggle} />
                          <SortHeader label="Type" sortKey="type" {...contentSort} onSort={contentSort.toggle} />
                          <SortHeader label="CUs" sortKey="cus" align="right" {...contentSort} onSort={contentSort.toggle} />
                          <SortHeader label="Created" sortKey="dateCreated" {...contentSort} onSort={contentSort.toggle} />
                          <SortHeader label="Completed" sortKey="dateCompleted" {...contentSort} onSort={contentSort.toggle} />
                          <SortHeader label="Assignee" sortKey="assignee" {...contentSort} onSort={contentSort.toggle} />
                          <th className="px-3 py-2 w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedContent.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                              No content items
                            </td>
                          </tr>
                        ) : (
                          sortedContent.map((item) => (
                            <tr key={item.taskId} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                              <td className="px-3 py-2 font-medium max-w-[250px] truncate">
                                {item.name}
                              </td>
                              <td className="px-3 py-2">
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    "text-[9px] border-0",
                                    typeColors[item.type.toLowerCase()] || typeColors.other
                                  )}
                                >
                                  {item.type.replace(/_/g, " ")}
                                </Badge>
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">{item.cus}</td>
                              <td className="px-3 py-2 text-muted-foreground">{fmtDate(item.dateCreated)}</td>
                              <td className="px-3 py-2 text-muted-foreground">{fmtDate(item.dateCompleted)}</td>
                              <td className="px-3 py-2 text-muted-foreground truncate max-w-[120px]">{item.assignee || "\u2014"}</td>
                              <td className="px-3 py-2">
                                {item.contentId && (
                                  <a
                                    href={`https://app.thecontentengine.com/content/${item.contentId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
