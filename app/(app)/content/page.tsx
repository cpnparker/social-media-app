"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  Plus,
  Loader2,
  Search,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { cn } from "@/lib/utils";

const typeColors: Record<string, string> = {
  article: "bg-blue-500/10 text-blue-500",
  video: "bg-red-500/10 text-red-500",
  graphic: "bg-pink-500/10 text-pink-500",
  thread: "bg-violet-500/10 text-violet-500",
  newsletter: "bg-amber-500/10 text-amber-500",
  podcast: "bg-green-500/10 text-green-500",
  other: "bg-gray-500/10 text-gray-500",
};

function deriveStatus(totalTasks: number, doneTasks: number) {
  if (totalTasks === 0) return { label: "No Tasks", color: "bg-muted text-muted-foreground" };
  if (doneTasks === totalTasks) return { label: "Complete", color: "bg-green-500/10 text-green-600" };
  if (doneTasks > 0) return { label: "In Progress", color: "bg-blue-500/10 text-blue-600" };
  return { label: "Not Started", color: "bg-gray-500/10 text-gray-500" };
}

const filterTabs = ["all", "not_started", "in_progress", "complete"];

export default function ContentPage() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");

  const fetchContent = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/content-objects?limit=100");
      const data = await res.json();
      setItems(data.contentObjects || []);
    } catch (err) {
      console.error("Failed to fetch content:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  // Filter by search
  let filtered = search
    ? items.filter(
        (i) =>
          i.workingTitle?.toLowerCase().includes(search.toLowerCase()) ||
          i.finalTitle?.toLowerCase().includes(search.toLowerCase()) ||
          i.contentType?.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  // Filter by production status tab
  if (activeTab !== "all") {
    filtered = filtered.filter((i) => {
      const total = Number(i.totalTasks) || 0;
      const done = Number(i.doneTasks) || 0;
      if (activeTab === "not_started") return total === 0 || done === 0;
      if (activeTab === "in_progress") return done > 0 && done < total;
      if (activeTab === "complete") return total > 0 && done === total;
      return true;
    });
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-blue-500" />
            Content
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage content through the production pipeline
          </p>
        </div>
        <Link href="/ideas">
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Commission an Idea
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {filterTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                activeTab === tab
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab === "not_started"
                ? "Not Started"
                : tab === "in_progress"
                  ? "In Progress"
                  : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search content..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold mb-2">No content yet</p>
            <p className="text-sm text-muted-foreground mb-4">
              Commission an idea to start producing content
            </p>
            <Link href="/ideas">
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Go to Ideas
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Title
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Production
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const total = Number(item.totalTasks) || 0;
                  const done = Number(item.doneTasks) || 0;
                  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                  const status = deriveStatus(total, done);
                  return (
                    <tr
                      key={item.id}
                      className="border-b hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => router.push(`/content/${item.id}`)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium truncate max-w-xs">
                          {item.finalTitle || item.workingTitle}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "border-0 text-[10px] capitalize",
                            typeColors[item.contentType] || ""
                          )}
                        >
                          {item.contentType}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {total > 0 ? (
                          <div className="flex items-center gap-2">
                            {/* Mini progress bar */}
                            <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all",
                                  pct === 100 ? "bg-green-500" : "bg-blue-500"
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {done}/{total}
                            </span>
                            {pct === 100 && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            No tasks
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {new Date(item.updatedAt).toLocaleDateString()}
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
