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
  ChevronUp,
  CalendarDays,
  User,
  StickyNote,
  GripVertical,
  Sparkles,
  RotateCcw,
  ClipboardCopy,
  X,
  FileText,
  Check,
  Search,
  Palette,
  ShieldCheck,
  Bot,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  BookOpen,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import { cn } from "@/lib/utils";
import PromoDraftsSection from "@/components/content/PromoDraftsSection";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const taskStatuses = ["todo", "done"];

const statusMeta: Record<string, { icon: any; color: string; label: string }> = {
  todo: { icon: Circle, color: "text-gray-300 dark:text-gray-600", label: "To Do" },
  done: { icon: CheckCircle2, color: "text-green-500", label: "Done" },
};

// ── Sortable task row component ──
function SortableTaskRow({
  task,
  isExpanded,
  onToggleExpand,
  onCycleStatus,
  onUpdateTask,
  onDeleteTask,
  customerMembers,
}: {
  task: any;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onCycleStatus: () => void;
  onUpdateTask: (taskId: string, updates: any) => void;
  onDeleteTask: (taskId: string) => void;
  customerMembers: any[];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const meta = statusMeta[task.status] || statusMeta.todo;
  const Icon = meta.icon;
  const hasDueDate = !!task.dueDate;
  const hasNotes = !!task.notes;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-lg border transition-all",
        isDragging ? "opacity-50 border-blue-500/40 bg-blue-500/5 z-50" : "",
        isExpanded ? "border-border bg-muted/30" : "border-transparent"
      )}
    >
      <div className="group flex items-center gap-2 py-2 px-2 rounded-lg transition-colors cursor-pointer">
        <button
          {...attributes}
          {...listeners}
          className="shrink-0 text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none"
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onCycleStatus(); }}
          className={cn("shrink-0 transition-all hover:scale-110", meta.color)}
          title={`${meta.label} — click to toggle`}
        >
          <Icon className={cn("h-4.5 w-4.5", task.status === "done" && "fill-green-500/20")} />
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-1.5" onClick={onToggleExpand}>
          <span className={cn("text-sm flex-1 truncate", task.status === "done" ? "line-through text-muted-foreground/60" : "font-medium")}>
            {task.title}
          </span>
          <div className="hidden md:flex items-center gap-1 shrink-0">
            {task.assignedToName && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5" title={task.assignedToName}>
                <User className="h-3 w-3" />
              </span>
            )}
            {hasDueDate && (
              <span className={cn("text-[10px] flex items-center gap-0.5", new Date(task.dueDate) < new Date() && task.status !== "done" ? "text-red-500" : "text-muted-foreground")}>
                <CalendarDays className="h-3 w-3" />
              </span>
            )}
            {hasNotes && <span title="Has notes"><StickyNote className="h-3 w-3 text-amber-400" /></span>}
          </div>
        </div>
        <button onClick={onToggleExpand} className="shrink-0 text-muted-foreground/40 hover:text-foreground transition-colors p-0.5">
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-180")} />
        </button>
        <button onClick={() => onDeleteTask(task.id)} className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-red-500 transition-all p-0.5">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 space-y-3">
          <Separator />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Status</label>
              <select
                value={task.status}
                onChange={(e) => onUpdateTask(task.id, { status: e.target.value })}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm h-8"
              >
                {taskStatuses.map((s) => (
                  <option key={s} value={s}>{statusMeta[s]?.label || s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Deadline</label>
              <Input
                type="date"
                value={task.dueDate ? new Date(task.dueDate).toISOString().split("T")[0] : ""}
                onChange={(e) => onUpdateTask(task.id, { dueDate: e.target.value || null })}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Assigned To</label>
              <select
                value={task.assignedTo || ""}
                onChange={(e) => {
                  const userId = e.target.value || null;
                  onUpdateTask(task.id, { assignedTo: userId });
                }}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm h-8"
              >
                <option value="">Unassigned</option>
                {customerMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.userName || m.userEmail}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {task.status === "done" && task.completedAt && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground bg-green-500/5 rounded-md px-3 py-2">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                Completed {new Date(task.completedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </div>
          )}
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Notes</label>
            <textarea
              value={task.notes || ""}
              onChange={(e) => onUpdateTask(task.id, { notes: e.target.value })}
              placeholder="Add notes about this task..."
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ──
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

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [customerMembers, setCustomerMembers] = useState<any[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<any[]>([]);
  const [addTaskOpen, setAddTaskOpen] = useState(false);

  // Active tab
  const [activeTab, setActiveTab] = useState("brief");

  // AI Writer state
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiPreview, setAiPreview] = useState("");
  const [aiTone, setAiTone] = useState("professional");
  const [aiLength, setAiLength] = useState("standard");
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiCopied, setAiCopied] = useState(false);

  // Google Docs API
  const [canInsertToDoc, setCanInsertToDoc] = useState<boolean | null>(null);
  const [aiInserting, setAiInserting] = useState(false);

  // AI Writer — Research
  const [researchData, setResearchData] = useState<any>(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [selectedResearch, setSelectedResearch] = useState<Set<string>>(new Set());

  // AI Writer — Themes
  const [themesData, setThemesData] = useState<any[]>([]);
  const [themesLoading, setThemesLoading] = useState(false);
  const [selectedThemes, setSelectedThemes] = useState<Set<string>>(new Set());

  // AI Writer — Example content
  const [exampleContent, setExampleContent] = useState("");

  // AI Writer — Content Tools
  const [factCheckResult, setFactCheckResult] = useState<any>(null);
  const [factCheckLoading, setFactCheckLoading] = useState(false);
  const [aiDetectResult, setAiDetectResult] = useState<any>(null);
  const [aiDetectLoading, setAiDetectLoading] = useState(false);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

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

  useEffect(() => { fetchContent(); }, [fetchContent]);

  useEffect(() => {
    if (!obj?.customerId) return;
    fetch(`/api/customer-members?customerId=${obj.customerId}`)
      .then((r) => r.json())
      .then((d) => setCustomerMembers(d.members || []))
      .catch(() => {});
  }, [obj?.customerId]);

  // Fetch task templates for this content type
  useEffect(() => {
    if (!obj?.contentType) return;
    fetch(`/api/task-templates?contentType=${encodeURIComponent(obj.contentType)}`)
      .then((r) => r.json())
      .then((d) => setTaskTemplates(d.templates || []))
      .catch(() => {});
  }, [obj?.contentType]);

  useEffect(() => {
    if (!obj?.body) { setCanInsertToDoc(false); return; }
    fetch(`/api/google-docs/insert?documentId=${encodeURIComponent(obj.body)}`)
      .then((r) => r.json())
      .then((d) => setCanInsertToDoc(d.canInsert === true))
      .catch(() => setCanInsertToDoc(false));
  }, [obj?.body]);

  const saveField = async (updates: any) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/content-objects/${contentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.contentObject) setObj((prev: any) => ({ ...prev, ...data.contentObject }));
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const addTask = async (title: string) => {
    if (!title.trim()) return;
    const maxSort = tasks.length > 0 ? Math.max(...tasks.map((t) => t.sortOrder || 0)) : -1;
    try {
      const res = await fetch("/api/production-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentObjectId: contentId, title: title.trim(), priority: "medium", sortOrder: maxSort + 1, workspaceId: obj?.workspaceId }),
      });
      const data = await res.json();
      if (data.task) { setTasks((prev) => [...prev, data.task]); setAddTaskOpen(false); }
    } catch (err) { console.error("Add task failed:", err); }
  };

  // Templates that can be manually added and aren't already in the task list
  const existingTaskTitles = new Set(tasks.map((t) => t.title?.toLowerCase()));
  const availableTemplates = taskTemplates
    .filter((t) => t.canManuallyAdd)
    .filter((t) => !existingTaskTitles.has(t.title?.toLowerCase()));

  const cycleTaskStatus = (task: any) => {
    updateTask(task.id, { status: task.status === "done" ? "todo" : "done" });
  };

  const updateTask = async (taskId: string, updates: any) => {
    try {
      const res = await fetch(`/api/production-tasks/${taskId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
      const data = await res.json();
      if (data.task) setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...data.task } : t)));
    } catch (err) { console.error("Update task failed:", err); }
  };

  const deleteTask = async (taskId: string) => {
    try {
      await fetch(`/api/production-tasks/${taskId}`, { method: "DELETE" });
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      if (expandedTaskId === taskId) setExpandedTaskId(null);
    } catch (err) { console.error("Delete task failed:", err); }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortedTasks.findIndex((t) => t.id === active.id);
    const newIndex = sortedTasks.findIndex((t) => t.id === over.id);
    const reordered = arrayMove(sortedTasks, oldIndex, newIndex);
    setTasks(reordered.map((t, i) => ({ ...t, sortOrder: i })));
    try {
      await fetch("/api/production-tasks/reorder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderedIds: reordered.map((t) => t.id) }) });
    } catch (err) { console.error("Reorder failed:", err); }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this content object and all its tasks?")) return;
    try { await fetch(`/api/content-objects/${contentId}`, { method: "DELETE" }); router.push("/content"); } catch (err) { console.error("Delete failed:", err); }
  };

  // ── AI: Research topics ──
  const runResearch = async () => {
    setResearchLoading(true);
    setAiError("");
    try {
      const res = await fetch("/api/ai", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "research-topics", title: obj.workingTitle, brief: obj.brief, contentType: obj.contentType, topicTags: obj.topicTags }),
      });
      if (!res.ok) { setAiError("Research failed"); return; }
      const data = await res.json();
      if (data.error) { setAiError(data.error); return; }
      setResearchData(data);
      // Auto-select all items
      const ids = new Set<string>();
      (data.themes || []).forEach((t: any) => ids.add(t.id));
      (data.talkingPoints || []).forEach((t: any) => ids.add(t.id));
      (data.dataPoints || []).forEach((t: any) => ids.add(t.id));
      (data.angles || []).forEach((t: any) => ids.add(t.id));
      setSelectedResearch(ids);
    } catch (err: any) { setAiError(err.message || "Research failed"); }
    finally { setResearchLoading(false); }
  };

  // ── AI: Suggest themes ──
  const runSuggestThemes = async () => {
    setThemesLoading(true);
    setAiError("");
    try {
      const selectedItems = researchData ? {
        themes: (researchData.themes || []).filter((t: any) => selectedResearch.has(t.id)),
        talkingPoints: (researchData.talkingPoints || []).filter((t: any) => selectedResearch.has(t.id)),
        dataPoints: (researchData.dataPoints || []).filter((t: any) => selectedResearch.has(t.id)),
        angles: (researchData.angles || []).filter((t: any) => selectedResearch.has(t.id)),
      } : null;
      const res = await fetch("/api/ai", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest-themes", title: obj.workingTitle, brief: obj.brief, contentType: obj.contentType, research: selectedItems }),
      });
      if (!res.ok) { setAiError("Theme suggestion failed"); return; }
      const data = await res.json();
      if (data.error) { setAiError(data.error); return; }
      setThemesData(data.themes || []);
    } catch (err: any) { setAiError(err.message || "Theme suggestion failed"); }
    finally { setThemesLoading(false); }
  };

  // ── AI: Generate content (enhanced) ──
  const generateWithAI = async () => {
    setAiGenerating(true);
    setAiPreview("");
    setAiError("");
    setFactCheckResult(null);
    setAiDetectResult(null);
    try {
      let customPrompt = "";
      let contentTypeName = obj.contentType;
      let documentTemplates: any[] = [];
      try {
        const typesRes = await fetch("/api/content-types");
        const typesData = await typesRes.json();
        const typeConfig = (typesData.contentTypes || []).find((t: any) => t.key === obj.contentType);
        if (typeConfig) { customPrompt = typeConfig.aiPrompt || ""; contentTypeName = typeConfig.name || obj.contentType; documentTemplates = typeConfig.documentTemplates || []; }
      } catch {}

      // Build enriched instructions from research + themes + examples
      let enrichedInstructions = aiInstructions || "";
      if (selectedResearch.size > 0 && researchData) {
        const selTP = (researchData.talkingPoints || []).filter((t: any) => selectedResearch.has(t.id));
        const selDP = (researchData.dataPoints || []).filter((t: any) => selectedResearch.has(t.id));
        const selAngles = (researchData.angles || []).filter((t: any) => selectedResearch.has(t.id));
        if (selTP.length > 0) enrichedInstructions += `\n\nKey talking points to cover:\n${selTP.map((t: any) => `- ${t.point}`).join("\n")}`;
        if (selDP.length > 0) enrichedInstructions += `\n\nData points to reference (verify before using):\n${selDP.map((t: any) => `- ${t.stat}`).join("\n")}`;
        if (selAngles.length > 0) enrichedInstructions += `\n\nEditorial angles to consider:\n${selAngles.map((t: any) => `- ${t.name}: ${t.description}`).join("\n")}`;
      }
      if (selectedThemes.size > 0 && themesData.length > 0) {
        const selThemes = themesData.filter((t: any) => selectedThemes.has(t.id));
        enrichedInstructions += `\n\nSelected editorial themes/approach:\n${selThemes.map((t: any) => `- ${t.name}: ${t.approach}`).join("\n")}`;
      }
      if (exampleContent.trim()) {
        enrichedInstructions += `\n\nExample content to emulate the style of (match tone, structure, and voice):\n---\n${exampleContent.trim()}\n---`;
      }

      const res = await fetch("/api/ai", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate-content", contentType: obj.contentType, contentTypeName,
          title: obj.workingTitle, brief: obj.brief, topicTags: obj.topicTags,
          customerName: obj.customerName, ideaTitle: idea?.title, customPrompt,
          tone: aiTone, length: aiLength, additionalInstructions: enrichedInstructions, documentTemplates,
        }),
      });
      if (!res.ok) {
        const errorText = await res.text();
        try { setAiError(JSON.parse(errorText).error || `Server error (${res.status})`); } catch { setAiError(`Server error (${res.status})`); }
        return;
      }
      const data = await res.json();
      if (data.error) setAiError(data.error);
      else setAiPreview(data.content || "");
    } catch (err: any) { setAiError(err.message || "Generation failed"); }
    finally { setAiGenerating(false); }
  };

  const copyAiContent = async () => {
    try {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = aiPreview;
      const plainText = tempDiv.textContent || tempDiv.innerText || "";
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": new Blob([aiPreview], { type: "text/html" }), "text/plain": new Blob([plainText], { type: "text/plain" }) }),
      ]);
      setAiCopied(true); setTimeout(() => setAiCopied(false), 2000);
    } catch {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = aiPreview;
      await navigator.clipboard.writeText(tempDiv.textContent || "");
      setAiCopied(true); setTimeout(() => setAiCopied(false), 2000);
    }
  };

  const insertIntoDoc = async (mode: "append" | "replace") => {
    if (!obj?.body || !aiPreview) return;
    setAiInserting(true); setAiError("");
    try {
      const res = await fetch("/api/google-docs/insert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: obj.body, content: aiPreview, mode }) });
      const data = await res.json();
      if (!res.ok || data.error) { setAiError(data.error || `Failed to ${mode} content`); if (data.canInsert === false) setCanInsertToDoc(false); }
      else { setAiCopied(true); setTimeout(() => setAiCopied(false), 2000); }
    } catch (err: any) { setAiError(err.message || "Failed to insert into Google Doc"); }
    finally { setAiInserting(false); }
  };

  // ── AI: Fact Check ──
  const runFactCheck = async () => {
    if (!aiPreview) return;
    setFactCheckLoading(true); setFactCheckResult(null);
    try {
      const res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "fact-check", content: aiPreview }) });
      const data = await res.json();
      if (data.error) setAiError(data.error);
      else setFactCheckResult(data);
    } catch (err: any) { setAiError(err.message); }
    finally { setFactCheckLoading(false); }
  };

  // ── AI: Detect AI ──
  const runAiDetect = async () => {
    if (!aiPreview) return;
    setAiDetectLoading(true); setAiDetectResult(null);
    try {
      const res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "detect-ai", content: aiPreview }) });
      const data = await res.json();
      if (data.error) setAiError(data.error);
      else setAiDetectResult(data);
    } catch (err: any) { setAiError(err.message); }
    finally { setAiDetectLoading(false); }
  };

  const toggleResearchItem = (id: string) => {
    setSelectedResearch((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleTheme = (id: string) => {
    setSelectedThemes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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

  const factStatusIcon = (status: string) => {
    if (status === "verified") return <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />;
    if (status === "likely_accurate") return <CheckCircle className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
    if (status === "potentially_inaccurate") return <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
    if (status === "needs_source") return <HelpCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    return <HelpCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  };

  return (
    <div className="max-w-[1600px]">
      {/* ── Header ── */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1.5 h-7 px-2 text-muted-foreground hover:text-foreground text-xs">
            <ArrowLeft className="h-3 w-3" /> Back
          </Button>
          {idea && (
            <>
              <span className="text-muted-foreground/30">/</span>
              <Link href={`/ideas/${idea.id}`} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                <Lightbulb className="h-3 w-3" />
                {idea.title?.length > 40 ? idea.title.substring(0, 40) + "..." : idea.title}
              </Link>
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  if (titleDraft.trim() && titleDraft !== (obj.finalTitle || obj.workingTitle)) saveField(obj.finalTitle ? { finalTitle: titleDraft.trim() } : { workingTitle: titleDraft.trim() });
                  setEditingTitle(false);
                }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingTitle(false); }}
                className="text-xl font-semibold tracking-tight w-full bg-transparent border-0 border-b-2 border-foreground/20 focus:border-foreground/40 outline-none pb-0.5"
              />
            ) : (
              <h1
                className="text-xl font-semibold tracking-tight truncate cursor-pointer hover:text-foreground/80 transition-colors"
                onClick={() => { setTitleDraft(obj.finalTitle || obj.workingTitle); setEditingTitle(true); }}
                title="Click to edit title"
              >
                {obj.finalTitle || obj.workingTitle}
              </h1>
            )}
            <Badge variant="secondary" className="border-0 text-[10px] capitalize bg-muted shrink-0">{obj.contentType}</Badge>
            {obj.evergreenFlag && (
              <Badge variant="secondary" className="border-0 text-[10px] bg-green-500/10 text-green-600 gap-1 shrink-0">
                <Leaf className="h-2.5 w-2.5" /> Evergreen
              </Badge>
            )}
            {saving && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
                <Loader2 className="h-3 w-3 animate-spin" /> Saving...
              </span>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={handleDelete} className="text-muted-foreground hover:text-red-500 h-7 w-7 p-0 shrink-0">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Tabs + Two-column layout ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="brief" className="gap-1.5 text-xs">
            <BookOpen className="h-3.5 w-3.5" /> Brief
          </TabsTrigger>
          <TabsTrigger value="content" className="gap-1.5 text-xs">
            <FileText className="h-3.5 w-3.5" /> Content
          </TabsTrigger>
          <TabsTrigger value="ai-writer" className="gap-1.5 text-xs">
            <Sparkles className="h-3.5 w-3.5" /> AI Writer
          </TabsTrigger>
        </TabsList>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">

          {/* ═══ LEFT: Tab Content ═══ */}
          <div className="min-w-0">

            {/* ── TAB 1: Brief ── */}
            <TabsContent value="brief" className="mt-0">
              <Card className="border-0 shadow-sm">
                <CardHeader className="px-5 pt-5 pb-0">
                  <CardTitle className="text-sm font-semibold">Content Brief</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Define the scope, audience, and guidelines for this content piece.</p>
                </CardHeader>
                <CardContent className="px-5 pb-5 pt-4 space-y-5">
                  {/* Brief */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Brief</label>
                    <textarea
                      value={obj.brief || ""}
                      onChange={(e) => setObj({ ...obj, brief: e.target.value })}
                      onBlur={() => saveField({ brief: obj.brief || "" })}
                      placeholder="Describe what this content should cover, key messages, and objectives..."
                      rows={4}
                      className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  {/* Guidelines */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Client Guidelines</label>
                    <textarea
                      value={obj.guidelines || ""}
                      onChange={(e) => setObj({ ...obj, guidelines: e.target.value })}
                      onBlur={() => saveField({ guidelines: obj.guidelines || "" })}
                      placeholder="Brand voice, style guide rules, things to avoid, required terminology..."
                      rows={3}
                      className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  {/* Grid: Audience / Length / Platform */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Target Audience</label>
                      <Input
                        value={obj.audience || ""}
                        onChange={(e) => setObj({ ...obj, audience: e.target.value })}
                        onBlur={() => saveField({ audience: obj.audience || "" })}
                        placeholder="e.g. Marketing managers, 25-45"
                        className="h-9 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Target Length</label>
                      <Input
                        value={obj.targetLength || ""}
                        onChange={(e) => setObj({ ...obj, targetLength: e.target.value })}
                        onBlur={() => saveField({ targetLength: obj.targetLength || "" })}
                        placeholder="e.g. 1500 words, 5 min read"
                        className="h-9 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Platform</label>
                      <Input
                        value={obj.platform || ""}
                        onChange={(e) => setObj({ ...obj, platform: e.target.value })}
                        onBlur={() => saveField({ platform: obj.platform || "" })}
                        placeholder="e.g. Blog, LinkedIn, Medium"
                        className="h-9 text-sm"
                      />
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Notes</label>
                    <textarea
                      value={obj.notes || ""}
                      onChange={(e) => setObj({ ...obj, notes: e.target.value })}
                      onBlur={() => saveField({ notes: obj.notes || "" })}
                      placeholder="Any additional context, references, or internal notes..."
                      rows={3}
                      className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── TAB 2: Content ── */}
            <TabsContent value="content" className="mt-0">
              <Card className="border-0 shadow-sm overflow-hidden">
                {obj.body ? (
                  <>
                    <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <FileText className="h-3.5 w-3.5 text-blue-500" />
                        <span className="font-medium">Document</span>
                      </div>
                      <a
                        href={`https://docs.google.com/document/d/${obj.body}/edit`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Open in Google Docs <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <CardContent className="p-0">
                      <iframe
                        src={`https://docs.google.com/document/d/${obj.body}/edit?rm=minimal`}
                        className="w-full border-0"
                        style={{ height: "calc(100vh - 200px)", minHeight: "500px" }}
                        allow="clipboard-write clipboard-read"
                        title="Google Doc Editor"
                      />
                    </CardContent>
                  </>
                ) : (
                  <CardContent className="flex flex-col items-center justify-center py-24 text-center">
                    <FileText className="h-10 w-10 text-muted-foreground/20 mb-3" />
                    <p className="text-sm font-medium mb-1">No document linked</p>
                    <p className="text-xs text-muted-foreground max-w-[260px]">
                      This content item doesn&apos;t have a Google Doc associated with it yet.
                    </p>
                  </CardContent>
                )}
              </Card>
            </TabsContent>

            {/* ── TAB 3: AI Writer ── */}
            <TabsContent value="ai-writer" className="mt-0 space-y-4">

              {/* A. Research */}
              <Card className="border-0 shadow-sm">
                <CardHeader className="px-5 pt-4 pb-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Search className="h-4 w-4 text-blue-500" />
                      <CardTitle className="text-sm font-semibold">Research</CardTitle>
                    </div>
                    <Button size="sm" variant="outline" onClick={runResearch} disabled={researchLoading} className="gap-1.5 h-7 text-xs">
                      {researchLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                      {researchLoading ? "Researching..." : researchData ? "Re-research" : "Research Topic"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">AI-powered research to find talking points, data, and angles for your content.</p>
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-3">
                  {!researchData && !researchLoading && (
                    <div className="text-center py-6 text-xs text-muted-foreground">
                      Click &ldquo;Research Topic&rdquo; to generate talking points, data, and angles based on your title and brief.
                    </div>
                  )}
                  {researchLoading && (
                    <div className="flex items-center justify-center py-8 gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                      <span className="text-sm text-muted-foreground">Researching your topic...</span>
                    </div>
                  )}
                  {researchData && !researchLoading && (
                    <div className="space-y-4">
                      {/* Talking Points */}
                      {(researchData.talkingPoints || []).length > 0 && (
                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-2">Talking Points</label>
                          <div className="space-y-1.5">
                            {researchData.talkingPoints.map((tp: any) => (
                              <button key={tp.id} onClick={() => toggleResearchItem(tp.id)}
                                className={cn("w-full text-left rounded-lg border px-3 py-2 text-xs transition-all", selectedResearch.has(tp.id) ? "border-blue-500/40 bg-blue-500/5" : "border-transparent bg-muted/30 hover:bg-muted/50")}>
                                <div className="flex items-start gap-2">
                                  <div className={cn("mt-0.5 h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 transition-colors", selectedResearch.has(tp.id) ? "bg-blue-500 border-blue-500" : "border-muted-foreground/30")}>
                                    {selectedResearch.has(tp.id) && <Check className="h-2.5 w-2.5 text-white" />}
                                  </div>
                                  <div><p className="font-medium">{tp.point}</p><p className="text-muted-foreground mt-0.5">{tp.why}</p></div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Data Points */}
                      {(researchData.dataPoints || []).length > 0 && (
                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-2">Data Points</label>
                          <div className="space-y-1.5">
                            {researchData.dataPoints.map((dp: any) => (
                              <button key={dp.id} onClick={() => toggleResearchItem(dp.id)}
                                className={cn("w-full text-left rounded-lg border px-3 py-2 text-xs transition-all", selectedResearch.has(dp.id) ? "border-blue-500/40 bg-blue-500/5" : "border-transparent bg-muted/30 hover:bg-muted/50")}>
                                <div className="flex items-start gap-2">
                                  <div className={cn("mt-0.5 h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 transition-colors", selectedResearch.has(dp.id) ? "bg-blue-500 border-blue-500" : "border-muted-foreground/30")}>
                                    {selectedResearch.has(dp.id) && <Check className="h-2.5 w-2.5 text-white" />}
                                  </div>
                                  <div><p className="font-medium">{dp.stat}</p><p className="text-muted-foreground mt-0.5">{dp.context}</p></div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Angles */}
                      {(researchData.angles || []).length > 0 && (
                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-2">Angles</label>
                          <div className="flex flex-wrap gap-2">
                            {researchData.angles.map((a: any) => (
                              <button key={a.id} onClick={() => toggleResearchItem(a.id)}
                                className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-all", selectedResearch.has(a.id) ? "border-blue-500 bg-blue-500/10 text-blue-600" : "border-border hover:bg-muted")}>
                                {a.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* B. Themes */}
              <Card className="border-0 shadow-sm">
                <CardHeader className="px-5 pt-4 pb-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Palette className="h-4 w-4 text-violet-500" />
                      <CardTitle className="text-sm font-semibold">Themes & Angles</CardTitle>
                    </div>
                    <Button size="sm" variant="outline" onClick={runSuggestThemes} disabled={themesLoading} className="gap-1.5 h-7 text-xs">
                      {themesLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Palette className="h-3 w-3" />}
                      {themesLoading ? "Generating..." : themesData.length > 0 ? "Regenerate" : "Suggest Themes"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Choose an editorial approach for your content.</p>
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-3">
                  {themesData.length === 0 && !themesLoading && (
                    <div className="text-center py-4 text-xs text-muted-foreground">
                      Click &ldquo;Suggest Themes&rdquo; to generate editorial approaches. Research first for better results.
                    </div>
                  )}
                  {themesLoading && (
                    <div className="flex items-center justify-center py-6 gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                      <span className="text-sm text-muted-foreground">Generating themes...</span>
                    </div>
                  )}
                  {themesData.length > 0 && !themesLoading && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {themesData.map((theme: any) => (
                        <button key={theme.id} onClick={() => toggleTheme(theme.id)}
                          className={cn("text-left rounded-lg border p-3 transition-all", selectedThemes.has(theme.id) ? "border-violet-500/40 bg-violet-500/5 ring-1 ring-violet-500/20" : "border-border hover:bg-muted/50")}>
                          <div className="flex items-start gap-2">
                            <div className={cn("mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors", selectedThemes.has(theme.id) ? "border-violet-500 bg-violet-500" : "border-muted-foreground/30")}>
                              {selectedThemes.has(theme.id) && <Check className="h-2.5 w-2.5 text-white" />}
                            </div>
                            <div>
                              <p className="text-xs font-semibold">{theme.name}</p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">{theme.description}</p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* C. Example Content */}
              <Card className="border-0 shadow-sm">
                <CardHeader className="px-5 pt-4 pb-0">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-amber-500" />
                    <CardTitle className="text-sm font-semibold">Example Content</CardTitle>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Paste content you&apos;d like the AI to emulate in tone and style.</p>
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-3">
                  <textarea
                    value={exampleContent}
                    onChange={(e) => setExampleContent(e.target.value)}
                    placeholder="Paste an example article, blog post, or writing sample that represents the style you want..."
                    rows={4}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </CardContent>
              </Card>

              {/* D. Tone & Style + Generate */}
              <Card className="border-0 shadow-sm">
                <CardHeader className="px-5 pt-4 pb-0">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    <CardTitle className="text-sm font-semibold">Generate Content</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5 pt-3 space-y-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Tone</label>
                      <select value={aiTone} onChange={(e) => setAiTone(e.target.value)} className="h-8 rounded-md border bg-background px-2.5 text-sm min-w-[140px]">
                        <option value="professional">Professional</option>
                        <option value="casual">Casual</option>
                        <option value="engaging">Engaging</option>
                        <option value="authoritative">Authoritative</option>
                        <option value="conversational">Conversational</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Length</label>
                      <select value={aiLength} onChange={(e) => setAiLength(e.target.value)} className="h-8 rounded-md border bg-background px-2.5 text-sm min-w-[140px]">
                        <option value="brief">Brief (~300 words)</option>
                        <option value="standard">Standard (~600 words)</option>
                        <option value="detailed">Detailed (~1000+ words)</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Additional Instructions</label>
                    <input
                      value={aiInstructions}
                      onChange={(e) => setAiInstructions(e.target.value)}
                      placeholder="e.g. Focus on sustainability angle, include statistics..."
                      className="w-full h-8 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  {/* Context summary */}
                  {(selectedResearch.size > 0 || selectedThemes.size > 0 || exampleContent.trim()) && (
                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                      <span className="text-muted-foreground font-medium">Context:</span>
                      {selectedResearch.size > 0 && <Badge variant="secondary" className="text-[10px]">{selectedResearch.size} research items</Badge>}
                      {selectedThemes.size > 0 && <Badge variant="secondary" className="text-[10px] bg-violet-500/10 text-violet-600">{selectedThemes.size} themes</Badge>}
                      {exampleContent.trim() && <Badge variant="secondary" className="text-[10px] bg-amber-500/10 text-amber-600">Example content</Badge>}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={generateWithAI} disabled={aiGenerating} className="gap-1.5 bg-violet-600 hover:bg-violet-700">
                      {aiGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      {aiGenerating ? "Generating..." : aiPreview ? "Regenerate" : "Generate Draft"}
                    </Button>
                    {!obj.brief && !obj.workingTitle && (
                      <span className="text-xs text-amber-500">Tip: Add a title or brief for better results</span>
                    )}
                  </div>

                  {aiError && (
                    <div className="p-3 rounded-lg bg-red-500/10 text-red-600 text-sm">{aiError}</div>
                  )}

                  {aiGenerating && (
                    <div className="p-6 rounded-lg border border-dashed flex flex-col items-center gap-3">
                      <div className="flex items-center gap-1">
                        <div className="h-2 w-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <div className="h-2 w-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <div className="h-2 w-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                      <p className="text-sm text-muted-foreground">Writing {obj.contentType || "content"} as an expert editor...</p>
                    </div>
                  )}

                  {/* Preview */}
                  {aiPreview && !aiGenerating && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Preview</span>
                        <Separator className="flex-1" />
                      </div>
                      <div
                        className="prose prose-sm dark:prose-invert max-w-none p-4 rounded-lg border bg-muted/20 max-h-[500px] overflow-y-auto"
                        dangerouslySetInnerHTML={{ __html: aiPreview }}
                      />

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {canInsertToDoc && obj.body && (
                          <>
                            <Button size="sm" onClick={() => insertIntoDoc("append")} disabled={aiInserting} className="gap-1.5 bg-blue-600 hover:bg-blue-700">
                              {aiInserting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : aiCopied ? <Check className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                              {aiInserting ? "Inserting..." : aiCopied ? "Inserted!" : "Append to Doc"}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => insertIntoDoc("replace")} disabled={aiInserting} className="gap-1.5">
                              <RotateCcw className="h-3.5 w-3.5" /> Replace Doc
                            </Button>
                          </>
                        )}
                        {!canInsertToDoc && (
                          <Button size="sm" onClick={copyAiContent} className="gap-1.5">
                            {aiCopied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                            {aiCopied ? "Copied!" : "Copy to Clipboard"}
                          </Button>
                        )}
                        {canInsertToDoc && (
                          <Button size="sm" variant="ghost" onClick={copyAiContent} className="gap-1.5 text-muted-foreground">
                            <ClipboardCopy className="h-3.5 w-3.5" /> Copy
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => { setAiPreview(""); setFactCheckResult(null); setAiDetectResult(null); }} className="gap-1.5 text-muted-foreground">
                          <X className="h-3.5 w-3.5" /> Discard
                        </Button>
                      </div>

                      {/* Content Tools */}
                      <Separator />
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Content Tools</span>
                        <Button size="sm" variant="outline" onClick={runFactCheck} disabled={factCheckLoading} className="gap-1.5 h-7 text-xs">
                          {factCheckLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                          Fact Check
                        </Button>
                        <Button size="sm" variant="outline" onClick={runAiDetect} disabled={aiDetectLoading} className="gap-1.5 h-7 text-xs">
                          {aiDetectLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
                          AI Detection
                        </Button>
                      </div>

                      {/* Fact Check Results */}
                      {factCheckResult && (
                        <div className="rounded-lg border p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="h-4 w-4 text-blue-500" />
                              <span className="text-sm font-semibold">Fact Check</span>
                            </div>
                            <Badge variant={factCheckResult.overallScore >= 80 ? "secondary" : "destructive"} className="text-xs">
                              Score: {factCheckResult.overallScore}/100
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{factCheckResult.summary}</p>
                          <div className="space-y-2">
                            {(factCheckResult.claims || []).map((claim: any, i: number) => (
                              <div key={i} className="flex items-start gap-2 text-xs">
                                {factStatusIcon(claim.status)}
                                <div>
                                  <p className="font-medium">{claim.claim}</p>
                                  <p className="text-muted-foreground">{claim.note}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* AI Detection Results */}
                      {aiDetectResult && (
                        <div className="rounded-lg border p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Bot className="h-4 w-4 text-amber-500" />
                              <span className="text-sm font-semibold">AI Detection</span>
                            </div>
                            <Badge variant={aiDetectResult.score <= 30 ? "secondary" : aiDetectResult.score <= 60 ? "outline" : "destructive"} className="text-xs">
                              {aiDetectResult.score <= 30 ? "Likely Human" : aiDetectResult.score <= 60 ? "Mixed" : "Likely AI"} ({aiDetectResult.score}/100)
                            </Badge>
                          </div>
                          {(aiDetectResult.flags || []).length > 0 && (
                            <div>
                              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Flagged Patterns</label>
                              <div className="space-y-1.5">
                                {aiDetectResult.flags.map((flag: any, i: number) => (
                                  <div key={i} className="text-xs rounded bg-amber-500/5 px-3 py-1.5">
                                    <span className="font-medium">&ldquo;{flag.text}&rdquo;</span>
                                    <span className="text-muted-foreground ml-1.5">&mdash; {flag.reason}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {(aiDetectResult.suggestions || []).length > 0 && (
                            <div>
                              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Suggestions</label>
                              <ul className="space-y-1 text-xs text-muted-foreground">
                                {aiDetectResult.suggestions.map((s: string, i: number) => (
                                  <li key={i} className="flex items-start gap-1.5">
                                    <span className="text-violet-500 mt-0.5">&#x2192;</span> {s}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </div>

          {/* ═══ RIGHT: Sidebar (visible on all tabs) ═══ */}
          <div className="space-y-3">

            {/* Production Pipeline */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="px-3 pt-3 pb-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                    Production Pipeline
                    {totalTasks > 0 && (
                      <span className={cn("text-[10px] font-normal", doneCount === totalTasks ? "text-green-600" : "text-muted-foreground")}>
                        {doneCount}/{totalTasks}
                      </span>
                    )}
                  </CardTitle>
                </div>
                {totalTasks > 0 && (
                  <div className="h-1 bg-muted rounded-full mt-2 overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all duration-500", doneCount === totalTasks ? "bg-green-500" : "bg-blue-500")} style={{ width: `${progressPct}%` }} />
                  </div>
                )}
              </CardHeader>
              <CardContent className="px-3 pb-3 pt-2">
                {totalTasks === 0 ? (
                  <div className="text-center py-3">
                    <p className="text-[11px] text-muted-foreground">
                      No production steps yet.{" "}
                      <Link href="/settings/templates" className="underline underline-offset-2 hover:text-foreground">Set up templates</Link>
                    </p>
                  </div>
                ) : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={sortedTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-0.5">
                        {sortedTasks.map((task) => (
                          <SortableTaskRow
                            key={task.id} task={task}
                            isExpanded={expandedTaskId === task.id}
                            onToggleExpand={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                            onCycleStatus={() => cycleTaskStatus(task)}
                            onUpdateTask={updateTask} onDeleteTask={deleteTask} customerMembers={customerMembers}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
                {availableTemplates.length > 0 && (
                  <div className="mt-2 pt-2 border-t">
                    {addTaskOpen ? (
                      <div className="space-y-1">
                        {availableTemplates.map((tpl) => (
                          <button
                            key={tpl.id}
                            onClick={() => addTask(tpl.title)}
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left hover:bg-muted transition-colors group"
                          >
                            <Plus className="h-3 w-3 text-muted-foreground/50 group-hover:text-blue-500 shrink-0" />
                            <span className="flex-1 truncate">{tpl.title}</span>
                            {tpl.contentUnits > 0 && (
                              <span className="text-[9px] text-muted-foreground shrink-0">{tpl.contentUnits}u</span>
                            )}
                          </button>
                        ))}
                        <button
                          onClick={() => setAddTaskOpen(false)}
                          className="w-full text-center text-[10px] text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddTaskOpen(true)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors w-full py-0.5"
                      >
                        <Plus className="h-3.5 w-3.5 shrink-0" />
                        <span>Add step...</span>
                      </button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Details */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="px-3 pt-3 pb-0">
                <CardTitle className="text-xs font-semibold">Details</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 pt-2 space-y-2.5">
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Working Title</label>
                  <Input value={obj.workingTitle} onChange={(e) => setObj({ ...obj, workingTitle: e.target.value })} onBlur={() => saveField({ workingTitle: obj.workingTitle })} className="mt-0.5 h-7 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Final Title</label>
                  <Input value={obj.finalTitle || ""} onChange={(e) => setObj({ ...obj, finalTitle: e.target.value })} onBlur={() => saveField({ finalTitle: obj.finalTitle })} className="mt-0.5 h-7 text-xs" placeholder="Set when ready to publish" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Content Type</label>
                  <select value={obj.contentType} onChange={(e) => saveField({ contentType: e.target.value })} className="mt-0.5 w-full rounded-md border bg-background px-2 py-1 text-xs h-7">
                    {["article", "video", "graphic", "thread", "newsletter", "podcast", "other"].map((t) => (
                      <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <input type="checkbox" id="evergreen" checked={obj.evergreenFlag} onChange={(e) => saveField({ evergreenFlag: e.target.checked })} className="rounded h-3 w-3" />
                  <label htmlFor="evergreen" className="text-[11px] text-muted-foreground cursor-pointer">Evergreen content</label>
                </div>
              </CardContent>
            </Card>

            {/* Links */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="px-3 pt-3 pb-0">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                  <Link2 className="h-3 w-3" /> Links
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 pt-2 space-y-2">
                {idea && (
                  <Link href={`/ideas/${idea.id}`} className="flex items-center gap-2 p-1.5 -mx-1.5 rounded-md hover:bg-muted transition-colors group">
                    <div className="h-6 w-6 rounded bg-amber-500/10 flex items-center justify-center shrink-0">
                      <Lightbulb className="h-3 w-3 text-amber-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium truncate group-hover:text-foreground">{idea.title}</p>
                      <p className="text-[9px] text-muted-foreground">Original idea</p>
                    </div>
                  </Link>
                )}
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">External Doc</label>
                  <Input value={obj.externalDocUrl || ""} onChange={(e) => setObj({ ...obj, externalDocUrl: e.target.value })} onBlur={() => saveField({ externalDocUrl: obj.externalDocUrl })} className="mt-0.5 h-7 text-xs" placeholder="https://docs.google.com/..." />
                </div>
                {linkedPosts.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Social Posts ({linkedPosts.length})</label>
                      <div className="mt-1 space-y-0.5">
                        {linkedPosts.map((post: any) => (
                          <Link key={post.id} href={`/posts/${post.latePostId || post.id}`} className="flex items-center gap-1.5 p-1 -mx-1 rounded hover:bg-muted transition-colors text-[11px]">
                            <Send className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                            <span className="truncate flex-1">{post.content?.substring(0, 40) || "Post"}</span>
                            <Badge variant="secondary" className="text-[8px] capitalize shrink-0">{post.status}</Badge>
                          </Link>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                <Separator />
                <Link href={`/compose?contentObjectId=${contentId}`}>
                  <Button variant="outline" size="sm" className="w-full h-7 gap-1 text-[11px]">
                    <Send className="h-2.5 w-2.5" /> Create Social Post
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
      </Tabs>
    </div>
  );
}
