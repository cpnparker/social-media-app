"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2,
  ExternalLink,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  CalendarDays,
  CalendarClock,
  Inbox,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadCSV } from "@/lib/csv-utils";
import { addDays, mondayOf, workspaceTodayISO } from "@/lib/date-utils";
import { cuHeatLevel, deadlineBucket, isOverdue, personColumn, type DeadlineBucket } from "@/lib/workload";
import { canonicalUserId, expandAliases } from "@/lib/teams";

/* ─────────────── Types ─────────────── */

export interface WorkTask {
  taskId: string;
  source: "content" | "social";
  contentId: string | null;
  socialId: string | null;
  taskTitle: string;
  taskCUs: number;
  deadline: string | null;
  active: boolean;
  contentCreatedAt: string | null;
  contentTitle: string;
  contentType: string;
  network: string | null;
  customerId: string | null;
  customerName: string;
  internal: boolean;
  assigneeId: string;
  assigneeName: string;
}

interface Props {
  selectedUserIds: string[];
  searchQuery: string;
  globalCustomerId: string | null;
  includeInternal: boolean;
}

/* ─────────────── Helpers ─────────────── */

const ENGINE = "https://app.thecontentengine.com";

function engineLink(t: WorkTask): string | null {
  // Social promos live under the client, not "all" (lib/ai/system-prompts.ts, Engine Links).
  if (t.source === "social" && t.socialId) return `${ENGINE}/${t.customerId || "all"}/social-media/all-social-promos/${t.socialId}`;
  if (t.contentId) return `${ENGINE}/all/contents/${t.contentId}`;
  return null;
}

function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  return new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
};

const fmtDayMonth = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// "3–4 Oct", or "31 Oct–1 Nov" when the weekend spans a month end.
const fmtRange = (a: string, b: string) =>
  a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8))}–${fmtDayMonth(b)}` : `${fmtDayMonth(a)}–${fmtDayMonth(b)}`;

const sumCUs = (rows: WorkTask[]) => rows.reduce((s, t) => s + t.taskCUs, 0);

// One scale for calendar chips and table cells, readable in light and dark.
const HEAT = [
  "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100",
  "bg-orange-200 text-orange-950 dark:bg-orange-900/60 dark:text-orange-100",
  "bg-orange-400 text-orange-950 dark:bg-orange-700 dark:text-orange-50",
  "bg-red-600 text-white dark:bg-red-700 dark:text-white",
];
const HEAT_LABELS = ["0", "≤ 0.5", "≤ 1", "≤ 2", "> 2"];
const heat = (cus: number) => HEAT[cuHeatLevel(cus)];

/* ─── Sorting (same idiom as the other operations pages) ─── */

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
        "px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors group whitespace-nowrap",
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
    else if (typeof av === "boolean" && typeof bv === "boolean") cmp = Number(av) - Number(bv);
    else cmp = String(av).localeCompare(String(bv));
    return asc ? cmp : -cmp;
  });
}

/* ─────────────── Task table (the four Retool modules) ─────────────── */

function TaskTable({
  rows,
  today,
  showDeadline,
  emptyText,
  csvName,
  defaultSort = "deadline",
}: {
  rows: WorkTask[];
  today: string;
  showDeadline: boolean;
  emptyText: string;
  csvName: string;
  defaultSort?: string;
}) {
  const sort = useSort(showDeadline ? defaultSort : "taskCUs", showDeadline);
  const sorted = useMemo(() => sortRows(rows, sort.currentSort, sort.currentAsc), [rows, sort.currentSort, sort.currentAsc]);

  const exportCsv = () =>
    downloadCSV(
      sorted.map((t) => ({
        Person: t.assigneeName,
        Client: t.customerName,
        Content: t.contentTitle,
        Type: t.contentType,
        Task: t.taskTitle,
        Status: t.active ? "Active" : "Queued",
        CUs: t.taskCUs.toFixed(2),
        "Content created": t.contentCreatedAt || "",
        ...(showDeadline ? { Deadline: t.deadline || "" } : {}),
        Link: engineLink(t) || "",
      })),
      csvName
    );

  return (
    <div className="relative">
      {rows.length > 0 && (
        <button
          onClick={exportCsv}
          className="absolute -top-8 right-3 text-muted-foreground hover:text-foreground transition-colors"
          title="Download CSV"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      )}
      <div className="overflow-auto max-h-[420px]">
        {/* table-fixed: columns take these shares of whatever width the card
            has and long text truncates (full text in the tooltip), so CUs and
            Deadline are never pushed off-screen on a laptop. */}
        <table className="w-full text-xs table-fixed">
          <colgroup>
            <col className={showDeadline ? "w-[16%]" : "w-[18%]"} />
            <col className={showDeadline ? "w-[14%]" : "w-[16%]"} />
            <col className={showDeadline ? "w-[25%]" : "w-[29%]"} />
            <col className="w-[17%]" />
            <col className="w-[9%]" />
            <col className={showDeadline ? "w-[9%]" : "w-[11%]"} />
            {showDeadline && <col className="w-[10%]" />}
            <col className="w-8" />
          </colgroup>
          <thead className="sticky top-0 bg-background z-[1]">
            <tr className="border-b">
              <SortHeader label="Person" sortKey="assigneeName" {...sort} onSort={sort.toggle} />
              <SortHeader label="Client" sortKey="customerName" {...sort} onSort={sort.toggle} />
              <SortHeader label="Content" sortKey="contentTitle" {...sort} onSort={sort.toggle} />
              <SortHeader label="Task" sortKey="taskTitle" {...sort} onSort={sort.toggle} />
              <SortHeader label="CUs" sortKey="taskCUs" {...sort} onSort={sort.toggle} align="right" />
              <SortHeader label="Created" sortKey="contentCreatedAt" {...sort} onSort={sort.toggle} />
              {showDeadline && <SortHeader label="Deadline" sortKey="deadline" {...sort} onSort={sort.toggle} />}
              <th className="px-3 py-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={showDeadline ? 8 : 7} className="px-3 py-6 text-center text-muted-foreground">
                  {emptyText}
                </td>
              </tr>
            ) : (
              sorted.map((t) => {
                const overdue = isOverdue(t.deadline, today);
                const link = engineLink(t);
                return (
                  <tr key={t.taskId} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5 min-w-0" title={t.assigneeName}>
                        <span className="h-5 w-5 rounded-full bg-muted text-[9px] font-semibold flex items-center justify-center shrink-0">
                          {initials(t.assigneeName)}
                        </span>
                        <span className="truncate">{t.assigneeName}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 truncate" title={t.customerName}>
                      {t.customerName}
                      {t.internal && (
                        <span className="ml-1 text-[9px] uppercase tracking-wide text-muted-foreground">internal</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <p className="truncate" title={t.contentTitle}>{t.contentTitle}</p>
                      <p className="truncate text-[10px] text-muted-foreground capitalize">
                        {t.contentType}
                        {t.network && ` · ${t.network}`}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] capitalize",
                          t.active ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : "bg-muted text-muted-foreground"
                        )}
                        title={t.active ? "Active — the step being worked on now" : "Queued — waiting on an earlier step of this content"}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full shrink-0",
                            t.active ? "bg-emerald-500" : "border border-muted-foreground"
                          )}
                        />
                        <span className="truncate">{t.taskTitle}</span>
                      </span>
                    </td>
                    <td className="px-1 py-1 text-right">
                      <span className={cn("inline-block min-w-[2.75rem] rounded px-1.5 py-1 tabular-nums font-medium", heat(t.taskCUs))}>
                        {t.taskCUs.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-2 py-2 truncate text-muted-foreground">{fmtDate(t.contentCreatedAt)}</td>
                    {showDeadline && (
                      <td className={cn("px-2 py-1.5 truncate", overdue && "text-red-600 dark:text-red-400 font-medium")}>
                        {fmtDate(t.deadline)}
                        {overdue && <span className="block text-[9px] uppercase tracking-wide">overdue</span>}
                      </td>
                    )}
                    <td className="px-3 py-2 text-center">
                      {link && (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600" title="Open in the Engine">
                          <ExternalLink className="h-3 w-3 inline" />
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModuleCard({
  title,
  subtitle,
  icon,
  total,
  count,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  icon: React.ReactNode;
  total?: number;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b flex items-center gap-2 pr-10">
          {icon}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{title}</h3>
            {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
          </div>
          {total != null && (
            <div className="ml-auto text-right">
              <p className="text-sm font-bold tabular-nums">{total.toFixed(2)} CU</p>
              {count != null && <p className="text-[10px] text-muted-foreground tabular-nums">{count} task{count === 1 ? "" : "s"}</p>}
            </div>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/* ─────────────── Main ─────────────── */

export function TeamWorkload({ selectedUserIds, searchQuery, globalCustomerId, includeInternal }: Props) {
  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(() => workspaceTodayISO());
  const [focusId, setFocusId] = useState<string | null>(null);
  // Calendar shows three weeks; 0 = starts this week. Retool starts last week.
  const [weekOffset, setWeekOffset] = useState(-1);
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set());

  const idsKey = selectedUserIds.slice().sort().join(",");
  // Only the newest request may write state: narrowing from All Staff to one
  // team must not be overwritten by the slower All Staff response landing last.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    if (!idsKey) {
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        userIds: expandAliases(idsKey.split(",")).join(","),
        // Internal TCE work uses the same people's time, so it counts toward
        // workload by default; the test client is never real work.
        excludeClients: includeInternal ? "2" : "1,2",
      });
      const res = await fetch(`/api/operations/team-workload?${params.toString()}`);
      const data = await res.json();
      if (seq !== requestSeq.current) return;
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setTasks(data.tasks || []);
      setToday(workspaceTodayISO());
    } catch (e) {
      if (seq !== requestSeq.current) return;
      // Keep whatever was already on screen; say the refresh failed.
      setError(e instanceof Error ? e.message : "Failed to load workload");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [idsKey, includeInternal]);

  useEffect(() => {
    load();
  }, [load]);

  // A tab left open overnight must roll "today", and every bucket, over.
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = workspaceTodayISO();
      setToday((prev) => (prev === now ? prev : now));
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  /* ─── Scope: customer + search (person focus applied after) ─── */
  const scoped = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      if (globalCustomerId && t.customerId !== globalCustomerId) return false;
      if (!q) return true;
      return (
        t.contentTitle.toLowerCase().includes(q) ||
        t.customerName.toLowerCase().includes(q) ||
        t.assigneeName.toLowerCase().includes(q) ||
        t.taskTitle.toLowerCase().includes(q) ||
        t.contentType.toLowerCase().includes(q)
      );
    });
  }, [tasks, searchQuery, globalCustomerId]);

  /* ─── Per-person load (manager overview) ─── */
  const people = useMemo(() => {
    const map: Record<string, {
      id: string; name: string;
      overdue: number; overdueN: number;
      restOfWeek: number; restOfWeekN: number;
      nextWeek: number; nextWeekN: number;
      later: number; laterN: number;
      none: number; noneN: number;
      total: number; totalN: number;
    }> = {};
    for (const t of scoped) {
      const id = canonicalUserId(t.assigneeId);
      const p = (map[id] = map[id] || {
        id, name: t.assigneeName,
        overdue: 0, overdueN: 0, restOfWeek: 0, restOfWeekN: 0, nextWeek: 0, nextWeekN: 0,
        later: 0, laterN: 0, none: 0, noneN: 0, total: 0, totalN: 0,
      });
      p.total += t.taskCUs; p.totalN++;
      const col = personColumn(t.deadline, today);
      p[col] += t.taskCUs;
      p[`${col}N` as const]++;
    }
    return Object.values(map);
  }, [scoped, today]);

  // Drop a focus only when that person is no longer in the selection at all —
  // not when a search or customer filter merely hides their rows for a moment.
  useEffect(() => {
    if (focusId && !tasks.some((t) => canonicalUserId(t.assigneeId) === focusId)) setFocusId(null);
  }, [tasks, focusId]);

  const peopleSort = useSort("name", true);
  const sortedPeople = useMemo(
    () => sortRows(people, peopleSort.currentSort, peopleSort.currentAsc),
    [people, peopleSort.currentSort, peopleSort.currentAsc]
  );
  const maxWeekLoad = Math.max(0.0001, ...people.map((p) => p.overdue + p.restOfWeek));

  /* ─── Everything below follows the person focus ─── */
  const visible = useMemo(
    () => (focusId ? scoped.filter((t) => canonicalUserId(t.assigneeId) === focusId) : scoped),
    [scoped, focusId]
  );
  const focusName = focusId ? people.find((p) => p.id === focusId)?.name : null;

  const buckets = useMemo(() => {
    const out: Record<DeadlineBucket, WorkTask[]> = { none: [], earlier: [], thisWeek: [], nextWeek: [], later: [] };
    for (const t of visible) out[deadlineBucket(t.deadline, today)].push(t);
    return out;
  }, [visible, today]);

  const overdueAll = useMemo(() => visible.filter((t) => isOverdue(t.deadline, today)), [visible, today]);
  const overdueThisWeek = useMemo(
    () => buckets.thisWeek.filter((t) => isOverdue(t.deadline, today)),
    [buckets.thisWeek, today]
  );

  /* ─── Calendar ─── */
  const byDate = useMemo(() => {
    const m: Record<string, WorkTask[]> = {};
    for (const t of visible) if (t.deadline) (m[t.deadline] = m[t.deadline] || []).push(t);
    for (const k of Object.keys(m)) m[k].sort((a, b) => b.taskCUs - a.taskCUs || a.contentTitle.localeCompare(b.contentTitle));
    return m;
  }, [visible]);

  const thisMonday = mondayOf(today);
  const weeks = [0, 1, 2].map((i) => addDays(thisMonday, 7 * (weekOffset + i)));
  const multiPerson = !focusId && people.length > 1;

  const weekLabel = (monday: string) => {
    const rel = Math.round((Date.parse(`${monday}T00:00:00Z`) - Date.parse(`${thisMonday}T00:00:00Z`)) / (7 * 86400000));
    if (rel === 0) return "This week";
    if (rel === -1) return "Last week";
    if (rel === 1) return "Next week";
    return `w/c ${fmtDayMonth(monday)}`;
  };

  const toggleCell = (key: string) =>
    setExpandedCells((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (!idsKey) return null;

  if (loading && tasks.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && tasks.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="p-6 text-sm text-red-600 flex items-center gap-3">
          Couldn&apos;t load workload: {error}
          <button onClick={load} className="ml-auto rounded-md border px-2 py-1 text-xs text-foreground hover:bg-muted">Retry</button>
        </CardContent>
      </Card>
    );
  }

  const kpis = [
    { label: "Open tasks", value: sumCUs(visible), n: visible.length, tone: "" },
    { label: "Overdue", value: sumCUs(overdueAll), n: overdueAll.length, tone: overdueAll.length ? "text-red-600 dark:text-red-400" : "" },
    { label: "This week", value: sumCUs(buckets.thisWeek), n: buckets.thisWeek.length, tone: "" },
    { label: "Next week", value: sumCUs(buckets.nextWeek), n: buckets.nextWeek.length, tone: "" },
    { label: "No deadline", value: sumCUs(buckets.none), n: buckets.none.length, tone: buckets.none.length ? "text-amber-600 dark:text-amber-400" : "" },
  ];

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 flex items-center gap-3">
          Refresh failed ({error}) — showing the last data loaded.
          <button onClick={load} className="ml-auto underline">Retry</button>
        </div>
      )}
      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <Card key={k.label} className="border-0 shadow-sm">
            <CardContent className="p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{k.label}</p>
              <p className={cn("text-xl font-bold tabular-nums", k.tone)}>{k.value.toFixed(2)}<span className="text-xs font-medium text-muted-foreground ml-1">CU</span></p>
              <p className="text-[11px] text-muted-foreground tabular-nums">{k.n} task{k.n === 1 ? "" : "s"}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Per-person load */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <h3 className="text-sm font-semibold">Team workload</h3>
            <span className="text-[11px] text-muted-foreground">Click a person to focus every view below on them.</span>
            <div className="ml-auto flex items-center gap-3">
              {focusName && (
                <button
                  onClick={() => setFocusId(null)}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2 py-0.5 text-[11px] font-medium"
                >
                  Showing {focusName} <X className="h-3 w-3" />
                </button>
              )}
              <button onClick={load} className="text-muted-foreground hover:text-foreground" title="Refresh">
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </button>
              {sortedPeople.length > 0 && (
                <button
                  onClick={() =>
                    downloadCSV(
                      sortedPeople.map((p) => ({
                        Person: p.name,
                        "Overdue CUs": p.overdue.toFixed(2),
                        "Rest of this week CUs": p.restOfWeek.toFixed(2),
                        "Next week CUs": p.nextWeek.toFixed(2),
                        "Later CUs": p.later.toFixed(2),
                        "No deadline CUs": p.none.toFixed(2),
                        "Total open CUs": p.total.toFixed(2),
                        "Open tasks": p.totalN,
                      })),
                      "team-workload.csv"
                    )
                  }
                  className="text-muted-foreground hover:text-foreground"
                  title="Download CSV"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="overflow-auto max-h-[360px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background z-[1]">
                <tr className="border-b">
                  <SortHeader label="Person" sortKey="name" {...peopleSort} onSort={peopleSort.toggle} />
                  <SortHeader label="Overdue" sortKey="overdue" {...peopleSort} onSort={peopleSort.toggle} align="right" />
                  <SortHeader label="Rest of this week" sortKey="restOfWeek" {...peopleSort} onSort={peopleSort.toggle} />
                  <SortHeader label="Next week" sortKey="nextWeek" {...peopleSort} onSort={peopleSort.toggle} align="right" />
                  <SortHeader label="Later" sortKey="later" {...peopleSort} onSort={peopleSort.toggle} align="right" />
                  <SortHeader label="No deadline" sortKey="none" {...peopleSort} onSort={peopleSort.toggle} align="right" />
                  <SortHeader label="Total open" sortKey="total" {...peopleSort} onSort={peopleSort.toggle} align="right" />
                </tr>
              </thead>
              <tbody>
                {sortedPeople.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      Nothing open for the selected people{searchQuery || globalCustomerId ? " with the current filters" : ""}.
                    </td>
                  </tr>
                ) : (
                  sortedPeople.map((p) => {
                    const focused = p.id === focusId;
                    const weekLoad = p.overdue + p.restOfWeek;
                    const cell = (v: number, n: number, tone = "") => (
                      <td className={cn("px-3 py-2 text-right tabular-nums whitespace-nowrap", tone)}>
                        {n === 0 ? (
                          <span className="text-muted-foreground/40">—</span>
                        ) : (
                          <>
                            {v.toFixed(2)}
                            <span className="ml-1 text-[10px] text-muted-foreground">({n})</span>
                          </>
                        )}
                      </td>
                    );
                    return (
                      <tr
                        key={p.id}
                        tabIndex={0}
                        aria-pressed={focused}
                        onClick={() => setFocusId(focused ? null : p.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setFocusId(focused ? null : p.id);
                          }
                        }}
                        className={cn(
                          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500",
                          "border-b border-border/30 cursor-pointer transition-colors",
                          focused ? "bg-blue-500/10" : "hover:bg-muted/30"
                        )}
                      >
                        <td className="px-3 py-2 font-medium whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-5 w-5 rounded-full bg-muted text-[9px] font-semibold flex items-center justify-center">
                              {initials(p.name)}
                            </span>
                            {p.name}
                          </span>
                        </td>
                        {cell(p.overdue, p.overdueN, p.overdueN ? "text-red-600 dark:text-red-400 font-semibold" : "")}
                        <td className="px-3 py-2 min-w-[160px]">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden" title="This week's load (overdue + due by Sunday), relative to the busiest person here">
                              <div
                                className={cn("h-full rounded-full", p.overdue > 0 ? "bg-red-500" : "bg-blue-500")}
                                style={{ width: `${Math.max(0, Math.min(100, Math.round((weekLoad / maxWeekLoad) * 100)))}%` }}
                              />
                            </div>
                            <span className="tabular-nums whitespace-nowrap w-16 text-right">
                              {p.restOfWeekN === 0 ? (
                                <span className="text-muted-foreground/40">—</span>
                              ) : (
                                <>
                                  {p.restOfWeek.toFixed(2)}
                                  <span className="ml-1 text-[10px] text-muted-foreground">({p.restOfWeekN})</span>
                                </>
                              )}
                            </span>
                          </div>
                        </td>
                        {cell(p.nextWeek, p.nextWeekN)}
                        {cell(p.later, p.laterN)}
                        {cell(p.none, p.noneN, p.noneN ? "text-amber-700 dark:text-amber-400" : "")}
                        {cell(p.total, p.totalN, "font-semibold")}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Assigned With Deadlines — Summary View (calendar) */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b flex flex-wrap items-center gap-3">
            <CalendarDays className="h-4 w-4 text-blue-500" />
            <div>
              <h3 className="text-sm font-semibold">Assigned with deadlines — summary view</h3>
              <p className="text-[11px] text-muted-foreground">Open tasks by deadline. Click a task to open it in the Engine.</p>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => setWeekOffset(weekOffset - 1)} className="p-1 rounded hover:bg-muted" title="Earlier">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setWeekOffset(-1)}
                className={cn("px-2 py-1 rounded text-xs font-medium", weekOffset === -1 ? "bg-muted" : "hover:bg-muted")}
              >
                Today
              </button>
              <button onClick={() => setWeekOffset(weekOffset + 1)} className="p-1 rounded hover:bg-muted" title="Later">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Legend */}
          <div className="px-4 py-2 border-b flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
            <span className="font-medium uppercase tracking-wider">CU</span>
            {HEAT.map((h, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <span className={cn("h-3 w-5 rounded-sm", h)} /> {HEAT_LABELS[i]}
              </span>
            ))}
            <span className="inline-flex items-center gap-1 ml-2">
              <span className="h-3 w-5 rounded-sm bg-muted ring-2 ring-red-600 ring-offset-1 ring-offset-background dark:ring-red-400" /> Overdue
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-3 w-5 rounded-sm bg-muted border border-dashed border-foreground/40" /> Queued behind an earlier step
            </span>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[88px_repeat(6,minmax(0,1fr))] border-b text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <div className="px-2 py-1.5" />
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat / Sun"].map((d) => (
                  <div key={d} className="px-2 py-1.5 border-l">{d}</div>
                ))}
              </div>
              {weeks.map((monday) => {
                const cols = [0, 1, 2, 3, 4].map((i) => [addDays(monday, i)]).concat([[addDays(monday, 5), addDays(monday, 6)]]);
                const weekTasks = cols.flat().flatMap((d) => byDate[d] || []);
                const label = weekLabel(monday);
                return (
                  <div
                    key={monday}
                    className={cn(
                      "grid grid-cols-[88px_repeat(6,minmax(0,1fr))] border-b last:border-b-0",
                      label === "This week" && "bg-blue-500/[0.03]"
                    )}
                  >
                    <div className="px-2 py-2 border-r">
                      <p className={cn("text-xs font-semibold", label === "This week" && "text-blue-600 dark:text-blue-400")}>{label}</p>
                      <p className="text-[10px] text-muted-foreground">{fmtDayMonth(monday)}</p>
                      <p className="mt-1 text-xs font-bold tabular-nums">{sumCUs(weekTasks).toFixed(2)}</p>
                      <p className="text-[10px] text-muted-foreground">CU · {weekTasks.length}</p>
                    </div>
                    {cols.map((dates) => {
                      const key = dates.join("/");
                      const cellTasks = dates.flatMap((d) => byDate[d] || []);
                      const isToday = dates.includes(today);
                      const isPast = dates[dates.length - 1] < today;
                      const expanded = expandedCells.has(key);
                      const shown = expanded ? cellTasks : cellTasks.slice(0, 6);
                      const total = sumCUs(cellTasks);
                      return (
                        <div
                          key={key}
                          className={cn(
                            "min-h-[96px] border-l p-1.5 min-w-0",
                            isToday && "bg-blue-500/10 ring-1 ring-inset ring-blue-500/40",
                            isPast && !isToday && "bg-muted/25"
                          )}
                        >
                          <div className="flex items-baseline justify-between mb-1 gap-1">
                            <span className={cn("text-[11px] tabular-nums", isToday ? "font-bold text-blue-600 dark:text-blue-400" : "text-muted-foreground")}>
                              {dates.length === 2 ? fmtRange(dates[0], dates[1]) : fmtDayMonth(dates[0])}
                              {isToday && " · today"}
                            </span>
                            {cellTasks.length > 0 && (
                              <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">{total.toFixed(2)}</span>
                            )}
                          </div>
                          {shown.map((t) => {
                            const overdue = isOverdue(t.deadline, today);
                            const link = engineLink(t);
                            const tip = [
                              `${t.assigneeName} — ${t.customerName}`,
                              t.contentTitle,
                              `${t.taskTitle} · ${t.taskCUs.toFixed(2)} CU · due ${fmtDate(t.deadline)}`,
                              t.active ? "" : "Queued behind an earlier step",
                              overdue ? "OVERDUE" : "",
                            ].filter(Boolean).join("\n");
                            return (
                              <a
                                key={t.taskId}
                                href={link || undefined}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={tip}
                                className={cn(
                                  "block truncate rounded px-1.5 py-0.5 mb-0.5 text-[11px] leading-snug hover:brightness-95",
                                  heat(t.taskCUs),
                                  !t.active && "border border-dashed border-foreground/40",
                                  // A ring with a background-coloured gap, not a red border: the
                                  // >2 CU chip is itself red. And not `outline`: this repo's
                                  // tailwind-merge drops the bare `outline` class inside cn(), which
                                  // left outline-style "none" and the marker invisible in production.
                                  overdue && "ring-2 ring-red-600 ring-offset-1 ring-offset-background dark:ring-red-400"
                                )}
                              >
                                {multiPerson && <span className="font-bold mr-1">{initials(t.assigneeName)}</span>}
                                {t.contentTitle}
                              </a>
                            );
                          })}
                          {cellTasks.length > 6 && (
                            <button onClick={() => toggleCell(key)} className="text-[10px] text-blue-600 hover:underline">
                              {expanded ? "Show less" : `+${cellTasks.length - 6} more`}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Assigned With Deadlines — Detailed View */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
          Assigned with deadlines — detailed view{focusName ? ` · ${focusName}` : ""}
        </h2>
        <ModuleCard
          title="This week — total content units"
          subtitle={
            <>
              {fmtDayMonth(thisMonday)} – {fmtDayMonth(addDays(thisMonday, 6))}
              {overdueThisWeek.length > 0 && (
                <span className="text-red-600 dark:text-red-400">
                  {" "}· includes {sumCUs(overdueThisWeek).toFixed(2)} CU already overdue ({overdueThisWeek.length})
                </span>
              )}
            </>
          }
          icon={<CalendarClock className="h-4 w-4 text-blue-500" />}
          total={sumCUs(buckets.thisWeek)}
          count={buckets.thisWeek.length}
        >
          <TaskTable rows={buckets.thisWeek} today={today} showDeadline emptyText="Nothing due this week." csvName="workload-this-week.csv" />
        </ModuleCard>
        <ModuleCard
          title="Next week — total content units"
          subtitle={`${fmtDayMonth(addDays(thisMonday, 7))} – ${fmtDayMonth(addDays(thisMonday, 13))}`}
          icon={<CalendarClock className="h-4 w-4 text-violet-500" />}
          total={sumCUs(buckets.nextWeek)}
          count={buckets.nextWeek.length}
        >
          <TaskTable rows={buckets.nextWeek} today={today} showDeadline emptyText="Nothing due next week." csvName="workload-next-week.csv" />
        </ModuleCard>
      </div>

      {/* Assigned Without Deadlines */}
      <ModuleCard
        title="Assigned without deadlines"
        subtitle="Open work nobody has put a date on — it doesn't appear in the calendar, so it's easy to lose track of."
        icon={<Inbox className="h-4 w-4 text-amber-500" />}
        total={sumCUs(buckets.none)}
        count={buckets.none.length}
      >
        <TaskTable rows={buckets.none} today={today} showDeadline={false} emptyText="Every open task has a deadline." csvName="workload-no-deadline.csv" />
      </ModuleCard>

      {/* Assigned With Deadlines — Other Dates */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
          Assigned with deadlines — other dates
        </h2>
        <ModuleCard
          title="Overdue — deadline before this week"
          subtitle="Still open. Either finish, re-date or close these in the Engine."
          icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
          total={sumCUs(buckets.earlier)}
          count={buckets.earlier.length}
        >
          <TaskTable rows={buckets.earlier} today={today} showDeadline emptyText="Nothing overdue from before this week." csvName="workload-overdue-earlier.csv" />
        </ModuleCard>
        <ModuleCard
          title="Later — deadline after next week"
          subtitle={`From ${fmtDayMonth(addDays(thisMonday, 14))}`}
          icon={<CalendarDays className="h-4 w-4 text-slate-500" />}
          total={sumCUs(buckets.later)}
          count={buckets.later.length}
        >
          <TaskTable rows={buckets.later} today={today} showDeadline emptyText="Nothing scheduled beyond next week." csvName="workload-later.csv" />
        </ModuleCard>
      </div>
    </div>
  );
}
