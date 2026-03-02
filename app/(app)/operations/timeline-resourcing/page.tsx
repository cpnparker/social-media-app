"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Loader2,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  CalendarDays,
  Search,
  Filter,
  ExternalLink,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { categorizeContentType, CATEGORY_ORDER, CATEGORY_ICONS } from "@/lib/content-type-utils";
import {
  addDays,
  subDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  differenceInCalendarDays,
  format,
  isWeekend,
  isToday,
  isBefore,
  isAfter,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
} from "date-fns";

/* ─────────────── Types ─────────────── */

interface TaskRow {
  taskId: string;
  contentId: string | null;
  taskTitle: string;
  taskCUs: number;
  deadline: string | null;
  completedAt: string | null;
  contentTitle: string;
  contentType: string;
  customerId: string | null;
  customerName: string;
  assigneeName: string | null;
  assigneeId: string | null;
}

interface ContentGroup {
  contentId: string;
  contentTitle: string;
  contentType: string;
  tasks: TaskRow[];
  startDate: Date;
  endDate: Date;
  totalCUs: number;
  periodTaskCUs: number;
  customerName: string;
  customerId: string | null;
}

interface TopGroup {
  id: string;
  label: string;
  contentGroups: ContentGroup[];
  startDate: Date;
  endDate: Date;
  totalCUs: number;
  periodTaskCUs: number;
  taskCount: number;
  contentCount: number;
}

type ViewMode = "customer" | "contentType";
type TimeWindow = "2weeks" | "month" | "6weeks" | "custom";

/* ─────────────── Helpers ─────────────── */

const LABEL_WIDTH = 280;
const ROW_HEIGHT = 32;
const DAY_WIDTH = 36;

const getTaskDates = (task: TaskRow): { start: Date; end: Date } | null => {
  if (!task.deadline) return null;
  const end = new Date(task.deadline);
  if (isNaN(end.getTime())) return null;
  const days = Math.max(task.taskCUs, 0);
  const start = days > 0 ? subDays(end, days) : subDays(end, 0);
  return { start, end };
};

const getBarStatus = (
  task: TaskRow,
  dates: { start: Date; end: Date }
): "completed" | "overdue" | "inProgress" | "future" => {
  if (task.completedAt) return "completed";
  const now = new Date();
  if (isBefore(dates.end, now)) return "overdue";
  if (isBefore(dates.start, now) && isAfter(dates.end, now)) return "inProgress";
  return "future";
};

/** Check if a bar overlaps with the visible window */
const barOverlapsWindow = (barStart: Date, barEnd: Date, winStart: Date, winEnd: Date): boolean => {
  return isBefore(barStart, winEnd) && isAfter(barEnd, winStart);
};

const BAR_COLORS: Record<string, string> = {
  completed: "bg-emerald-400/80",
  overdue: "bg-red-400/80",
  inProgress: "bg-blue-500/90",
  future: "bg-slate-300/70",
};

const SUMMARY_COLORS: Record<string, string> = {
  completed: "bg-emerald-300/40",
  overdue: "bg-red-300/40",
  inProgress: "bg-blue-400/40",
  future: "bg-slate-200/40",
};

const fmtDate = (d: string | Date | null) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
};

/* ─────────────── Component ─────────────── */

export default function TimelineResourcingPage() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("customer");
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("month");
  const [windowStart, setWindowStart] = useState(() => startOfWeek(startOfMonth(new Date()), { weekStartsOn: 1 }));
  const [searchQuery, setSearchQuery] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [excludeTestClients, setExcludeTestClients] = useState(true);
  const EXCLUDE_CLIENT_IDS = "1,2";

  // Custom date pickers
  const [customFrom, setCustomFrom] = useState(() => format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState(() => format(endOfMonth(new Date()), "yyyy-MM-dd"));

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedContent, setExpandedContent] = useState<Set<string>>(new Set());

  // Popover state for content details
  const [popoverContentId, setPopoverContentId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  /* ─── Window end date ─── */
  const windowEnd = useMemo(() => {
    if (timeWindow === "custom") {
      return new Date(customTo);
    }
    if (timeWindow === "2weeks") return addDays(windowStart, 13);
    if (timeWindow === "6weeks") return addDays(windowStart, 41);
    return endOfWeek(endOfMonth(addDays(windowStart, 7)), { weekStartsOn: 1 });
  }, [windowStart, timeWindow, customTo]);

  // Effective window start (for custom mode)
  const effectiveStart = useMemo(() => {
    if (timeWindow === "custom") return startOfWeek(new Date(customFrom), { weekStartsOn: 1 });
    return windowStart;
  }, [timeWindow, customFrom, windowStart]);

  const effectiveEnd = useMemo(() => {
    if (timeWindow === "custom") return endOfWeek(new Date(customTo), { weekStartsOn: 1 });
    return windowEnd;
  }, [timeWindow, customTo, windowEnd]);

  const days = useMemo(() => {
    const d: Date[] = [];
    let cur = new Date(effectiveStart);
    while (cur <= effectiveEnd) {
      d.push(new Date(cur));
      cur = addDays(cur, 1);
    }
    return d;
  }, [effectiveStart, effectiveEnd]);

  /* ─── Fetch ─── */
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const from = format(subDays(effectiveStart, 60), "yyyy-MM-dd");
      const to = format(addDays(effectiveEnd, 14), "yyyy-MM-dd");
      const params = new URLSearchParams({ from, to });
      if (excludeTestClients) params.set("excludeClients", EXCLUDE_CLIENT_IDS);
      const res = await fetch(`/api/operations/timeline-resourcing?${params.toString()}`);
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (err) {
      console.error("Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [effectiveStart, effectiveEnd, excludeTestClients]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  /* ─── Navigation ─── */
  const navigateBack = () => {
    if (timeWindow === "custom") return;
    if (timeWindow === "2weeks") setWindowStart(subWeeks(windowStart, 2));
    else if (timeWindow === "6weeks") setWindowStart(subWeeks(windowStart, 6));
    else setWindowStart(startOfWeek(subMonths(windowStart, 1), { weekStartsOn: 1 }));
  };
  const navigateForward = () => {
    if (timeWindow === "custom") return;
    if (timeWindow === "2weeks") setWindowStart(addWeeks(windowStart, 2));
    else if (timeWindow === "6weeks") setWindowStart(addWeeks(windowStart, 6));
    else setWindowStart(startOfWeek(addMonths(windowStart, 1), { weekStartsOn: 1 }));
  };
  const goToToday = () => {
    setWindowStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
    if (timeWindow === "custom") setTimeWindow("month");
  };

  /* ─── Filtered tasks ─── */
  const filtered = useMemo(() => {
    let t = tasks;
    if (assigneeFilter !== "all") {
      t = t.filter((r) => r.assigneeName === assigneeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      t = t.filter(
        (r) =>
          r.contentTitle.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q) ||
          r.taskTitle.toLowerCase().includes(q) ||
          (r.assigneeName && r.assigneeName.toLowerCase().includes(q))
      );
    }
    return t;
  }, [tasks, assigneeFilter, searchQuery]);

  /* ─── Assignee list for filter ─── */
  const assignees = useMemo(() => {
    const set = new Set(tasks.map((t) => t.assigneeName).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [tasks]);

  /* ─── Group data ─── */
  const groups: TopGroup[] = useMemo(() => {
    // Group tasks into content groups first
    const contentMap: Record<string, { tasks: TaskRow[]; title: string; type: string; customerName: string; customerId: string | null }> = {};
    for (const t of filtered) {
      const key = t.contentId || `task-${t.taskId}`;
      if (!contentMap[key]) contentMap[key] = { tasks: [], title: t.contentTitle, type: t.contentType, customerName: t.customerName, customerId: t.customerId };
      contentMap[key].tasks.push(t);
    }

    // Build content groups with calculated dates
    const contentGroupsByKey: Record<string, ContentGroup> = {};
    for (const [key, cg] of Object.entries(contentMap)) {
      let earliest: Date | null = null;
      let latest: Date | null = null;
      let totalCUs = 0;
      let periodTaskCUs = 0;

      for (const t of cg.tasks) {
        const dates = getTaskDates(t);
        if (!dates) continue;
        if (!earliest || isBefore(dates.start, earliest)) earliest = dates.start;
        if (!latest || isAfter(dates.end, latest)) latest = dates.end;
        totalCUs += t.taskCUs;
        // Only count CUs for tasks whose bars overlap the visible window
        if (barOverlapsWindow(dates.start, dates.end, effectiveStart, effectiveEnd)) {
          periodTaskCUs += t.taskCUs;
        }
      }

      if (!earliest || !latest) continue;

      // Only include if the content bar overlaps with the visible window
      if (!barOverlapsWindow(earliest, latest, effectiveStart, effectiveEnd)) continue;

      contentGroupsByKey[key] = {
        contentId: key,
        contentTitle: cg.title,
        contentType: cg.type,
        tasks: cg.tasks,
        startDate: earliest,
        endDate: latest,
        totalCUs,
        periodTaskCUs,
        customerName: cg.customerName,
        customerId: cg.customerId,
      };
    }

    // Group by top-level (customer or content category)
    const topMap: Record<string, { label: string; contentGroups: ContentGroup[] }> = {};

    for (const cg of Object.values(contentGroupsByKey)) {
      let groupKey: string;
      let groupLabel: string;

      if (viewMode === "customer") {
        groupKey = cg.customerId || "unassigned";
        groupLabel = cg.customerName;
      } else {
        // Cluster by category (Written, Video, Visual, Strategy)
        const category = categorizeContentType(cg.contentType);
        groupKey = category;
        const icon = CATEGORY_ICONS[category] || "📋";
        groupLabel = `${icon} ${category}`;
      }

      if (!topMap[groupKey]) topMap[groupKey] = { label: groupLabel, contentGroups: [] };
      topMap[groupKey].contentGroups.push(cg);
    }

    // Build final groups with summary dates
    const result = Object.entries(topMap)
      .map(([id, g]) => {
        let earliest: Date | null = null;
        let latest: Date | null = null;
        let totalCUs = 0;
        let periodTaskCUs = 0;
        let taskCount = 0;
        const contentCount = g.contentGroups.length;

        for (const cg of g.contentGroups) {
          if (!earliest || isBefore(cg.startDate, earliest)) earliest = cg.startDate;
          if (!latest || isAfter(cg.endDate, latest)) latest = cg.endDate;
          totalCUs += cg.totalCUs;
          periodTaskCUs += cg.periodTaskCUs;
          taskCount += cg.tasks.length;
        }

        // Sort content groups by start date
        g.contentGroups.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

        return {
          id,
          label: g.label,
          contentGroups: g.contentGroups,
          startDate: earliest || new Date(),
          endDate: latest || new Date(),
          totalCUs,
          periodTaskCUs,
          taskCount,
          contentCount,
        };
      });

    // Sort: by category order for content type view, alphabetically for customer view
    if (viewMode === "contentType") {
      result.sort((a, b) => {
        const aIdx = CATEGORY_ORDER.indexOf(a.id);
        const bIdx = CATEGORY_ORDER.indexOf(b.id);
        return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
      });
    } else {
      result.sort((a, b) => a.label.localeCompare(b.label));
    }

    return result;
  }, [filtered, viewMode, effectiveStart, effectiveEnd]);

  /* ─── Toggle helpers ─── */
  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleContent = (id: string) => {
    setExpandedContent((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* ─── Bar position calculator ─── */
  const getBarStyle = (start: Date, end: Date) => {
    const dayOffset = differenceInCalendarDays(start, effectiveStart);
    const duration = Math.max(differenceInCalendarDays(end, start), 1);
    const left = dayOffset * DAY_WIDTH;
    const width = duration * DAY_WIDTH;
    return { left, width };
  };

  /* ─── Get summary bar status ─── */
  const getSummaryStatus = (startDate: Date, endDate: Date, tasks: TaskRow[]): string => {
    const allDone = tasks.every((t) => t.completedAt);
    if (allDone) return "completed";
    const now = new Date();
    if (isBefore(endDate, now)) return "overdue";
    if (isBefore(startDate, now) && isAfter(endDate, now)) return "inProgress";
    return "future";
  };

  /* ─── Today offset ─── */
  const todayOffset = differenceInCalendarDays(new Date(), effectiveStart) * DAY_WIDTH;
  const showTodayLine = todayOffset >= 0 && todayOffset <= days.length * DAY_WIDTH;

  /* ─── Content detail lookup ─── */
  const contentGroupMap = useMemo(() => {
    const map: Record<string, ContentGroup> = {};
    for (const g of groups) {
      for (const cg of g.contentGroups) {
        map[cg.contentId] = cg;
      }
    }
    return map;
  }, [groups]);

  /* ─── Build flat row list for rendering ─── */
  type FlatRow = {
    type: "group" | "content" | "task";
    id: string;
    label: string;
    sublabel?: string;
    indent: number;
    isExpanded?: boolean;
    onToggle?: () => void;
    barStyle: { left: number; width: number } | null;
    barColor: string;
    cus?: number;
    periodTaskCUs?: number;
    contentCount?: number;
    contentId?: string | null;
    contentGroup?: ContentGroup;
    taskData?: TaskRow;
    offscreenLeft?: boolean;
    offscreenRight?: boolean;
  };

  const rows: FlatRow[] = useMemo(() => {
    const result: FlatRow[] = [];

    for (const group of groups) {
      const groupExpanded = expandedGroups.has(group.id);
      const summaryStatus = getSummaryStatus(group.startDate, group.endDate, group.contentGroups.flatMap((c) => c.tasks));
      const gBar = getBarStyle(group.startDate, group.endDate);

      result.push({
        type: "group",
        id: group.id,
        label: group.label,
        sublabel: `${group.contentCount} content · ${group.periodTaskCUs.toFixed(1)} task CUs · ${group.totalCUs.toFixed(1)} content CUs`,
        indent: 0,
        isExpanded: groupExpanded,
        onToggle: () => toggleGroup(group.id),
        barStyle: gBar.width > 0 ? gBar : null,
        barColor: SUMMARY_COLORS[summaryStatus],
        cus: group.totalCUs,
        periodTaskCUs: group.periodTaskCUs,
        contentCount: group.contentCount,
      });

      if (!groupExpanded) continue;

      for (const cg of group.contentGroups) {
        const contentExpanded = expandedContent.has(cg.contentId);
        const cStatus = getSummaryStatus(cg.startDate, cg.endDate, cg.tasks);
        const cBar = getBarStyle(cg.startDate, cg.endDate);

        result.push({
          type: "content",
          id: cg.contentId,
          label: cg.contentTitle,
          sublabel: `${cg.contentType} · ${cg.periodTaskCUs.toFixed(1)} task CUs · ${cg.totalCUs.toFixed(1)} content CUs`,
          indent: 1,
          isExpanded: contentExpanded,
          onToggle: () => toggleContent(cg.contentId),
          barStyle: cBar.width > 0 ? cBar : null,
          barColor: SUMMARY_COLORS[cStatus],
          cus: cg.totalCUs,
          periodTaskCUs: cg.periodTaskCUs,
          contentId: cg.contentId,
          contentGroup: cg,
        });

        if (!contentExpanded) continue;

        for (const t of cg.tasks) {
          const dates = getTaskDates(t);
          if (!dates) continue;
          const status = getBarStatus(t, dates);
          const tBar = getBarStyle(dates.start, dates.end);

          // Check if bar is offscreen
          const offscreenLeft = tBar.left + tBar.width < 0;
          const offscreenRight = tBar.left > days.length * DAY_WIDTH;

          result.push({
            type: "task",
            id: t.taskId,
            label: t.taskTitle,
            sublabel: t.assigneeName || undefined,
            indent: 2,
            barStyle: tBar.width > 0 ? tBar : null,
            barColor: BAR_COLORS[status],
            cus: t.taskCUs,
            contentId: t.contentId,
            taskData: t,
            offscreenLeft,
            offscreenRight,
          });
        }
      }
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, expandedGroups, expandedContent, effectiveStart, days.length]);

  const totalWidth = days.length * DAY_WIDTH;

  /* ─── Summary stats ─── */
  const stats = useMemo(() => {
    let totalCUs = 0;
    let totalPeriodTaskCUs = 0;
    let totalItems = 0;
    const totalGroups = groups.length;
    for (const g of groups) {
      totalCUs += g.totalCUs;
      totalPeriodTaskCUs += g.periodTaskCUs;
      totalItems += g.contentGroups.length;
    }
    return { totalCUs, totalPeriodTaskCUs, totalItems, totalGroups };
  }, [groups]);

  /* ─────────────── Render ─────────────── */
  return (
    <div className="max-w-[1600px] space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Timeline Resourcing</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Gantt chart view of content production tasks.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{stats.totalGroups} {viewMode === "customer" ? "customers" : "categories"}</span>
          <span>·</span>
          <span>{stats.totalItems} content</span>
          <span>·</span>
          <span title="Task CUs in period">{stats.totalPeriodTaskCUs.toFixed(1)} task CUs</span>
          <span>·</span>
          <span className="font-semibold text-foreground" title="Content CUs in period">{stats.totalCUs.toFixed(1)} content CUs</span>
        </div>
      </div>

      {/* Controls */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          {/* View toggle */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
            {(["customer", "contentType"] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  viewMode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m === "customer" ? "By Customer" : "By Content Type"}
              </button>
            ))}
          </div>

          {/* Time window presets */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
            {([["2weeks", "2 Weeks"], ["month", "Month"], ["6weeks", "6 Weeks"], ["custom", "Custom"]] as [TimeWindow, string][]).map(([w, label]) => (
              <button
                key={w}
                onClick={() => setTimeWindow(w)}
                className={cn(
                  "px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
                  timeWindow === w ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Nav arrows + today (disabled in custom mode) */}
          {timeWindow !== "custom" && (
            <div className="flex items-center gap-1">
              <button onClick={navigateBack} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button onClick={goToToday} className="px-2.5 py-1 rounded-md text-xs font-medium bg-muted/50 hover:bg-muted transition-colors">
                Today
              </button>
              <button onClick={navigateForward} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors">
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="text-xs text-muted-foreground ml-2">
                <CalendarDays className="h-3.5 w-3.5 inline mr-1" />
                {format(effectiveStart, "d MMM")} – {format(effectiveEnd, "d MMM yyyy")}
              </span>
            </div>
          )}

          {/* Custom date pickers */}
          {timeWindow === "custom" && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">From</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-7 text-xs rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <label className="text-xs text-muted-foreground">To</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-7 text-xs rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button onClick={goToToday} className="px-2.5 py-1 rounded-md text-xs font-medium bg-muted/50 hover:bg-muted transition-colors">
                Today
              </button>
            </div>
          )}

          <div className="flex-1" />

          {/* Team filter */}
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="h-7 text-xs rounded-md border border-input bg-background px-2 focus:outline-none"
            >
              <option value="all">All Team Members</option>
              {assignees.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          {/* Search */}
          <div className="relative w-[180px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
            <Input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-7 text-xs pl-7" />
          </div>

          {/* Exclude test */}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0 select-none">
            <input type="checkbox" checked={excludeTestClients} onChange={(e) => setExcludeTestClients(e.target.checked)} className="rounded border-muted-foreground/30 h-3.5 w-3.5" />
            Hide TCE &amp; test
          </label>
        </CardContent>
      </Card>

      {/* Gantt Chart */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-20 text-sm text-muted-foreground">No tasks with deadlines found in this period.</div>
      ) : (
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="flex">
            {/* ─── Label Column (fixed) ─── */}
            <div className="shrink-0 border-r bg-background z-10" style={{ width: LABEL_WIDTH }}>
              {/* Header spacer */}
              <div className="h-10 border-b bg-muted/30 flex items-center px-3">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {viewMode === "customer" ? "Customer / Content" : "Type / Content"}
                </span>
              </div>
              {/* Rows */}
              {rows.map((row) => (
                <div
                  key={`label-${row.type}-${row.id}`}
                  className={cn(
                    "flex items-center border-b border-border/30 transition-colors",
                    row.type === "group" && "bg-muted/20 font-semibold hover:bg-muted/40 cursor-pointer",
                    row.type === "content" && "hover:bg-muted/20 cursor-pointer",
                    row.type === "task" && "text-muted-foreground"
                  )}
                  style={{ height: ROW_HEIGHT, paddingLeft: 12 + row.indent * 16 }}
                  onClick={row.type === "group" || (row.type === "content" && !row.contentId?.startsWith("task-")) ? row.onToggle : row.onToggle}
                >
                  {(row.type === "group" || row.type === "content") && (
                    row.isExpanded ? (
                      <ChevronDown className="h-3 w-3 shrink-0 mr-1.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3 w-3 shrink-0 mr-1.5 text-muted-foreground" />
                    )
                  )}
                  {row.type === "task" && <span className="w-[14px] shrink-0" />}
                  <div className="min-w-0 flex-1">
                    {/* Content rows get a popover with Engine link */}
                    {row.type === "content" && row.contentId && !row.contentId.startsWith("task-") ? (
                      <Popover open={popoverContentId === row.contentId} onOpenChange={(open) => setPopoverContentId(open ? row.contentId! : null)}>
                        <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <button
                            className={cn(
                              "truncate text-left text-[11px] font-medium hover:text-blue-600 transition-colors max-w-full"
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPopoverContentId(popoverContentId === row.contentId ? null : row.contentId!);
                            }}
                          >
                            {row.label}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          side="right"
                          align="start"
                          className="w-72 p-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {(() => {
                            const cg = row.contentGroup;
                            if (!cg) return null;
                            return (
                              <div className="text-xs">
                                <div className="px-3 py-2.5 border-b bg-muted/30">
                                  <p className="font-semibold text-sm leading-tight">{cg.contentTitle}</p>
                                  <p className="text-muted-foreground mt-0.5">{cg.contentType}</p>
                                </div>
                                <div className="px-3 py-2 space-y-1.5">
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">Customer</span>
                                    <span className="font-medium">{cg.customerName}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">Total CUs</span>
                                    <span className="font-medium tabular-nums">{cg.totalCUs.toFixed(1)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">Tasks</span>
                                    <span className="font-medium tabular-nums">{cg.tasks.length}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">Start</span>
                                    <span className="font-medium">{fmtDate(cg.startDate)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">End</span>
                                    <span className="font-medium">{fmtDate(cg.endDate)}</span>
                                  </div>
                                </div>
                                <div className="px-3 py-2 border-t">
                                  <a
                                    href={`https://app.thecontentengine.com/all/contents/${cg.contentId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-blue-500 hover:text-blue-600 font-medium transition-colors"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    Open in Engine
                                  </a>
                                </div>
                              </div>
                            );
                          })()}
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <p className={cn(
                        "truncate",
                        row.type === "group" && "text-xs",
                        row.type === "content" && "text-[11px] font-medium",
                        row.type === "task" && "text-[10px]"
                      )}>
                        {row.label}
                      </p>
                    )}
                  </div>
                  {row.type === "group" && row.cus !== undefined && (
                    <span className="text-[9px] text-muted-foreground tabular-nums pr-2 shrink-0 flex items-center gap-1">
                      <span title="Content items in period">{row.contentCount}</span>
                      <span className="text-border">|</span>
                      <span title="Task CUs in period — CUs from tasks with deadlines in this window">{(row.periodTaskCUs ?? 0).toFixed(1)}</span>
                      <span className="text-border">|</span>
                      <span title="Content CUs — total CUs from all content in this period">{row.cus.toFixed(1)}</span>
                    </span>
                  )}
                  {row.type === "content" && row.cus !== undefined && (
                    <span className="text-[9px] text-muted-foreground tabular-nums pr-2 shrink-0 flex items-center gap-1">
                      <span title="Task CUs in period — CUs from tasks with deadlines in this window">{(row.periodTaskCUs ?? 0).toFixed(1)}</span>
                      <span className="text-border">|</span>
                      <span title="Content CUs — total CUs from all tasks for this content">{row.cus.toFixed(1)}</span>
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* ─── Timeline Grid (scrollable) ─── */}
            <div className="flex-1 overflow-x-auto" ref={scrollRef}>
              <div style={{ width: totalWidth, minHeight: rows.length * ROW_HEIGHT + 40 }} className="relative">
                {/* Day headers */}
                <div className="flex h-10 border-b bg-muted/30 sticky top-0 z-[5]">
                  {days.map((day, i) => {
                    const isWE = isWeekend(day);
                    const isMonday = day.getDay() === 1;
                    return (
                      <div
                        key={i}
                        className={cn(
                          "flex flex-col items-center justify-center text-[9px] shrink-0 border-r border-border/20",
                          isWE && "bg-muted/50 text-muted-foreground/50",
                          isMonday && "border-l border-border/40",
                          isToday(day) && "bg-blue-50 font-bold text-blue-600"
                        )}
                        style={{ width: DAY_WIDTH }}
                      >
                        <span className="leading-none">{format(day, "EEE")}</span>
                        <span className="leading-none font-medium">{format(day, "d")}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Grid lines + today line + bars */}
                <div className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
                  {/* Weekend shading */}
                  {days.map((day, i) => (
                    isWeekend(day) && (
                      <div
                        key={`we-${i}`}
                        className="absolute top-0 bottom-0 bg-muted/25"
                        style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
                      />
                    )
                  ))}

                  {/* Monday lines */}
                  {days.map((day, i) => (
                    day.getDay() === 1 && (
                      <div
                        key={`ml-${i}`}
                        className="absolute top-0 bottom-0 border-l border-border/30"
                        style={{ left: i * DAY_WIDTH }}
                      />
                    )
                  ))}

                  {/* Today line */}
                  {showTodayLine && (
                    <div
                      className="absolute top-0 bottom-0 w-[2px] bg-red-400 z-[4]"
                      style={{ left: todayOffset + DAY_WIDTH / 2 }}
                    />
                  )}

                  {/* Row lines */}
                  {rows.map((row, i) => (
                    <div
                      key={`rowbg-${row.type}-${row.id}`}
                      className={cn(
                        "absolute left-0 right-0 border-b border-border/15",
                        row.type === "group" && "bg-muted/10"
                      )}
                      style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                    />
                  ))}

                  {/* Bars */}
                  {rows.map((row, i) => {
                    if (!row.barStyle) return null;
                    const { left, width } = row.barStyle;
                    const barH = row.type === "group" ? 14 : row.type === "content" ? 12 : 10;
                    const topOffset = i * ROW_HEIGHT + (ROW_HEIGHT - barH) / 2;

                    // Clamp bars that extend beyond visible area
                    const clampedLeft = Math.max(left, 0);
                    const clampedRight = Math.min(left + width, totalWidth);
                    const clampedWidth = Math.max(clampedRight - clampedLeft, 0);

                    if (clampedWidth === 0) {
                      // Bar is entirely off-screen: show arrow indicator
                      const isLeft = left + width < 0;
                      return (
                        <div
                          key={`bar-${row.type}-${row.id}`}
                          className="absolute flex items-center text-[8px] text-muted-foreground/60"
                          style={{
                            left: isLeft ? 4 : totalWidth - 20,
                            top: topOffset,
                            height: barH,
                          }}
                          title={`${row.label} (off-screen ${isLeft ? "left" : "right"})`}
                        >
                          {isLeft ? <ArrowLeft className="h-2.5 w-2.5" /> : <ArrowRight className="h-2.5 w-2.5" />}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={`bar-${row.type}-${row.id}`}
                        className={cn("absolute rounded-sm transition-all", row.barColor)}
                        style={{ left: clampedLeft, width: Math.max(clampedWidth, 4), top: topOffset, height: barH }}
                        title={`${row.label}${row.cus ? ` (${row.cus.toFixed(1)} CUs)` : ""}`}
                      >
                        {clampedWidth > 60 && row.type === "task" && (
                          <span className="absolute inset-0 flex items-center px-1.5 text-[8px] font-medium text-white truncate">
                            {row.label}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground px-1">
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-blue-500/90" /> In Progress</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-emerald-400/80" /> Completed</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-red-400/80" /> Overdue</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-slate-300/70" /> Future</span>
        <span className="flex items-center gap-1.5"><span className="w-[2px] h-3 bg-red-400" /> Today</span>
        <span className="flex items-center gap-1.5"><ArrowLeft className="h-2.5 w-2.5" /> Off-screen bar</span>
      </div>
    </div>
  );
}
