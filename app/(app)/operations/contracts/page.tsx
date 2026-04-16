"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Search,
  ExternalLink,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Building2,
  Clock,
  Globe,
  User,
  MapPin,
  ChevronDown,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadCSV } from "@/lib/csv-utils";
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

const PAGE_SIZE = 25;

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
  // Filters — no date filter on initial load to show all contracts
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<"1" | "0" | "all">("1");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const clientDropdownRef = useRef<HTMLDivElement>(null);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);

  // Data
  const [clients, setClients] = useState<Client[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractDetail, setContractDetail] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sort states
  const contractSort = useSort("contractName", true);
  const contentSort = useSort("dateCreated", false);
  const typeSort = useSort("cus", false);
  const formatSort = useSort("cus", false);

  // Content search + pagination
  const [contentSearch, setContentSearch] = useState("");
  const [contentPage, setContentPage] = useState(0);

  // ── Fetch base data ──
  const fetchBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedClientId) params.set("clientId", selectedClientId);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      params.set("active", statusFilter);

      const res = await fetch(`/api/operations/contracts?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `API error ${res.status}`);
        return;
      }
      setClients(data.clients || []);
      setContracts(data.contracts || []);
    } catch (err: any) {
      console.error("Failed to fetch contracts:", err);
      setError(err.message || "Failed to fetch contracts");
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
      setContentSearch("");
      setContentPage(0);
      fetchDetail(selectedContractId);
    } else {
      setContractDetail(null);
    }
  }, [selectedContractId, fetchDetail]);

  // Reset contract selection when client changes
  useEffect(() => {
    setSelectedContractId(null);
  }, [selectedClientId]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target as Node)) {
        setClientDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close modal on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedContractId) {
        setSelectedContractId(null);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [selectedContractId]);

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

  // Content: filter → sort → paginate
  const filteredContent = useMemo(() => {
    if (!contractDetail) return [];
    if (!contentSearch.trim()) return contractDetail.content;
    const q = contentSearch.toLowerCase();
    return contractDetail.content.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.type.toLowerCase().includes(q) ||
        (item.assignee && item.assignee.toLowerCase().includes(q))
    );
  }, [contractDetail, contentSearch]);

  const sortedContent = useMemo(
    () => sortRows(filteredContent, contentSort.currentSort, contentSort.currentAsc),
    [filteredContent, contentSort.currentSort, contentSort.currentAsc]
  );

  const totalContentPages = Math.max(1, Math.ceil(sortedContent.length / PAGE_SIZE));
  const pagedContent = useMemo(
    () => sortedContent.slice(contentPage * PAGE_SIZE, (contentPage + 1) * PAGE_SIZE),
    [sortedContent, contentPage]
  );

  // Reset page when search or sort changes
  useEffect(() => {
    setContentPage(0);
  }, [contentSearch, contentSort.currentSort, contentSort.currentAsc]);

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

      {/* Error display */}
      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950 shadow-sm">
          <CardContent className="p-3">
            <p className="text-xs text-red-600 dark:text-red-400">
              <strong>Error:</strong> {error}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Filter Bar ── */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            {/* Customer dropdown */}
            <div className="min-w-[220px] relative" ref={clientDropdownRef}>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                Customer
              </label>
              <button
                type="button"
                onClick={() => {
                  setClientDropdownOpen(!clientDropdownOpen);
                  setClientSearch("");
                }}
                className={cn(
                  "flex items-center justify-between w-full h-8 rounded-md border bg-background px-2.5 text-xs transition-colors hover:bg-muted/50",
                  clientDropdownOpen && "ring-2 ring-ring"
                )}
              >
                <span className={cn(!selectedClientId && "text-muted-foreground")}>
                  {selectedClient?.name || "All customers"}
                </span>
                <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", clientDropdownOpen && "rotate-180")} />
              </button>

              {clientDropdownOpen && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-background shadow-lg">
                  <div className="p-1.5 border-b">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                      <Input
                        autoFocus
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                        placeholder="Search..."
                        className="h-7 text-xs pl-7 border-0 shadow-none focus-visible:ring-0"
                      />
                    </div>
                  </div>
                  <div className="max-h-52 overflow-auto py-1">
                    <button
                      className={cn(
                        "w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center justify-between",
                        !selectedClientId && "font-medium text-primary"
                      )}
                      onClick={() => { setSelectedClientId(null); setClientDropdownOpen(false); setClientSearch(""); }}
                    >
                      All customers
                      {!selectedClientId && <Check className="h-3 w-3" />}
                    </button>
                    {filteredClients.map((c) => (
                      <button
                        key={c.clientId}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center justify-between",
                          selectedClientId === c.clientId && "font-medium text-primary"
                        )}
                        onClick={() => { setSelectedClientId(c.clientId); setClientDropdownOpen(false); setClientSearch(""); }}
                      >
                        {c.name}
                        {selectedClientId === c.clientId && <Check className="h-3 w-3" />}
                      </button>
                    ))}
                    {filteredClients.length === 0 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">No customers found</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Date range */}
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">From</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs w-[140px]" />
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">To</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs w-[140px]" />
            </div>

            {/* Status toggle */}
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Status</label>
              <div className="flex rounded-md border overflow-hidden">
                {(["1", "0", "all"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setStatusFilter(v)}
                    className={cn(
                      "px-3 py-1.5 text-[11px] font-medium transition-colors",
                      statusFilter === v ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
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
                  {selectedClient.industry && <Badge variant="secondary" className="text-[10px]">{selectedClient.industry}</Badge>}
                  {selectedClient.size && (
                    <Badge variant="outline" className="text-[10px] gap-1"><User className="h-2.5 w-2.5" />{selectedClient.size}</Badge>
                  )}
                  {selectedClient.timezone && (
                    <Badge variant="outline" className="text-[10px] gap-1"><MapPin className="h-2.5 w-2.5" />{selectedClient.timezone}</Badge>
                  )}
                </div>
                {selectedClient.description && (
                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{selectedClient.description}</p>
                )}
                <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                  {selectedClient.accountManager && (
                    <span className="flex items-center gap-1"><User className="h-3 w-3" /> {selectedClient.accountManager}</span>
                  )}
                  {selectedClient.website && (
                    <a
                      href={selectedClient.website.startsWith("http") ? selectedClient.website : `https://${selectedClient.website}`}
                      target="_blank" rel="noopener noreferrer"
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
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Contracts ({contracts.length})
            </h3>
            {sortedContracts.length > 0 && (
              <button
                onClick={() => downloadCSV(
                  sortedContracts.map((c) => ({
                    Contract: c.contractName,
                    Client: c.clientName,
                    Start: c.dateStart || "",
                    End: c.dateEnd || "",
                    Contracted: Math.round((c.cusContract || 0) * 10) / 10,
                    Delivered: Math.round((c.cusDelivered || 0) * 10) / 10,
                  })),
                  "contracts.csv"
                )}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Download CSV"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
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
                      onClick={() => setSelectedContractId(c.contractId)}
                      className="border-b cursor-pointer transition-colors hover:bg-muted/50"
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

      {/* ── Contract Detail Modal ── */}
      {selectedContractId && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 pb-8">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setSelectedContractId(null)}
          />

          {/* Modal content */}
          <div className="relative z-10 w-full max-w-5xl max-h-[calc(100vh-4rem)] overflow-y-auto rounded-xl border bg-background shadow-2xl mx-4">
            {/* Modal header */}
            <div className="sticky top-0 z-20 flex items-center justify-between px-5 py-3 border-b bg-background/95 backdrop-blur-sm rounded-t-xl">
              <div>
                <h2 className="text-sm font-semibold">{selectedContract?.contractName || "Contract"}</h2>
                <p className="text-[11px] text-muted-foreground">{selectedContract?.clientName}</p>
              </div>
              <button
                onClick={() => setSelectedContractId(null)}
                className="p-1.5 rounded-md hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {detailLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : contractDetail && selectedContract ? (
              <div className="p-5 space-y-5">
                {/* KPI Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    { label: "Start", value: fmtDate(selectedContract.dateStart) },
                    { label: "End", value: fmtDate(selectedContract.dateEnd) },
                    { label: "Contracted CUs", value: String(selectedContract.cusContract) },
                    { label: "Delivered CUs", value: String(selectedContract.cusDelivered) },
                    { label: "Commissioned CUs", value: String(contractDetail.commissionedCUs) },
                    { label: "Spiked CUs", value: String(contractDetail.spikedCUs) },
                  ].map((kpi) => (
                    <Card key={kpi.label} className="border shadow-none">
                      <CardContent className="p-3">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{kpi.label}</p>
                        <p className="text-lg font-semibold mt-1">{kpi.value}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Avg Production Time */}
                {contractDetail.avgProductionTime.length > 0 && (
                  <Card className="border shadow-none">
                    <CardContent className="p-0">
                      <div className="px-4 pt-4 pb-2">
                        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" /> Average Production Time
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

                {/* Content Types + Formats — side by side */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {/* Content Types */}
                  {contractDetail.contentTypes.length > 0 && (
                    <Card className="border shadow-none">
                      <CardContent className="p-0">
                        <div className="px-4 pt-4 pb-2">
                          <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Content Types</h3>
                        </div>
                        <div className="flex flex-col items-center">
                          <ResponsiveContainer width="100%" height={200}>
                            <PieChart>
                              <Pie
                                data={contractDetail.contentTypes}
                                dataKey="cus" nameKey="name"
                                cx="50%" cy="50%"
                                outerRadius={75} innerRadius={35}
                                paddingAngle={2}
                                label={({ name, percent }) => `${name as string} ${((percent as number) * 100).toFixed(0)}%`}
                                labelLine={false}
                                style={{ fontSize: 9 }}
                              >
                                {contractDetail.contentTypes.map((entry) => (
                                  <Cell key={entry.name} fill={CATEGORY_HEX[entry.name] || "#6b7280"} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(value) => [`${value} CUs`, "Content Units"]} contentStyle={{ fontSize: 11 }} />
                            </PieChart>
                          </ResponsiveContainer>
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
                                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: CATEGORY_HEX[t.name] || "#6b7280" }} />
                                      {t.name}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums">{t.count}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{t.cus}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Content Formats */}
                  {contractDetail.contentFormats.length > 0 && (
                    <Card className="border shadow-none">
                      <CardContent className="p-0">
                        <div className="px-4 pt-4 pb-2">
                          <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Content Formats</h3>
                        </div>
                        <div className="flex flex-col items-center">
                          <ResponsiveContainer width="100%" height={200}>
                            <PieChart>
                              <Pie
                                data={contractDetail.contentFormats}
                                dataKey="cus" nameKey="name"
                                cx="50%" cy="50%"
                                outerRadius={75} innerRadius={35}
                                paddingAngle={2}
                                label={({ name, percent }) => `${(name as string).replace(/_/g, " ")} ${((percent as number) * 100).toFixed(0)}%`}
                                labelLine={false}
                                style={{ fontSize: 9 }}
                              >
                                {contractDetail.contentFormats.map((entry) => (
                                  <Cell key={entry.name} fill={getTypeHex(entry.name)} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(value) => [`${value} CUs`, "Content Units"]} contentStyle={{ fontSize: 11 }} />
                            </PieChart>
                          </ResponsiveContainer>
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
                                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: getTypeHex(f.name) }} />
                                      {f.name.replace(/_/g, " ")}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums">{f.count}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{f.cus}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* All Content — with search + pagination */}
                <Card className="border shadow-none">
                  <CardContent className="p-0">
                    <div className="px-4 pt-4 pb-2 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Content ({filteredContent.length})
                      </h3>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                        <Input
                          value={contentSearch}
                          onChange={(e) => setContentSearch(e.target.value)}
                          placeholder="Search content..."
                          className="h-7 text-xs pl-7 w-[200px]"
                        />
                      </div>
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
                          {pagedContent.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                                {contentSearch ? "No matching content" : "No content items"}
                              </td>
                            </tr>
                          ) : (
                            pagedContent.map((item, idx) => (
                              <tr key={item.contentId || `item-${idx}`} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                                <td className="px-3 py-2 font-medium max-w-[250px] truncate">{item.name}</td>
                                <td className="px-3 py-2">
                                  <Badge
                                    variant="secondary"
                                    className={cn("text-[9px] border-0", typeColors[item.type.toLowerCase()] || typeColors.other)}
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
                                      target="_blank" rel="noopener noreferrer"
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
                    {/* Pagination */}
                    {totalContentPages > 1 && (
                      <div className="flex items-center justify-between px-4 py-2 border-t">
                        <p className="text-[10px] text-muted-foreground">
                          {contentPage * PAGE_SIZE + 1}\u2013{Math.min((contentPage + 1) * PAGE_SIZE, sortedContent.length)} of {sortedContent.length}
                        </p>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setContentPage(Math.max(0, contentPage - 1))}
                            disabled={contentPage === 0}
                            className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </button>
                          <span className="text-[10px] text-muted-foreground px-1">
                            {contentPage + 1} / {totalContentPages}
                          </span>
                          <button
                            onClick={() => setContentPage(Math.min(totalContentPages - 1, contentPage + 1))}
                            disabled={contentPage >= totalContentPages - 1}
                            className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
