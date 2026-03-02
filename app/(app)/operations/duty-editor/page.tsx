"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  AlertTriangle,
  Clock,
  CheckCircle2,
  FileText,
  ArrowRight,
  User,
  CalendarDays,
  Zap,
  Search,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface ContentItem {
  id: string;
  workingTitle: string;
  contentType: string;
  customerName: string;
  status: string;
  createdAt: string;
  deadlineProduction: string | null;
  completedAt: string | null;
  deadlinePublication: string | null;
  isFastTurnaround: boolean;
  contentLeadName: string | null;
  totalTasks: number;
  doneTasks: number;
  currentTask: { type: string; assignee: string | null } | null;
}

export default function DutyEditorPage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const res = await fetch("/api/content-objects?limit=500");
        const data = await res.json();
        setItems(data.contentObjects || []);
      } catch (err) {
        console.error("Failed to fetch:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

  const active = useMemo(() => items.filter((i) => i.status === "draft"), [items]);

  // Items needing attention: overdue deadlines
  const overdue = useMemo(() => {
    return active.filter((i) => {
      const d = i.deadlineProduction || i.deadlinePublication;
      return d && new Date(d) < today;
    }).sort((a, b) => {
      const da = new Date(a.deadlineProduction || a.deadlinePublication || 0);
      const db = new Date(b.deadlineProduction || b.deadlinePublication || 0);
      return da.getTime() - db.getTime();
    });
  }, [active]);

  // Due this week
  const dueThisWeek = useMemo(() => {
    return active.filter((i) => {
      const d = i.deadlineProduction || i.deadlinePublication;
      if (!d) return false;
      const date = new Date(d);
      return date >= today && date <= weekFromNow;
    }).sort((a, b) => {
      const da = new Date(a.deadlineProduction || a.deadlinePublication || 0);
      const db = new Date(b.deadlineProduction || b.deadlinePublication || 0);
      return da.getTime() - db.getTime();
    });
  }, [active]);

  // Fast turnaround items
  const fastItems = useMemo(() => active.filter((i) => i.isFastTurnaround), [active]);

  // Items with no tasks / stalled
  const stalled = useMemo(() => {
    return active.filter((i) => i.totalTasks === 0 || (i.totalTasks > 0 && i.doneTasks === i.totalTasks));
  }, [active]);

  // Recently completed (last 7 days)
  const recentlyCompleted = useMemo(() => {
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    return items
      .filter((i) => i.status === "published" && i.completedAt && new Date(i.completedAt) >= sevenDaysAgo)
      .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime());
  }, [items]);

  // Search filter for content rows
  const matchesSearch = (item: ContentItem) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.workingTitle.toLowerCase().includes(q) ||
      item.customerName.toLowerCase().includes(q) ||
      item.contentType.toLowerCase().includes(q) ||
      (item.contentLeadName || "").toLowerCase().includes(q) ||
      (item.currentTask?.type || "").toLowerCase().includes(q) ||
      (item.currentTask?.assignee || "").toLowerCase().includes(q)
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const formatDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const daysOverdue = (d: string) => Math.ceil((today.getTime() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));

  const ContentRow = ({ item, showDeadline = true }: { item: ContentItem; showDeadline?: boolean }) => {
    const deadline = item.deadlineProduction || item.deadlinePublication;
    return (
      <Link href={`/content/${item.id}`} className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-muted/50 transition-colors group">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate group-hover:text-foreground">{item.workingTitle}</span>
            {item.isFastTurnaround && <Zap className="h-3 w-3 text-amber-500 shrink-0" />}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
            <span>{item.customerName || "—"}</span>
            <span className="text-muted-foreground/30">·</span>
            <span className="capitalize">{item.contentType}</span>
            {item.currentTask && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span className="flex items-center gap-0.5">
                  <ArrowRight className="h-2.5 w-2.5" />
                  {item.currentTask.type}
                  {item.currentTask.assignee && (
                    <span className="flex items-center gap-0.5 ml-1">
                      <User className="h-2.5 w-2.5" />
                      {item.currentTask.assignee}
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>
        {showDeadline && deadline && (
          <span className="text-xs text-muted-foreground shrink-0">{formatDate(deadline)}</span>
        )}
        {item.totalTasks > 0 && (
          <Badge variant="secondary" className="text-[10px] shrink-0">
            {item.doneTasks}/{item.totalTasks}
          </Badge>
        )}
      </Link>
    );
  };

  const filteredOverdue = overdue.filter(matchesSearch);
  const filteredDueThisWeek = dueThisWeek.filter(matchesSearch);
  const filteredFastItems = fastItems.filter(matchesSearch);
  const filteredStalled = stalled.filter(matchesSearch);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Duty Editor</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          {" · "}{active.length} active items
        </p>
      </div>

      {/* Controls bar — consistent with other operations pages */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          {/* Quick stat pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium",
              overdue.length > 0 ? "bg-red-500/10 text-red-500" : "bg-muted/50 text-muted-foreground"
            )}>
              <AlertTriangle className="h-3 w-3" />
              {overdue.length} Overdue
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-600">
              <CalendarDays className="h-3 w-3" />
              {dueThisWeek.length} Due This Week
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-600">
              <FileText className="h-3 w-3" />
              {active.length} Active
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-green-500/10 text-green-600">
              <CheckCircle2 className="h-3 w-3" />
              {recentlyCompleted.length} Done (7d)
            </div>
          </div>

          <div className="flex-1" />

          {/* Search */}
          <div className="relative w-[180px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
            <Input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-7 text-xs pl-7" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Overdue */}
        {filteredOverdue.length > 0 && (
          <Card className="border-0 shadow-sm ring-1 ring-red-500/20 lg:col-span-2">
            <CardHeader className="px-4 pt-4 pb-0">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-red-500">
                <AlertTriangle className="h-4 w-4" />
                Overdue ({filteredOverdue.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-2">
              {filteredOverdue.map((item) => {
                const deadline = item.deadlineProduction || item.deadlinePublication;
                return (
                  <div key={item.id} className="flex items-center gap-2">
                    <Badge variant="destructive" className="text-[9px] shrink-0">
                      {deadline ? `${daysOverdue(deadline)}d` : "—"}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <ContentRow item={item} showDeadline={false} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Due This Week */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="px-4 pt-4 pb-0">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-amber-500" />
              Due This Week ({filteredDueThisWeek.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-2">
            {filteredDueThisWeek.length > 0 ? (
              filteredDueThisWeek.map((item) => <ContentRow key={item.id} item={item} />)
            ) : (
              <p className="text-xs text-muted-foreground py-4 text-center">Nothing due this week.</p>
            )}
          </CardContent>
        </Card>

        {/* Fast Turnaround */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="px-4 pt-4 pb-0">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              Fast Turnaround ({filteredFastItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-2">
            {filteredFastItems.length > 0 ? (
              filteredFastItems.map((item) => <ContentRow key={item.id} item={item} />)
            ) : (
              <p className="text-xs text-muted-foreground py-4 text-center">No fast turnaround items.</p>
            )}
          </CardContent>
        </Card>

        {/* Needs Attention */}
        {filteredStalled.length > 0 && (
          <Card className="border-0 shadow-sm lg:col-span-2">
            <CardHeader className="px-4 pt-4 pb-0">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Needs Attention ({filteredStalled.length})
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Items with no production tasks, or all tasks already complete.</p>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-2">
              {filteredStalled.map((item) => <ContentRow key={item.id} item={item} />)}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
