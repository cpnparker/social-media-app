"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  ClipboardList,
  CheckCircle2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  CalendarDays,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ─────────────── Team structure ─────────────── */

interface TeamNode {
  label: string;
  value: string;
  children?: TeamNode[];
}

const TEAMS: TeamNode[] = [
  {
    label: "All Staff",
    value: "all",
    children: [
      {
        label: "Account Managers",
        value: "accountmanagers",
        children: [
          { label: "Arne Dumez", value: "12" },
          { label: "Catherine Allen", value: "14" },
          { label: "Ceri Radford", value: "17" },
          { label: "Charlie Filmer-Court", value: "172" },
          { label: "Ed Brereton", value: "42" },
          { label: "Jack Heslehurst", value: "62" },
          { label: "Katie Roberts", value: "75" },
          { label: "John Hills", value: "667" },
          { label: "Amy White", value: "666" },
        ],
      },
      {
        label: "Hybrid",
        value: "hybrid",
        children: [{ label: "Charlie Avery", value: "191" }],
      },
      {
        label: "Content Managers",
        value: "content_managers",
        children: [
          { label: "Holly Goodall", value: "252" },
          { label: "Marzia Daudzai", value: "61" },
          { label: "Manali Bhutwala", value: "691" },
        ],
      },
      {
        label: "Video Team",
        value: "video",
        children: [
          { label: "Carlota Caldeira da Silva", value: "92" },
          { label: "Nathan Lomax-Cooke", value: "124" },
        ],
      },
      {
        label: "Video Freelancers",
        value: "videofreelancers",
        children: [
          { label: "Espranza", value: "383" },
          { label: "Hustle Media", value: "539" },
          { label: "The Junxion (Agency User)", value: "648" },
          { label: "The Junxion (Freelancer User)", value: "653" },
          { label: "Kennedy Oduor", value: "79" },
          { label: "Pearse Owens", value: "591" },
          { label: "Nostro People", value: "697" },
        ],
      },
      {
        label: "Visuals Team",
        value: "visuals",
        children: [
          { label: "Jessica Foley", value: "43" },
          { label: "Katie Romvari", value: "164" },
          { label: "Nell Prieto", value: "328" },
        ],
      },
      {
        label: "Visual Freelancers",
        value: "visualfreelancers",
        children: [
          { label: "Jenny Amer", value: "46" },
          { label: "Emily Waterfiled", value: "686" },
          { label: "Nick Venables", value: "227" },
          { label: "Harry Tate", value: "326" },
          { label: "Emma Lansdown", value: "609" },
          { label: "Fatma Al Mansoury", value: "650" },
        ],
      },
      {
        label: "Voiceover Artists",
        value: "voiceover",
        children: [
          { label: "Alison Tilley", value: "166" },
          { label: "David Gilbert", value: "435" },
          { label: "Harriet Leitch", value: "535" },
          { label: "Ally Ibach", value: "574" },
          { label: "Sakshi Sharma", value: "418" },
          { label: "Wanda Rush", value: "454" },
        ],
      },
      {
        label: "Writers Team",
        value: "writers",
        children: [{ label: "Farahnaz Mohammed", value: "387" }],
      },
      {
        label: "Writers Freelance",
        value: "writersfreelance",
        children: [
          { label: "Andrew Wright", value: "52" },
          { label: "Si Brandon", value: "26" },
          { label: "Hilary Lamb", value: "77" },
          { label: "Andrew Pettie", value: "68" },
          { label: "Kate Thomas", value: "468" },
          { label: "Nick Walshe", value: "350" },
          { label: "Stephanie Thomson", value: "467" },
          { label: "Angela Wipperman", value: "44" },
        ],
      },
      {
        label: "Strategy Team",
        value: "strategy_team",
        children: [
          { label: "Prachi Srivastava", value: "150" },
          { label: "Edward Brydon", value: "253" },
          { label: "Gabriella Beer", value: "13" },
        ],
      },
      {
        label: "Strategy Freelancers",
        value: "strategy_freelance",
        children: [{ label: "Sophia D'Cruz", value: "611" }],
      },
      {
        label: "Analytics",
        value: "analytics",
        children: [{ label: "Edward Rycroft", value: "455" }],
      },
    ],
  },
];

/* ─────────────── Helpers ─────────────── */

/** Get all leaf (user) IDs from a node */
function getLeafIds(node: TeamNode): string[] {
  if (!node.children || node.children.length === 0) return [node.value];
  return node.children.flatMap(getLeafIds);
}

/** Check if a value is a leaf (user) node — numeric values */
function isLeaf(node: TeamNode): boolean {
  return !node.children || node.children.length === 0;
}

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

/* ─── Sort helpers ─── */
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

/* ─────────────── Types ─────────────── */

interface TaskRow {
  taskId: string;
  contentId: string | null;
  taskTitle: string;
  taskCUs: number;
  deadline: string | null;
  completedAt: string | null;
  createdAt: string | null;
  contentTitle: string;
  contentType: string;
  customerId: string | null;
  customerName: string;
  assigneeName: string | null;
  assigneeId: string | null;
}

/* ─────────────── Tree Selector Component ─────────────── */

function TreeNode({
  node,
  selectedIds,
  expandedNodes,
  onToggleSelect,
  onToggleExpand,
  depth = 0,
}: {
  node: TeamNode;
  selectedIds: Set<string>;
  expandedNodes: Set<string>;
  onToggleSelect: (node: TeamNode) => void;
  onToggleExpand: (value: string) => void;
  depth?: number;
}) {
  const leaf = isLeaf(node);
  const expanded = expandedNodes.has(node.value);

  // For group nodes, check if all children are selected
  const leafIds = getLeafIds(node);
  const allSelected = leafIds.every((id) => selectedIds.has(id));
  const someSelected = !allSelected && leafIds.some((id) => selectedIds.has(id));

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 py-1 px-1 rounded-md hover:bg-muted/50 cursor-pointer transition-colors",
          depth === 0 && "font-semibold"
        )}
        style={{ paddingLeft: depth * 16 + 4 }}
      >
        {/* Expand/collapse for non-leaf */}
        {!leaf ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleExpand(node.value); }}
            className="h-4 w-4 flex items-center justify-center shrink-0"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Checkbox */}
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => { if (el) el.indeterminate = someSelected; }}
          onChange={() => onToggleSelect(node)}
          className="rounded border-muted-foreground/30 h-3.5 w-3.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
        />

        {/* Label */}
        <span
          className={cn("text-xs truncate", leaf ? "text-foreground" : "text-foreground font-medium")}
          onClick={() => {
            if (!leaf) onToggleExpand(node.value);
            else onToggleSelect(node);
          }}
        >
          {node.label}
          {!leaf && (
            <span className="text-muted-foreground font-normal ml-1">({leafIds.length})</span>
          )}
        </span>
      </div>

      {/* Children */}
      {!leaf && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.value}
              node={child}
              selectedIds={selectedIds}
              expandedNodes={expandedNodes}
              onToggleSelect={onToggleSelect}
              onToggleExpand={onToggleExpand}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────── Main Component ─────────────── */

export default function TeamProductionPage() {
  const initRange = getThisMonthRange();

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [dateFrom, setDateFrom] = useState(initRange.from);
  const [dateTo, setDateTo] = useState(initRange.to);
  const [activePreset, setActivePreset] = useState<string | null>("This Month");
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(["all"]));

  const [excludeTestClients, setExcludeTestClients] = useState(true);
  const EXCLUDE_CLIENT_IDS = "1,2";

  // Mobile team panel
  const [showTeamPanel, setShowTeamPanel] = useState(false);

  // Sort states
  const summarySort = useSort("assigneeName", true);
  const assignedSort = useSort("deadline", true);
  const deliveredSort = useSort("completedAt", false);

  /* ─── Tree selection logic ─── */
  const toggleSelect = useCallback((node: TeamNode) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      const leafIds = getLeafIds(node);
      const allSelected = leafIds.every((id) => next.has(id));
      if (allSelected) {
        leafIds.forEach((id) => next.delete(id));
      } else {
        leafIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, []);

  const toggleExpand = useCallback((value: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  /* ─── Fetch data ─── */
  const fetchData = useCallback(async () => {
    if (selectedUserIds.size === 0) {
      setTasks([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: dateFrom,
        to: dateTo,
        userIds: Array.from(selectedUserIds).join(","),
      });
      if (excludeTestClients) params.set("excludeClients", EXCLUDE_CLIENT_IDS);
      const res = await fetch(`/api/operations/team-production?${params.toString()}`);
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (err) {
      console.error("Failed to fetch team production:", err);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedUserIds, excludeTestClients]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ─── Filter by search ─── */
  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return tasks;
    const q = searchQuery.toLowerCase();
    return tasks.filter(
      (t) =>
        t.contentTitle.toLowerCase().includes(q) ||
        t.customerName.toLowerCase().includes(q) ||
        (t.assigneeName || "").toLowerCase().includes(q) ||
        t.taskTitle.toLowerCase().includes(q) ||
        t.contentType.toLowerCase().includes(q)
    );
  }, [tasks, searchQuery]);

  /* ─── Split tasks ─── */
  const assignedTasks = useMemo(() => {
    return filteredTasks.filter((t) => {
      if (t.completedAt) return false;
      const deadlineInPeriod = t.deadline && t.deadline >= dateFrom && t.deadline <= dateTo + "T23:59:59.999Z";
      const createdInPeriod = t.createdAt && t.createdAt >= dateFrom && t.createdAt <= dateTo + "T23:59:59.999Z";
      return deadlineInPeriod || createdInPeriod || !t.deadline;
    });
  }, [filteredTasks, dateFrom, dateTo]);

  const deliveredTasks = useMemo(() => {
    return filteredTasks.filter((t) => {
      if (!t.completedAt) return false;
      return t.completedAt >= dateFrom && t.completedAt <= dateTo + "T23:59:59.999Z";
    });
  }, [filteredTasks, dateFrom, dateTo]);

  /* ─── Per-user summary ─── */
  const userSummary = useMemo(() => {
    const map: Record<string, { assigneeName: string; assigneeId: string; assignedCUs: number; deliveredCUs: number }> = {};
    for (const t of assignedTasks) {
      const id = t.assigneeId || "unknown";
      if (!map[id]) map[id] = { assigneeName: t.assigneeName || "Unknown", assigneeId: id, assignedCUs: 0, deliveredCUs: 0 };
      map[id].assignedCUs += t.taskCUs;
    }
    for (const t of deliveredTasks) {
      const id = t.assigneeId || "unknown";
      if (!map[id]) map[id] = { assigneeName: t.assigneeName || "Unknown", assigneeId: id, assignedCUs: 0, deliveredCUs: 0 };
      map[id].deliveredCUs += t.taskCUs;
    }
    return Object.values(map);
  }, [assignedTasks, deliveredTasks]);

  /* ─── Sorted data ─── */
  const sortedSummary = useMemo(
    () => sortRows(userSummary, summarySort.currentSort, summarySort.currentAsc),
    [userSummary, summarySort.currentSort, summarySort.currentAsc]
  );
  const sortedAssigned = useMemo(
    () => sortRows(assignedTasks, assignedSort.currentSort, assignedSort.currentAsc),
    [assignedTasks, assignedSort.currentSort, assignedSort.currentAsc]
  );
  const sortedDelivered = useMemo(
    () => sortRows(deliveredTasks, deliveredSort.currentSort, deliveredSort.currentAsc),
    [deliveredTasks, deliveredSort.currentSort, deliveredSort.currentAsc]
  );

  /* ─── Totals ─── */
  const totalAssignedCUs = assignedTasks.reduce((sum, t) => sum + t.taskCUs, 0);
  const totalDeliveredCUs = deliveredTasks.reduce((sum, t) => sum + t.taskCUs, 0);

  /* ─── Preset click ─── */
  const handlePreset = (p: typeof presets[0]) => {
    const r = p.getRange();
    setDateFrom(r.from);
    setDateTo(r.to);
    setActivePreset(p.label);
  };

  /* ─────────────── Render ─────────────── */
  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Team Production</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Track assigned and delivered content units by team member.
        </p>
      </div>

      {/* Controls bar — full width, matches other operations pages */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          {/* Date presets */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => handlePreset(p)}
                className={cn(
                  "px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
                  activePreset === p.label ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Date pickers */}
          <div className="flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setActivePreset(null); }}
              className="h-7 text-xs rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setActivePreset(null); }}
              className="h-7 text-xs rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="flex-1" />

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

          {/* Mobile team selector toggle */}
          <button
            onClick={() => setShowTeamPanel(!showTeamPanel)}
            className={cn(
              "lg:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
              showTeamPanel ? "bg-foreground text-background" : "bg-muted/50 text-muted-foreground hover:text-foreground"
            )}
          >
            <Users className="h-3.5 w-3.5" />
            Team
            {selectedUserIds.size > 0 && (
              <span className="bg-blue-500 text-white text-[9px] rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
                {selectedUserIds.size}
              </span>
            )}
          </button>
        </CardContent>
      </Card>

      {/* Main layout — sidebar + content */}
      <div className="flex gap-4">
        {/* Team tree sidebar — hidden on mobile unless toggled */}
        <div className={cn(
          "w-[260px] shrink-0 space-y-2",
          "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:w-[300px] max-lg:bg-background max-lg:p-4 max-lg:pt-20 max-lg:shadow-xl max-lg:overflow-y-auto",
          !showTeamPanel && "max-lg:hidden"
        )}>
          {/* Mobile close */}
          <div className="lg:hidden flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Select Team</span>
            <button onClick={() => setShowTeamPanel(false)} className="text-xs text-muted-foreground hover:text-foreground">
              Close
            </button>
          </div>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-2 max-h-[calc(100vh-200px)] overflow-y-auto">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1 mb-1">
                Select Team / Members
              </div>
              {TEAMS.map((node) => (
                <TreeNode
                  key={node.value}
                  node={node}
                  selectedIds={selectedUserIds}
                  expandedNodes={expandedNodes}
                  onToggleSelect={toggleSelect}
                  onToggleExpand={toggleExpand}
                />
              ))}
              {selectedUserIds.size > 0 && (
                <div className="mt-2 pt-2 border-t px-2">
                  <button
                    onClick={() => setSelectedUserIds(new Set())}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear selection ({selectedUserIds.size} selected)
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Mobile backdrop */}
        {showTeamPanel && (
          <div className="lg:hidden fixed inset-0 bg-black/20 z-30" onClick={() => setShowTeamPanel(false)} />
        )}

        {/* Content area */}
        <div className="flex-1 min-w-0 space-y-4">
          {selectedUserIds.size === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-12 text-center">
                <Users className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Select a team or team member to view production data.
                </p>
                <button
                  onClick={() => setShowTeamPanel(true)}
                  className="lg:hidden mt-3 px-4 py-2 rounded-lg text-xs font-medium bg-foreground text-background"
                >
                  Open Team Selector
                </button>
              </CardContent>
            </Card>
          ) : loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-2 gap-4">
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                      <ClipboardList className="h-5 w-5 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold tabular-nums">{totalAssignedCUs.toFixed(1)}</p>
                      <p className="text-xs text-muted-foreground">Assigned Tasks CUs</p>
                    </div>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">{assignedTasks.length} tasks</span>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold tabular-nums">{totalDeliveredCUs.toFixed(1)}</p>
                      <p className="text-xs text-muted-foreground">Delivered Tasks CUs</p>
                    </div>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">{deliveredTasks.length} tasks</span>
                  </CardContent>
                </Card>
              </div>

              {/* Summary table */}
              <Card className="border-0 shadow-sm">
                <CardContent className="p-0">
                  <div className="overflow-auto max-h-[240px]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background z-[1]">
                        <tr className="border-b">
                          <SortHeader label="Team Member" sortKey="assigneeName" {...summarySort} onSort={summarySort.toggle} />
                          <SortHeader label="Assigned CUs" sortKey="assignedCUs" {...summarySort} onSort={summarySort.toggle} align="right" />
                          <SortHeader label="Delivered CUs" sortKey="deliveredCUs" {...summarySort} onSort={summarySort.toggle} align="right" />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedSummary.length === 0 ? (
                          <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No task data for the selected period.</td></tr>
                        ) : (
                          sortedSummary.map((u) => (
                            <tr key={u.assigneeId} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                              <td className="px-3 py-2 font-medium">{u.assigneeName}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{u.assignedCUs.toFixed(1)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{u.deliveredCUs.toFixed(1)}</td>
                            </tr>
                          ))
                        )}
                        {sortedSummary.length > 0 && (
                          <tr className="border-t-2 border-border bg-muted/20 font-semibold">
                            <td className="px-3 py-2">Total</td>
                            <td className="px-3 py-2 text-right tabular-nums">{totalAssignedCUs.toFixed(1)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{totalDeliveredCUs.toFixed(1)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Assigned Tasks Table */}
              <Card className="border-0 shadow-sm">
                <CardContent className="p-0">
                  <div className="px-4 py-3 border-b flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-blue-500" />
                    <h3 className="text-sm font-semibold">Assigned Tasks</h3>
                    <span className="text-xs text-muted-foreground">({assignedTasks.length})</span>
                  </div>
                  <div className="overflow-auto max-h-[400px]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background z-[1]">
                        <tr className="border-b">
                          <SortHeader label="Assignee" sortKey="assigneeName" {...assignedSort} onSort={assignedSort.toggle} />
                          <SortHeader label="Customer" sortKey="customerName" {...assignedSort} onSort={assignedSort.toggle} />
                          <SortHeader label="Type" sortKey="contentType" {...assignedSort} onSort={assignedSort.toggle} />
                          <SortHeader label="Content" sortKey="contentTitle" {...assignedSort} onSort={assignedSort.toggle} />
                          <SortHeader label="Task" sortKey="taskTitle" {...assignedSort} onSort={assignedSort.toggle} />
                          <SortHeader label="CUs" sortKey="taskCUs" {...assignedSort} onSort={assignedSort.toggle} align="right" />
                          <SortHeader label="Deadline" sortKey="deadline" {...assignedSort} onSort={assignedSort.toggle} />
                          <SortHeader label="Created" sortKey="createdAt" {...assignedSort} onSort={assignedSort.toggle} />
                          <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-center w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedAssigned.length === 0 ? (
                          <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">No assigned tasks found.</td></tr>
                        ) : (
                          sortedAssigned.map((t) => {
                            const overdue = t.deadline && new Date(t.deadline) < new Date();
                            return (
                              <tr key={t.taskId} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                                <td className="px-3 py-2 font-medium">{t.assigneeName || "—"}</td>
                                <td className="px-3 py-2">{t.customerName}</td>
                                <td className="px-3 py-2 capitalize">{t.contentType}</td>
                                <td className="px-3 py-2 max-w-[200px] truncate" title={t.contentTitle}>{t.contentTitle}</td>
                                <td className="px-3 py-2 capitalize">{t.taskTitle}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{t.taskCUs.toFixed(1)}</td>
                                <td className={cn("px-3 py-2", overdue && "text-red-500 font-medium")}>{fmtDate(t.deadline)}</td>
                                <td className="px-3 py-2">{fmtDate(t.createdAt)}</td>
                                <td className="px-3 py-2 text-center">
                                  {t.contentId && (
                                    <a href={`https://app.thecontentengine.com/all/contents/${t.contentId}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600">
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
                </CardContent>
              </Card>

              {/* Delivered Tasks Table */}
              <Card className="border-0 shadow-sm">
                <CardContent className="p-0">
                  <div className="px-4 py-3 border-b flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <h3 className="text-sm font-semibold">Delivered Tasks</h3>
                    <span className="text-xs text-muted-foreground">({deliveredTasks.length})</span>
                  </div>
                  <div className="overflow-auto max-h-[400px]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background z-[1]">
                        <tr className="border-b">
                          <SortHeader label="Assignee" sortKey="assigneeName" {...deliveredSort} onSort={deliveredSort.toggle} />
                          <SortHeader label="Customer" sortKey="customerName" {...deliveredSort} onSort={deliveredSort.toggle} />
                          <SortHeader label="Type" sortKey="contentType" {...deliveredSort} onSort={deliveredSort.toggle} />
                          <SortHeader label="Content" sortKey="contentTitle" {...deliveredSort} onSort={deliveredSort.toggle} />
                          <SortHeader label="Task" sortKey="taskTitle" {...deliveredSort} onSort={deliveredSort.toggle} />
                          <SortHeader label="CUs" sortKey="taskCUs" {...deliveredSort} onSort={deliveredSort.toggle} align="right" />
                          <SortHeader label="Completed" sortKey="completedAt" {...deliveredSort} onSort={deliveredSort.toggle} />
                          <SortHeader label="Created" sortKey="createdAt" {...deliveredSort} onSort={deliveredSort.toggle} />
                          <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-center w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedDelivered.length === 0 ? (
                          <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">No delivered tasks found.</td></tr>
                        ) : (
                          sortedDelivered.map((t) => (
                            <tr key={t.taskId} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                              <td className="px-3 py-2 font-medium">{t.assigneeName || "—"}</td>
                              <td className="px-3 py-2">{t.customerName}</td>
                              <td className="px-3 py-2 capitalize">{t.contentType}</td>
                              <td className="px-3 py-2 max-w-[200px] truncate" title={t.contentTitle}>{t.contentTitle}</td>
                              <td className="px-3 py-2 capitalize">{t.taskTitle}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{t.taskCUs.toFixed(1)}</td>
                              <td className="px-3 py-2">{fmtDate(t.completedAt)}</td>
                              <td className="px-3 py-2">{fmtDate(t.createdAt)}</td>
                              <td className="px-3 py-2 text-center">
                                {t.contentId && (
                                  <a href={`https://app.thecontentengine.com/all/contents/${t.contentId}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600">
                                    <ExternalLink className="h-3 w-3 inline" />
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
          )}
        </div>
      </div>
    </div>
  );
}
