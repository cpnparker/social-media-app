"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  ExternalLink,
  Send,
  CheckCircle2,
  Circle,
  Link2,
  Lightbulb,
  Leaf,
  ChevronDown,
  CalendarDays,
  User,
  StickyNote,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import dynamic from "next/dynamic";
import Link from "next/link";
import { cn } from "@/lib/utils";
import PromoDraftsSection from "@/components/content/PromoDraftsSection";

const TiptapEditor = dynamic(
  () => import("@/components/content/TiptapEditor"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[400px] flex items-center justify-center text-muted-foreground text-sm">
        Loading editor...
      </div>
    ),
  }
);

const taskStatuses = ["todo", "done"];

const statusMeta: Record<string, { icon: any; color: string; label: string }> = {
  todo: { icon: Circle, color: "text-gray-300 dark:text-gray-600", label: "To Do" },
  done: { icon: CheckCircle2, color: "text-green-500", label: "Done" },
};

export default function ContentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const contentId = params.id as string;

  const [obj, setObj] = useState<any>(null);
  const [idea, setIdea] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [linkedPosts, setLinkedPosts] = useState<any[]>([]);
  const [promoDraftsList, setPromoDraftsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Inline title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  // Task form
  const [newTaskTitle, setNewTaskTitle] = useState("");

  // Expanded task panel
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/content-objects/${contentId}`);
      const data = await res.json();
      setObj(data.contentObject || null);
      setIdea(data.idea || null);
      setTasks(data.tasks || []);
      setLinkedPosts(data.posts || []);
      setPromoDraftsList(data.promoDrafts || []);
    } catch (err) {
      console.error("Failed to fetch content:", err);
    } finally {
      setLoading(false);
    }
  }, [contentId]);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  const saveField = async (updates: any) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/content-objects/${contentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.contentObject) setObj(data.contentObject);
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const addTask = async () => {
    if (!newTaskTitle.trim()) return;
    const maxSort = tasks.length > 0 ? Math.max(...tasks.map((t) => t.sortOrder || 0)) : -1;
    try {
      const res = await fetch("/api/production-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentObjectId: contentId,
          title: newTaskTitle.trim(),
          priority: "medium",
          sortOrder: maxSort + 1,
          workspaceId: obj?.workspaceId,
        }),
      });
      const data = await res.json();
      if (data.task) {
        setTasks((prev) => [...prev, data.task]);
        setNewTaskTitle("");
      }
    } catch (err) {
      console.error("Add task failed:", err);
    }
  };

  const cycleTaskStatus = (task: any) => {
    // DB is two-state: date_completed null (todo) or set (done)
    // Icon click toggles directly between todo and done
    const next = task.status === "done" ? "todo" : "done";
    updateTask(task.id, { status: next });
  };

  const updateTask = async (taskId: string, updates: any) => {
    try {
      const res = await fetch(`/api/production-tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.task) {
        // Merge API response with existing task to preserve any fields the API doesn't return
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...data.task } : t)));
      }
    } catch (err) {
      console.error("Update task failed:", err);
    }
  };

  const deleteTask = async (taskId: string) => {
    try {
      await fetch(`/api/production-tasks/${taskId}`, { method: "DELETE" });
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      if (expandedTaskId === taskId) setExpandedTaskId(null);
    } catch (err) {
      console.error("Delete task failed:", err);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this content object and all its tasks?")) return;
    try {
      await fetch(`/api/content-objects/${contentId}`, { method: "DELETE" });
      router.push("/content");
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!obj) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <p className="text-center text-muted-foreground py-16">Content not found</p>
      </div>
    );
  }

  const sortedTasks = [...tasks].sort(
    (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const doneCount = sortedTasks.filter((t) => t.status === "done").length;
  const totalTasks = sortedTasks.length;
  const progressPct = totalTasks > 0 ? (doneCount / totalTasks) * 100 : 0;

  return (
    <div className="max-w-6xl">
      {/* ── Breadcrumb + Header ── */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1.5 h-8 px-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Button>
          {idea && (
            <>
              <span className="text-muted-foreground/40">/</span>
              <Link href={`/ideas/${idea.id}`} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                <Lightbulb className="h-3 w-3" />
                {idea.title?.length > 30 ? idea.title.substring(0, 30) + "..." : idea.title}
              </Link>
            </>
          )}
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  if (titleDraft.trim() && titleDraft !== (obj.finalTitle || obj.workingTitle)) {
                    saveField(obj.finalTitle ? { finalTitle: titleDraft.trim() } : { workingTitle: titleDraft.trim() });
                  }
                  setEditingTitle(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditingTitle(false);
                }}
                className="text-2xl font-bold tracking-tight w-full bg-transparent border-0 border-b-2 border-foreground/20 focus:border-foreground/40 outline-none pb-1"
              />
            ) : (
              <h1
                className="text-2xl font-bold tracking-tight truncate cursor-pointer hover:text-foreground/80 transition-colors"
                onClick={() => { setTitleDraft(obj.finalTitle || obj.workingTitle); setEditingTitle(true); }}
                title="Click to edit title"
              >
                {obj.finalTitle || obj.workingTitle}
              </h1>
            )}
            <div className="flex items-center gap-2 mt-1.5">
              <Badge variant="secondary" className="border-0 text-[10px] capitalize bg-muted">{obj.contentType}</Badge>
              {obj.evergreenFlag && (
                <Badge variant="secondary" className="border-0 text-[10px] bg-green-500/10 text-green-600 gap-1">
                  <Leaf className="h-2.5 w-2.5" /> Evergreen
                </Badge>
              )}
              {saving && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Saving...
                </span>
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleDelete} className="text-muted-foreground hover:text-red-500 h-8 w-8 p-0 shrink-0">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── LEFT: Editor + Production Pipeline ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Editor */}
          <Card className="border-0 shadow-sm overflow-hidden">
            <CardContent className="p-0">
              <TiptapEditor
                content={obj.body || ""}
                onChange={(html) => saveField({ body: html })}
                placeholder="Start writing your content..."
                editable={true}
              />
            </CardContent>
          </Card>

          {/* Production Pipeline */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="px-5 pt-5 pb-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  Production Pipeline
                  {totalTasks > 0 && (
                    <span className={cn("text-xs font-normal", doneCount === totalTasks ? "text-green-600" : "text-muted-foreground")}>
                      {doneCount}/{totalTasks} complete
                    </span>
                  )}
                </CardTitle>
              </div>
              {totalTasks > 0 && (
                <div className="h-1.5 bg-muted rounded-full mt-3 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", doneCount === totalTasks ? "bg-green-500" : "bg-blue-500")}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              )}
            </CardHeader>
            <CardContent className="px-5 pb-5 pt-4">
              {totalTasks === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-muted-foreground mb-3">
                    No production steps yet.{" "}
                    <Link href="/settings/templates" className="underline underline-offset-2 hover:text-foreground">Set up templates</Link>{" "}
                    or add one below.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {sortedTasks.map((task) => {
                    const meta = statusMeta[task.status] || statusMeta.todo;
                    const Icon = meta.icon;
                    const isExpanded = expandedTaskId === task.id;
                    const hasDueDate = !!task.dueDate;
                    const hasNotes = !!task.notes;

                    return (
                      <div key={task.id} className={cn("rounded-lg border transition-all", isExpanded ? "border-border bg-muted/30" : "border-transparent")}>
                        {/* Task row */}
                        <div className={cn("group flex items-center gap-3 py-2.5 px-3 rounded-lg transition-colors cursor-pointer")}>
                          {/* Status icon — click to toggle todo/done */}
                          <button
                            onClick={(e) => { e.stopPropagation(); cycleTaskStatus(task); }}
                            className={cn("shrink-0 transition-all hover:scale-110", meta.color)}
                            title={`${meta.label} — click to toggle`}
                          >
                            <Icon className={cn("h-5 w-5", task.status === "done" && "fill-green-500/20")} />
                          </button>

                          {/* Title + inline meta */}
                          <div className="flex-1 min-w-0 flex items-center gap-2" onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}>
                            <span className={cn("text-sm flex-1 truncate", task.status === "done" ? "line-through text-muted-foreground/60" : "font-medium")}>
                              {task.title}
                            </span>

                            {/* Inline indicators */}
                            <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                              {task.assignedToName && (
                                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                  <User className="h-3 w-3" />
                                  {task.assignedToName}
                                </span>
                              )}
                              {hasDueDate && (
                                <span className={cn("text-[10px] flex items-center gap-0.5", new Date(task.dueDate) < new Date() && task.status !== "done" ? "text-red-500" : "text-muted-foreground")}>
                                  <CalendarDays className="h-3 w-3" />
                                  {new Date(task.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                </span>
                              )}
                              {hasNotes && <span title="Has notes"><StickyNote className="h-3 w-3 text-amber-400" /></span>}
                            </div>
                          </div>

                          {/* Expand chevron */}
                          <button onClick={() => setExpandedTaskId(isExpanded ? null : task.id)} className="shrink-0 text-muted-foreground/40 hover:text-foreground transition-colors p-0.5">
                            <ChevronDown className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")} />
                          </button>

                          {/* Delete */}
                          <button onClick={() => deleteTask(task.id)} className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-red-500 transition-all p-0.5">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Expanded detail panel */}
                        {isExpanded && (
                          <div className="px-3 pb-4 pt-1 space-y-4">
                            <Separator />
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                              {/* Status */}
                              <div>
                                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Status</label>
                                <select
                                  value={task.status}
                                  onChange={(e) => updateTask(task.id, { status: e.target.value })}
                                  className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm h-8"
                                >
                                  {taskStatuses.map((s) => (
                                    <option key={s} value={s}>{statusMeta[s]?.label || s}</option>
                                  ))}
                                </select>
                              </div>

                              {/* Deadline */}
                              <div>
                                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Deadline</label>
                                <Input
                                  type="date"
                                  value={task.dueDate ? new Date(task.dueDate).toISOString().split("T")[0] : ""}
                                  onChange={(e) => updateTask(task.id, { dueDate: e.target.value || null })}
                                  className="h-8 text-sm"
                                />
                              </div>

                              {/* Assigned To */}
                              <div>
                                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Assigned To</label>
                                <div className="text-sm text-muted-foreground py-1.5">
                                  {task.assignedToName || "Unassigned"}
                                </div>
                              </div>
                            </div>

                            {/* Completed info — shown when done */}
                            {task.status === "done" && task.completedAt && (
                              <div className="flex items-center gap-4 text-xs text-muted-foreground bg-green-500/5 rounded-md px-3 py-2">
                                <span className="flex items-center gap-1">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                  Completed {new Date(task.completedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                                </span>
                              </div>
                            )}

                            {/* Notes */}
                            <div>
                              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Notes</label>
                              <textarea
                                value={task.notes || ""}
                                onChange={(e) => updateTask(task.id, { notes: e.target.value })}
                                placeholder="Add notes about this task..."
                                rows={3}
                                className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add task */}
              <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                <Plus className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                <input
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Add production step..."
                  className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/40"
                  onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
                />
                {newTaskTitle.trim() && (
                  <Button onClick={addTask} size="sm" variant="ghost" className="h-7 px-2 text-xs">
                    Add
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── RIGHT: Sidebar ── */}
        <div className="space-y-4">
          {/* Content Details */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="px-4 pt-4 pb-0">
              <CardTitle className="text-sm font-semibold">Details</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-3 space-y-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Working Title</label>
                <Input
                  value={obj.workingTitle}
                  onChange={(e) => setObj({ ...obj, workingTitle: e.target.value })}
                  onBlur={() => saveField({ workingTitle: obj.workingTitle })}
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Final Title</label>
                <Input
                  value={obj.finalTitle || ""}
                  onChange={(e) => setObj({ ...obj, finalTitle: e.target.value })}
                  onBlur={() => saveField({ finalTitle: obj.finalTitle })}
                  className="mt-1 h-8 text-sm"
                  placeholder="Set when ready to publish"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Content Type</label>
                <select
                  value={obj.contentType}
                  onChange={(e) => saveField({ contentType: e.target.value })}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm h-8"
                >
                  {["article", "video", "graphic", "thread", "newsletter", "podcast", "other"].map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <input type="checkbox" id="evergreen" checked={obj.evergreenFlag} onChange={(e) => saveField({ evergreenFlag: e.target.checked })} className="rounded h-3.5 w-3.5" />
                <label htmlFor="evergreen" className="text-xs text-muted-foreground cursor-pointer">Evergreen content</label>
              </div>
            </CardContent>
          </Card>

          {/* Links & References */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="px-4 pt-4 pb-0">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5" /> Links
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-3 space-y-3">
              {idea && (
                <Link href={`/ideas/${idea.id}`} className="flex items-center gap-2 p-2 -mx-2 rounded-lg hover:bg-muted transition-colors text-sm group">
                  <div className="h-7 w-7 rounded-md bg-amber-500/10 flex items-center justify-center shrink-0">
                    <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate group-hover:text-foreground">{idea.title}</p>
                    <p className="text-[10px] text-muted-foreground">Original idea</p>
                  </div>
                  <ExternalLink className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                </Link>
              )}
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">External Doc</label>
                <Input
                  value={obj.externalDocUrl || ""}
                  onChange={(e) => setObj({ ...obj, externalDocUrl: e.target.value })}
                  onBlur={() => saveField({ externalDocUrl: obj.externalDocUrl })}
                  className="mt-1 h-8 text-sm"
                  placeholder="https://docs.google.com/..."
                />
              </div>
              {linkedPosts.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Social Posts ({linkedPosts.length})</label>
                    <div className="mt-1.5 space-y-1">
                      {linkedPosts.map((post: any) => (
                        <Link key={post.id} href={`/posts/${post.latePostId || post.id}`} className="flex items-center gap-2 p-1.5 -mx-1.5 rounded-md hover:bg-muted transition-colors text-xs">
                          <Send className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="truncate flex-1">{post.content?.substring(0, 50) || "Post"}</span>
                          <Badge variant="secondary" className="text-[9px] capitalize shrink-0">{post.status}</Badge>
                        </Link>
                      ))}
                    </div>
                  </div>
                </>
              )}
              <Separator />
              <Link href={`/compose?contentObjectId=${contentId}`}>
                <Button variant="outline" size="sm" className="w-full h-8 gap-1.5 text-xs">
                  <Send className="h-3 w-3" /> Create Social Post
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Promo Drafts */}
          <PromoDraftsSection
            contentObjectId={contentId}
            workspaceId={obj.workspaceId}
            contentTitle={obj.finalTitle || obj.workingTitle}
            contentBody={obj.body}
            drafts={promoDraftsList}
            onDraftsChange={setPromoDraftsList}
          />
        </div>
      </div>
    </div>
  );
}
