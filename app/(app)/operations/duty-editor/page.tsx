"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Search,
  UserCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  draft: "bg-gray-500/10 text-gray-500",
  in_progress: "bg-blue-500/10 text-blue-500",
  review: "bg-amber-500/10 text-amber-500",
  done: "bg-green-500/10 text-green-500",
};

const typeColors: Record<string, string> = {
  article: "bg-blue-500/10 text-blue-500",
  video: "bg-red-500/10 text-red-500",
  graphic: "bg-pink-500/10 text-pink-500",
  thread: "bg-violet-500/10 text-violet-500",
  newsletter: "bg-amber-500/10 text-amber-500",
  podcast: "bg-green-500/10 text-green-500",
  other: "bg-gray-500/10 text-gray-500",
};

interface ContentObject {
  id: string;
  workingTitle: string;
  finalTitle: string | null;
  contentType: string;
  contentUnits: number | null;
  customerId: string | null;
  customerName: string | null;
  assignedEditorId: string | null;
  assignedWriterId: string | null;
  status: string;
  totalTasks: number;
  doneTasks: number;
  createdAt: string;
}

interface Member {
  id: string;
  name: string;
  email: string;
}

export default function DutyEditorPage() {
  const router = useRouter();
  const [contentObjects, setContentObjects] = useState<ContentObject[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editorFilter, setEditorFilter] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [contentRes, membersRes] = await Promise.all([
        fetch("/api/content-objects?limit=500"),
        fetch("/api/workspace-members"),
      ]);

      const contentData = await contentRes.json();
      const membersData = await membersRes.json();

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

  const memberMap = new Map<string, Member>();
  for (const m of members) {
    memberMap.set(m.id, m);
  }

  // Only show content that is not done (active work needing editorial attention)
  let filtered = contentObjects.filter(
    (co) => co.status !== "done" && co.status !== "published"
  );

  if (editorFilter) {
    filtered = filtered.filter((co) => co.assignedEditorId === editorFilter);
  }

  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((co) => {
      const title = co.finalTitle || co.workingTitle || "";
      const editor = co.assignedEditorId
        ? memberMap.get(co.assignedEditorId)
        : null;
      const writer = co.assignedWriterId
        ? memberMap.get(co.assignedWriterId)
        : null;
      return (
        title.toLowerCase().includes(q) ||
        (editor?.name || "").toLowerCase().includes(q) ||
        (writer?.name || "").toLowerCase().includes(q) ||
        (co.customerName || "").toLowerCase().includes(q)
      );
    });
  }

  filtered.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Get unique editors for filter dropdown
  const editorIds = new Set(
    contentObjects
      .map((co) => co.assignedEditorId)
      .filter((id): id is string => id !== null)
  );
  const editors = Array.from(editorIds)
    .map((id) => memberMap.get(id))
    .filter((m): m is Member => m !== undefined);

  const assignedCount = filtered.filter((co) => co.assignedEditorId).length;
  const unassignedCount = filtered.filter((co) => !co.assignedEditorId).length;

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
          <UserCheck className="h-6 w-6 text-violet-500" />
          Duty Editor
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Editorial assignments and content requiring editor attention
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search content, editor, or customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        {editors.length > 0 && (
          <select
            value={editorFilter}
            onChange={(e) => setEditorFilter(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">All Editors</option>
            {editors.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium">
              Total Active
            </p>
            <p className="text-2xl font-bold mt-1">{filtered.length}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium">
              Editor Assigned
            </p>
            <p className="text-2xl font-bold mt-1">{assignedCount}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium">
              Needs Editor
            </p>
            <p className="text-2xl font-bold mt-1 text-amber-500">
              {unassignedCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {filtered.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <UserCheck className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold mb-2">No content items</p>
            <p className="text-sm text-muted-foreground">
              No active content requiring editorial attention
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
                    Content
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Customer
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Editor
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Writer
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Progress
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((co) => {
                  const editor = co.assignedEditorId
                    ? memberMap.get(co.assignedEditorId)
                    : null;
                  const writer = co.assignedWriterId
                    ? memberMap.get(co.assignedWriterId)
                    : null;
                  const title = co.finalTitle || co.workingTitle || "Untitled";
                  const progress =
                    co.totalTasks > 0
                      ? Math.round((co.doneTasks / co.totalTasks) * 100)
                      : 0;

                  return (
                    <tr
                      key={co.id}
                      className="border-b hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => router.push(`/content/${co.id}`)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium truncate max-w-xs">
                          {title}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "border-0 text-[10px] capitalize",
                            typeColors[co.contentType] || ""
                          )}
                        >
                          {co.contentType}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {co.customerName ? (
                          <span className="text-xs text-emerald-600 bg-emerald-500/10 rounded-full px-2 py-0.5 font-medium">
                            {co.customerName}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editor ? (
                          <span className="text-xs font-medium">
                            {editor.name}
                          </span>
                        ) : (
                          <span className="text-xs text-amber-500 font-medium">
                            Unassigned
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {writer ? (
                          <span className="text-xs">{writer.name}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {co.doneTasks}/{co.totalTasks}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "border-0 text-[10px] capitalize",
                            statusColors[co.status] || ""
                          )}
                        >
                          {co.status === "in_progress"
                            ? "In Progress"
                            : co.status}
                        </Badge>
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
