"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, Clock, AlertTriangle, CheckCircle2, ArrowRight, User, Search } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface ContentItem {
  id: string;
  workingTitle: string;
  contentType: string;
  customerName: string;
  customerId: string;
  status: string;
  createdAt: string;
  deadlineProduction: string | null;
  deadlinePublication: string | null;
  isFastTurnaround: boolean;
  contentLeadName: string | null;
  totalTasks: number;
  doneTasks: number;
  currentTask: { type: string; assignee: string | null } | null;
}

export default function WorkInProgressPage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "overdue" | "fast">("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const res = await fetch("/api/content-objects?limit=500");
        const data = await res.json();
        // Only show active (draft/in-progress) items
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const active = (data.contentObjects || []).filter((i: any) => i.status === "draft");
        setItems(active);
      } catch (err) {
        console.error("Failed to fetch:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  const now = new Date();

  const overdueCount = items.filter((i) => {
    const d = i.deadlineProduction || i.deadlinePublication;
    return d && new Date(d) < now;
  }).length;

  const fastCount = items.filter((i) => i.isFastTurnaround).length;

  const filtered = useMemo(() => {
    let list = [...items];

    // Apply search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          i.workingTitle.toLowerCase().includes(q) ||
          i.customerName.toLowerCase().includes(q) ||
          i.contentType.toLowerCase().includes(q) ||
          (i.contentLeadName || "").toLowerCase().includes(q) ||
          (i.currentTask?.type || "").toLowerCase().includes(q) ||
          (i.currentTask?.assignee || "").toLowerCase().includes(q)
      );
    }

    if (filter === "overdue") {
      list = list.filter((i) => {
        const deadline = i.deadlineProduction || i.deadlinePublication;
        return deadline && new Date(deadline) < now;
      });
    } else if (filter === "fast") {
      list = list.filter((i) => i.isFastTurnaround);
    }
    // Sort: overdue first, then by deadline, then by creation date
    return list.sort((a, b) => {
      const deadlineA = a.deadlineProduction || a.deadlinePublication;
      const deadlineB = b.deadlineProduction || b.deadlinePublication;
      const isOverdueA = deadlineA && new Date(deadlineA) < now ? 1 : 0;
      const isOverdueB = deadlineB && new Date(deadlineB) < now ? 1 : 0;
      if (isOverdueA !== isOverdueB) return isOverdueB - isOverdueA;
      if (deadlineA && deadlineB) return new Date(deadlineA).getTime() - new Date(deadlineB).getTime();
      if (deadlineA) return -1;
      if (deadlineB) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [items, filter, searchQuery]);

  // Group by current task type
  const byCurrentStep = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of items) {
      const step = item.currentTask?.type || "No tasks";
      map[step] = (map[step] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [items]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const formatDeadline = (d: string | null) => {
    if (!d) return null;
    const date = new Date(d);
    const diff = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const formatted = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    if (diff < 0) return { text: `${formatted} (${Math.abs(diff)}d overdue)`, overdue: true };
    if (diff === 0) return { text: `${formatted} (today)`, overdue: false };
    if (diff <= 3) return { text: `${formatted} (${diff}d)`, overdue: false };
    return { text: formatted, overdue: false };
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Work in Progress</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {items.length} active content items across all customers.
        </p>
      </div>

      {/* Controls bar — consistent with other operations pages */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          {/* Filter toggles */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
            <button
              onClick={() => setFilter("all")}
              className={cn(
                "px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
                filter === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              All ({items.length})
            </button>
            {overdueCount > 0 && (
              <button
                onClick={() => setFilter("overdue")}
                className={cn(
                  "px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1",
                  filter === "overdue" ? "bg-red-500 text-white shadow-sm" : "text-red-500 hover:text-red-600"
                )}
              >
                <AlertTriangle className="h-3 w-3" />
                Overdue ({overdueCount})
              </button>
            )}
            {fastCount > 0 && (
              <button
                onClick={() => setFilter("fast")}
                className={cn(
                  "px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1",
                  filter === "fast" ? "bg-amber-500 text-white shadow-sm" : "text-amber-500 hover:text-amber-600"
                )}
              >
                <Clock className="h-3 w-3" />
                Fast ({fastCount})
              </button>
            )}
          </div>

          {/* Pipeline breakdown badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {byCurrentStep.map(([step, count]) => (
              <Badge key={step} variant="secondary" className="text-[10px] gap-1 py-0.5 px-2">
                <span className="font-semibold">{count}</span>
                <span className="text-muted-foreground">{step}</span>
              </Badge>
            ))}
          </div>

          <div className="flex-1" />

          {/* Search */}
          <div className="relative w-[180px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
            <Input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-7 text-xs pl-7" />
          </div>
        </CardContent>
      </Card>

      {/* Content list */}
      <div className="space-y-1.5">
        {filtered.map((item) => {
          const deadline = formatDeadline(item.deadlineProduction || item.deadlinePublication);
          const progress = item.totalTasks > 0 ? (item.doneTasks / item.totalTasks) * 100 : 0;

          return (
            <Link key={item.id} href={`/content/${item.id}`}>
              <Card className={cn(
                "border-0 shadow-sm hover:shadow-md transition-all cursor-pointer",
                deadline?.overdue && "ring-1 ring-red-500/30"
              )}>
                <CardContent className="p-3 flex items-center gap-3">
                  {/* Progress ring */}
                  <div className="relative h-10 w-10 shrink-0">
                    <svg className="h-10 w-10 -rotate-90" viewBox="0 0 36 36">
                      <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/50" />
                      <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={`${progress}, 100`} className={cn(progress === 100 ? "text-green-500" : "text-blue-500")} />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      {progress === 100 ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <span className="text-[9px] font-bold">{item.doneTasks}/{item.totalTasks}</span>
                      )}
                    </div>
                  </div>

                  {/* Content info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{item.workingTitle}</span>
                      {item.isFastTurnaround && (
                        <Badge variant="secondary" className="text-[9px] bg-amber-500/10 text-amber-600 shrink-0">Fast</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      <span>{item.customerName || "No customer"}</span>
                      <span className="text-muted-foreground/30">·</span>
                      <span className="capitalize">{item.contentType}</span>
                    </div>
                  </div>

                  {/* Current step */}
                  {item.currentTask && (
                    <div className="hidden sm:flex items-center gap-1.5 shrink-0 text-xs">
                      <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
                      <div className="text-right">
                        <p className="font-medium text-[11px]">{item.currentTask.type}</p>
                        {item.currentTask.assignee && (
                          <p className="text-[10px] text-muted-foreground flex items-center gap-0.5 justify-end">
                            <User className="h-2.5 w-2.5" />
                            {item.currentTask.assignee}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Deadline */}
                  <div className="shrink-0 text-right min-w-[90px]">
                    {deadline ? (
                      <span className={cn("text-[11px] font-medium", deadline.overdue ? "text-red-500" : "text-muted-foreground")}>
                        {deadline.text}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/40">No deadline</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            {filter !== "all" || searchQuery ? "No items match this filter." : "No active content items."}
          </div>
        )}
      </div>
    </div>
  );
}
