"use client";

import { useState, useEffect, useCallback } from "react";
import { Brain, Pencil, Trash2, Archive, Check, X, Sparkles, User, CalendarDays, MessageSquare, ChevronRight } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { AIMemory } from "@/lib/types/ai";

interface MemoryManagerProps {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}

interface ThreadSummary {
  id: string;
  title: string;
  summary: string;
  messageCount: number;
  clientId: number | null;
  updatedAt: string;
  createdAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  preference: "Preference",
  fact: "Fact",
  instruction: "Instruction",
  style: "Style",
  client_insight: "Client Insight",
};

const CATEGORY_COLORS: Record<string, string> = {
  preference: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  fact: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  instruction: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  style: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  client_insight: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
};

export default function MemoryManager({
  workspaceId,
  open,
  onClose,
}: MemoryManagerProps) {
  const [tab, setTab] = useState<"memories" | "threads">("memories");
  const [memories, setMemories] = useState<AIMemory[]>([]);
  const [summaries, setSummaries] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [summariesLoading, setSummariesLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "private" | "team">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<ThreadSummary | null>(null);

  const fetchMemories = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/memories?workspaceId=${workspaceId}`);
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
      }
    } catch (err) {
      console.error("Failed to fetch memories:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const fetchSummaries = useCallback(async () => {
    if (!workspaceId) return;
    setSummariesLoading(true);
    try {
      const res = await fetch(`/api/ai/summaries?workspaceId=${workspaceId}`);
      if (res.ok) {
        const data = await res.json();
        setSummaries(data.summaries || []);
      }
    } catch (err) {
      console.error("Failed to fetch summaries:", err);
    } finally {
      setSummariesLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (open) {
      fetchMemories();
      fetchSummaries();
    }
  }, [open, fetchMemories, fetchSummaries]);

  // Client-side decayed strength (mirrors server-side computeDecayedStrength)
  const getDecayedStrength = (mem: AIMemory): number => {
    const daysSinceAccess = (Date.now() - new Date(mem.lastAccessedAt || mem.createdAt).getTime()) / 86_400_000;
    let halfLife = 14;
    if (mem.source === "explicit") halfLife = 60;
    else if (mem.source === "meeting") halfLife = 45;
    else if (["instruction", "style"].includes(mem.category)) halfLife = 45;
    else if (mem.category === "fact") halfLife = 30;
    const adjusted = halfLife + (mem.reinforcedCount || 0) * 3;
    const decayed = (mem.strength ?? 1.0) * Math.pow(2, -daysSinceAccess / adjusted);
    return Math.max(0.05, decayed);
  };

  const filtered = memories.filter((m) => {
    if (filter === "private") return m.scope === "private";
    if (filter === "team") return m.scope === "team";
    return true;
  });

  // Sort by decayed strength (strongest first), then group by category
  const sorted = [...filtered].sort((a, b) => getDecayedStrength(b) - getDecayedStrength(a));
  const grouped: Record<string, AIMemory[]> = {};
  for (const m of sorted) {
    const cat = m.category || "fact";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(m);
  }

  const handleEdit = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/memories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (res.ok) {
        setMemories((prev) =>
          prev.map((m) => (m.id === id ? { ...m, content: editContent } : m))
        );
        toast.success("Memory updated");
      }
    } catch {
      toast.error("Failed to update");
    }
    setEditingId(null);
  };

  const handleArchive = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/memories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      if (res.ok) {
        setMemories((prev) => prev.filter((m) => m.id !== id));
        toast.success("Memory archived");
      }
    } catch {
      toast.error("Failed to archive");
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/ai/memories/${deleteId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMemories((prev) => prev.filter((m) => m.id !== deleteId));
        toast.success("Memory deleted");
      }
    } catch {
      toast.error("Failed to delete");
    }
    setDeleteId(null);
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  };

  const strengthDot = (strength: number) => {
    if (strength >= 0.7) return "bg-emerald-500";
    if (strength >= 0.35) return "bg-amber-400";
    return "bg-zinc-400";
  };

  const strengthLabel = (strength: number) => {
    if (strength >= 0.7) return "Established";
    if (strength >= 0.35) return "Developing";
    return "Fading";
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="right" className="w-[360px] sm:w-[420px] p-0 flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-3 border-b shrink-0">
            <div className="flex items-center justify-between">
              <SheetTitle className="flex items-center gap-2 text-base">
                <Brain className="h-4 w-4" />
                Memory
              </SheetTitle>
              {tab === "memories" && (
                <span className="text-xs text-muted-foreground">
                  {memories.length} / 50
                </span>
              )}
              {tab === "threads" && (
                <span className="text-xs text-muted-foreground">
                  {summaries.length} threads
                </span>
              )}
            </div>
            {/* Tab switcher */}
            <div className="flex gap-1 mt-2">
              <button
                onClick={() => setTab("memories")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  tab === "memories"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                Memories
              </button>
              <button
                onClick={() => setTab("threads")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  tab === "threads"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                Threads
              </button>
            </div>
            {/* Filter tabs — only show on memories tab */}
            {tab === "memories" && (
              <div className="flex gap-1 mt-1.5">
                {(["all", "private", "team"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      filter === f
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground/60 hover:text-muted-foreground"
                    }`}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {/* ── Memories tab ── */}
            {tab === "memories" && (
              <>
                {loading ? (
                  <div className="flex justify-center py-12">
                    <div className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-center py-12 px-4">
                    <Brain className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      {filter === "all"
                        ? "No memories yet. They'll appear here as the AI learns from your conversations."
                        : `No ${filter} memories.`}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {Object.entries(grouped).map(([category, items]) => (
                      <div key={category}>
                        <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                          {CATEGORY_LABELS[category] || category}
                        </h3>
                        <div className="space-y-1.5">
                          {items.map((mem) => (
                            <div
                              key={mem.id}
                              className="group rounded-lg border px-3 py-2.5 hover:border-primary/20 transition-colors"
                            >
                              {editingId === mem.id ? (
                                <div className="space-y-2">
                                  <textarea
                                    value={editContent}
                                    onChange={(e) => setEditContent(e.target.value)}
                                    className="w-full text-sm bg-transparent border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                                    rows={3}
                                    autoFocus
                                  />
                                  <div className="flex gap-1.5 justify-end">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0"
                                      onClick={() => setEditingId(null)}
                                    >
                                      <X className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      className="h-6 w-6 p-0"
                                      onClick={() => handleEdit(mem.id)}
                                    >
                                      <Check className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <p className="text-sm leading-relaxed">
                                    {mem.content}
                                  </p>
                                  <div className="flex items-center justify-between mt-1.5">
                                    <div className="flex items-center gap-1.5">
                                      {/* Strength indicator */}
                                      <span className="flex items-center gap-1" title={strengthLabel(getDecayedStrength(mem))}>
                                        <span
                                          className={`h-2 w-2 rounded-full shrink-0 ${strengthDot(getDecayedStrength(mem))}`}
                                        />
                                        <span className={`text-[9px] font-medium tabular-nums ${
                                          getDecayedStrength(mem) >= 0.7 ? "text-emerald-600 dark:text-emerald-400" :
                                          getDecayedStrength(mem) >= 0.35 ? "text-amber-600 dark:text-amber-400" :
                                          "text-muted-foreground/60"
                                        }`}>
                                          {Math.round(getDecayedStrength(mem) * 100)}%
                                        </span>
                                      </span>
                                      <Badge
                                        variant="outline"
                                        className={`text-[9px] px-1.5 py-0 h-4 ${
                                          CATEGORY_COLORS[mem.category] || ""
                                        }`}
                                      >
                                        {mem.scope === "team" ? "Team" : "Private"}
                                      </Badge>
                                      {/* Reinforcement badge */}
                                      {(mem.reinforcedCount || 0) >= 2 && (
                                        <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-medium">
                                          x{mem.reinforcedCount}
                                        </span>
                                      )}
                                      {/* Source & last update */}
                                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                                        <span className="inline-flex items-center gap-0.5">
                                          {mem.source === "explicit" ? (
                                            <User className="h-2.5 w-2.5" />
                                          ) : mem.source === "meeting" ? (
                                            <CalendarDays className="h-2.5 w-2.5" />
                                          ) : (
                                            <Sparkles className="h-2.5 w-2.5" />
                                          )}
                                          {mem.source === "explicit" ? "You" : mem.source === "meeting" ? "Meeting" : "AI"}
                                        </span>
                                        <span>·</span>
                                        <span>{mem.updatedAt !== mem.createdAt ? `updated ${timeAgo(mem.updatedAt)}` : timeAgo(mem.createdAt)}</span>
                                      </span>
                                    </div>
                                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button
                                        onClick={() => {
                                          setEditingId(mem.id);
                                          setEditContent(mem.content);
                                        }}
                                        className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                        title="Edit"
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </button>
                                      <button
                                        onClick={() => handleArchive(mem.id)}
                                        className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                        title="Archive"
                                      >
                                        <Archive className="h-3 w-3" />
                                      </button>
                                      <button
                                        onClick={() => setDeleteId(mem.id)}
                                        className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted text-destructive/60 hover:text-destructive transition-colors"
                                        title="Delete"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── Thread Summaries tab ── */}
            {tab === "threads" && (
              <>
                {summariesLoading ? (
                  <div className="flex justify-center py-12">
                    <div className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  </div>
                ) : summaries.length === 0 ? (
                  <div className="text-center py-12 px-4">
                    <MessageSquare className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      No thread summaries yet. Summaries are generated after 5 exchanges in a conversation.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {summaries.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setSelectedSummary(s)}
                        className="w-full text-left group rounded-lg border px-3 py-2.5 hover:border-primary/20 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {s.title}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                              {s.summary}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5 group-hover:text-muted-foreground transition-colors" />
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                            <MessageSquare className="h-2.5 w-2.5" />
                            {s.messageCount} msgs
                          </span>
                          <span className="text-[10px] text-muted-foreground/50">
                            {timeAgo(s.updatedAt)}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete memory?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this memory. The AI will no longer
              reference it in future conversations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Thread Summary detail modal */}
      <Dialog open={!!selectedSummary} onOpenChange={(v) => !v && setSelectedSummary(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base pr-6">
              {selectedSummary?.title}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {selectedSummary?.messageCount} messages
              </span>
              <span>·</span>
              <span>Updated {selectedSummary ? timeAgo(selectedSummary.updatedAt) : ""}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {selectedSummary?.summary}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
