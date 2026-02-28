"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Search,
  Clock,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const priorityColors: Record<string, string> = {
  urgent: "bg-red-500/10 text-red-500",
  high: "bg-orange-500/10 text-orange-500",
  medium: "bg-blue-500/10 text-blue-500",
  low: "bg-gray-500/10 text-gray-500",
};

const statusColors: Record<string, string> = {
  in_progress: "bg-blue-500/10 text-blue-500",
  review: "bg-amber-500/10 text-amber-500",
};

const statusLabels: Record<string, string> = {
  in_progress: "In Progress",
  review: "In Review",
};

interface ContentObject {
  id: string;
  workingTitle: string;
  finalTitle: string | null;
  contentType: string;
  contentUnits: number | null;
  customerId: string | null;
  customerName: string | null;
  totalTasks: number;
  doneTasks: number;
}

interface ProductionTask {
  id: string;
  contentObjectId: string;
  title: string;
  status: string;
  priority: string;
  assignedTo: string | null;
  createdAt: string;
  dueDate: string | null;
}

interface Member {
  id: string;
  name: string;
  email: string;
}

export default function WorkInProgressPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<ProductionTask[]>([]);
  const [contentObjects, setContentObjects] = useState<ContentObject[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksRes, contentRes, membersRes] = await Promise.all([
        fetch("/api/production-tasks?limit=500"),
        fetch("/api/content-objects?limit=500"),
        fetch("/api/workspace-members"),
      ]);

      const tasksData = await tasksRes.json();
      const contentData = await contentRes.json();
      const membersData = await membersRes.json();

      setTasks(tasksData.tasks || []);
      setContentObjects(contentData.contentObjects || []);
      setMembers(membersData.members || []);
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const contentMap = new Map<string, ContentObject>();
  for (const co of contentObjects) {
    contentMap.set(co.id, co);
  }

  const memberMap = new Map<string, Member>();
  for (const m of members) {
    memberMap.set(m.id, m);
  }

  // Only show in_progress and review tasks
  let filtered = tasks.filter(
    (t) => t.status === "in_progress" || t.status === "review"
  );

  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((task) => {
      const co = contentMap.get(task.contentObjectId);
      const title = co?.finalTitle || co?.workingTitle || "";
      const assignee = task.assignedTo ? memberMap.get(task.assignedTo) : null;
      return (
        task.title.toLowerCase().includes(q) ||
        title.toLowerCase().includes(q) ||
        (assignee?.name || "").toLowerCase().includes(q)
      );
    });
  }

  // Sort: overdue first, then by priority, then by date
  const priorityOrder: Record<string, number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  filtered.sort((a, b) => {
    const now = Date.now();
    const aOverdue = a.dueDate && new Date(a.dueDate).getTime() < now ? 0 : 1;
    const bOverdue = b.dueDate && new Date(b.dueDate).getTime() < now ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    const aPri = priorityOrder[a.priority] ?? 2;
    const bPri = priorityOrder[b.priority] ?? 2;
    if (aPri !== bPri) return aPri - bPri;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const inProgressCount = filtered.filter(
    (t) => t.status === "in_progress"
  ).length;
  const reviewCount = filtered.filter((t) => t.status === "review").length;
  const overdueCount = filtered.filter(
    (t) => t.dueDate && new Date(t.dueDate).getTime() < Date.now()
  ).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Clock className="h-6 w-6 text-blue-500" />
          Work in Progress
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tasks currently being worked on or awaiting review
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks, content, or assignee..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium">
              In Progress
            </p>
            <p className="text-2xl font-bold mt-1">{inProgressCount}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium">
              In Review
            </p>
            <p className="text-2xl font-bold mt-1">{reviewCount}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <AlertCircle className="h-3 w-3 text-red-500" />
              Overdue
            </p>
            <p className="text-2xl font-bold mt-1 text-red-500">
              {overdueCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {filtered.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Clock className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold mb-2">Nothing in progress</p>
            <p className="text-sm text-muted-foreground">
              No tasks are currently being worked on or in review
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Task
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Content
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Assigned To
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Priority
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Due Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((task) => {
                  const co = contentMap.get(task.contentObjectId);
                  const contentTitle =
                    co?.finalTitle || co?.workingTitle || "Untitled";
                  const assignee = task.assignedTo
                    ? memberMap.get(task.assignedTo)
                    : null;
                  const isOverdue =
                    task.dueDate &&
                    new Date(task.dueDate).getTime() < Date.now();

                  return (
                    <tr
                      key={task.id}
                      className="border-b hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() =>
                        router.push(`/content/${task.contentObjectId}`)
                      }
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium truncate max-w-xs">
                          {task.title}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {contentTitle}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {assignee ? (
                          <span className="text-xs">{assignee.name}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Unassigned
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "border-0 text-[10px] capitalize",
                            priorityColors[task.priority] || ""
                          )}
                        >
                          {task.priority}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "border-0 text-[10px]",
                            statusColors[task.status] || ""
                          )}
                        >
                          {statusLabels[task.status] || task.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {task.dueDate ? (
                          <span
                            className={cn(
                              "text-xs whitespace-nowrap",
                              isOverdue
                                ? "text-red-500 font-medium"
                                : "text-muted-foreground"
                            )}
                          >
                            {new Date(task.dueDate).toLocaleDateString()}
                            {isOverdue && " (overdue)"}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
