"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  KanbanSquare,
  Loader2,
  Search,
  AlertCircle,
  Calendar,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const columns = [
  { key: "todo", label: "To Do", color: "bg-gray-400" },
  { key: "in_progress", label: "In Progress", color: "bg-blue-500" },
  { key: "review", label: "Review", color: "bg-amber-500" },
  { key: "done", label: "Done", color: "bg-green-500" },
];

const priorityColors: Record<string, string> = {
  urgent: "bg-red-500/10 text-red-500",
  high: "bg-orange-500/10 text-orange-500",
  medium: "bg-blue-500/10 text-blue-500",
  low: "bg-gray-500/10 text-gray-500",
};

function ProductionPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filterParam = searchParams.get("filter");

  const [tasks, setTasks] = useState<any[]>([]);
  const [contentMap, setContentMap] = useState<Record<string, string>>({});
  const [contentTypeMap, setContentTypeMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [socialOnly, setSocialOnly] = useState(filterParam === "social");

  // Sync URL param changes
  useEffect(() => {
    setSocialOnly(filterParam === "social");
  }, [filterParam]);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksRes, contentRes] = await Promise.all([
        fetch("/api/production-tasks?limit=200"),
        fetch("/api/content-objects?limit=200"),
      ]);

      const tasksData = await tasksRes.json();
      const contentData = await contentRes.json();

      setTasks(tasksData.tasks || []);

      // Build content name + type maps
      const map: Record<string, string> = {};
      const typeMap: Record<string, string> = {};
      for (const obj of contentData.contentObjects || []) {
        map[obj.id] = obj.finalTitle || obj.workingTitle || "Untitled";
        typeMap[obj.id] = obj.contentType || "";
      }
      setContentMap(map);
      setContentTypeMap(typeMap);
    } catch (err) {
      console.error("Failed to fetch tasks:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const updateTaskStatus = async (taskId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/production-tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.task) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? data.task : t)));
      }
    } catch (err) {
      console.error("Update failed:", err);
    }
  };

  // Apply social filter then search filter
  let filtered = socialOnly
    ? tasks.filter((t) => {
        const cType = contentTypeMap[t.contentObjectId] || "";
        return cType === "thread" || cType === "graphic" || t.title?.toLowerCase().includes("social") || t.title?.toLowerCase().includes("promo");
      })
    : tasks;

  filtered = search
    ? filtered.filter(
        (t) =>
          t.title.toLowerCase().includes(search.toLowerCase()) ||
          (contentMap[t.contentObjectId] || "").toLowerCase().includes(search.toLowerCase())
      )
    : filtered;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <KanbanSquare className="h-6 w-6 text-violet-500" />
            Production Board
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track production tasks across all content
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            <button
              onClick={() => { setSocialOnly(false); router.replace("/production", { scroll: false }); }}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${!socialOnly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              All Tasks
            </button>
            <button
              onClick={() => { setSocialOnly(true); router.replace("/production?filter=social", { scroll: false }); }}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${socialOnly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Social Tasks
            </button>
          </div>
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-4 gap-4 min-h-[400px]">
        {columns.map((col) => {
          const colTasks = filtered
            .filter((t) => t.status === col.key)
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
          return (
            <div key={col.key} className="space-y-3">
              {/* Column header */}
              <div className="flex items-center gap-2 px-1">
                <div className={`h-2.5 w-2.5 rounded-full ${col.color}`} />
                <span className="text-sm font-semibold">{col.label}</span>
                <span className="text-xs text-muted-foreground">
                  ({colTasks.length})
                </span>
              </div>

              {/* Column tasks */}
              <div className="space-y-2 min-h-[100px] bg-muted/30 rounded-lg p-2">
                {colTasks.map((task) => (
                  <Card
                    key={task.id}
                    className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => router.push(`/content/${task.contentObjectId}`)}
                  >
                    <CardContent className="p-3 space-y-2">
                      <p className="text-sm font-medium line-clamp-2">{task.title}</p>

                      {contentMap[task.contentObjectId] && (
                        <p className="text-xs text-muted-foreground truncate">
                          {contentMap[task.contentObjectId]}
                        </p>
                      )}

                      <div className="flex items-center justify-between">
                        <Badge
                          variant="secondary"
                          className={`${priorityColors[task.priority] || ""} border-0 text-[10px] capitalize`}
                        >
                          {task.priority}
                        </Badge>

                        {task.dueDate && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {new Date(task.dueDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>

                      {/* Quick status change */}
                      <div className="flex gap-1 pt-1">
                        {columns
                          .filter((c) => c.key !== task.status)
                          .map((c) => (
                            <button
                              key={c.key}
                              onClick={(e) => {
                                e.stopPropagation();
                                updateTaskStatus(task.id, c.key);
                              }}
                              className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-muted-foreground/10 transition-colors truncate"
                              title={`Move to ${c.label}`}
                            >
                              {c.label}
                            </button>
                          ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {colTasks.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    No tasks
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ProductionPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <ProductionPageContent />
    </Suspense>
  );
}
