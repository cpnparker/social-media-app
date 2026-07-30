"use client";

/**
 * The Notebook — a docked panel to the right of the chat.
 *
 * Collapsed to a narrow strip by default so it costs nothing until wanted;
 * expanded it lists the captures for the active notebook. Entries link back to
 * the message they came from, which is the point of the feature: a clipping
 * without provenance is just a quote.
 *
 * Everything about WHO can see an entry is decided server-side
 * (lib/notebook/access.ts). This component renders what the API returned and
 * never re-derives visibility.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  NotebookPen, ChevronRight, Plus, Trash2, MoreHorizontal, Brain, Users, Lock,
  CornerUpLeft, Check, Loader2, Sparkles, MessageSquareQuote, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  NOTEBOOK_CHANGED, OPEN_KEY, ACTIVE_KEY, notifyNotebookChanged,
  type Notebook, type NotebookEntry,
} from "@/lib/notebook/client";

interface Props {
  workspaceId: string | null | undefined;
  /** Jump to the message an entry came from (the page owns thread switching). */
  onJumpToSource?: (conversationId: string, messageId: string | null) => void;
  /** Seed the chat composer with a question about an entry. */
  onAskAbout?: (entry: NotebookEntry) => void;
}

const TYPE_ICON: Record<NotebookEntry["type"], typeof MessageSquareQuote> = {
  highlight: MessageSquareQuote,
  answer: Sparkles,
  prompt: CornerUpLeft,
  note: NotebookPen,
};

export default function NotebookPanel({ workspaceId, onJumpToSource, onAskAbout }: Props) {
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [entries, setEntries] = useState<NotebookEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // Restore panel state. Kept in localStorage rather than a preference row —
  // it is a per-device layout choice, not an account setting.
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === "1");
      setActiveId(localStorage.getItem(ACTIVE_KEY));
    } catch { /* private mode */ }
  }, []);

  const persistOpen = (v: boolean) => {
    setOpen(v);
    try { localStorage.setItem(OPEN_KEY, v ? "1" : "0"); } catch { /* ignore */ }
  };

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/notebook?workspaceId=${encodeURIComponent(workspaceId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setNotebooks(data.notebooks || []);
      setEntries(data.entries || []);
      if (typeof data.currentUserId === "number") setCurrentUserId(data.currentUserId);
      setActiveId((prev) => {
        const ids = (data.notebooks || []).map((n: Notebook) => n.id);
        return prev && ids.includes(prev) ? prev : ids[0] || null;
      });
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  // A capture can be saved from anywhere in the tree; the saver announces and
  // we refetch rather than threading state through the whole chat.
  useEffect(() => {
    const onChanged = () => load();
    const onOpen = () => persistOpen(true);
    window.addEventListener(NOTEBOOK_CHANGED, onChanged);
    window.addEventListener("engine-notebook-open", onOpen);
    return () => {
      window.removeEventListener(NOTEBOOK_CHANGED, onChanged);
      window.removeEventListener("engine-notebook-open", onOpen);
    };
  }, [load]);

  useEffect(() => {
    if (activeId) { try { localStorage.setItem(ACTIVE_KEY, activeId); } catch { /* ignore */ } }
  }, [activeId]);

  const active = notebooks.find((n) => n.id === activeId) || null;
  const visible = useMemo(
    () => entries.filter((e) => e.notebookId === activeId),
    [entries, activeId]
  );
  const isOwner = !!active && active.userId === currentUserId;

  // ── mutations ───────────────────────────────────────────────────────────
  const saveNote = async (entry: NotebookEntry, note: string) => {
    if (!workspaceId) return;
    setBusy(entry.id);
    try {
      const res = await fetch(`/api/ai/notebook/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, note }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Could not save the note"); return; }
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? data.entry : e)));
      setEditingNote(null);
    } finally { setBusy(null); }
  };

  const remove = async (entry: NotebookEntry) => {
    if (!workspaceId) return;
    setBusy(entry.id);
    try {
      const res = await fetch(
        `/api/ai/notebook/entries/${entry.id}?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) { toast.error("Could not delete the entry"); return; }
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } finally { setBusy(null); }
  };

  const togglePromote = async (entry: NotebookEntry) => {
    if (!workspaceId) return;
    setBusy(entry.id);
    try {
      const url = `/api/ai/notebook/entries/${entry.id}/promote`;
      const res = entry.isMemory
        ? await fetch(`${url}?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "DELETE" })
        : await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId }),
          });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Could not update the memory"); return; }
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? data.entry : e)));
      toast.success(
        entry.isMemory
          ? "Removed from memories"
          : data.notice || "Saved as a memory — EngineAI will keep this in mind"
      );
    } finally { setBusy(null); }
  };

  const createNotebook = async () => {
    if (!workspaceId) return;
    const title = window.prompt("Name this notebook", "Notebook");
    if (!title) return;
    const res = await fetch("/api/ai/notebook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, title }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || "Could not create the notebook"); return; }
    setActiveId(data.notebook.id);
    notifyNotebookChanged();
  };

  const setVisibility = async (visibility: "private" | "team") => {
    if (!workspaceId || !active) return;
    const res = await fetch(`/api/ai/notebook/${active.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, visibility }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || "Could not change sharing"); return; }
    setNotebooks((prev) => prev.map((n) => (n.id === active.id ? data.notebook : n)));
    toast.success(
      visibility === "team"
        ? "Shared with the team — captures from your private chats stay private"
        : "Notebook is private again"
    );
  };

  if (!workspaceId) return null;

  // ── collapsed strip ─────────────────────────────────────────────────────
  if (!open) {
    return (
      <div className="hidden lg:flex shrink-0 w-11 border-l bg-background flex-col items-center py-3 gap-2">
        <button
          onClick={() => persistOpen(true)}
          title="Open the notebook"
          aria-label="Open the notebook"
          className="h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <NotebookPen className="h-[18px] w-[18px]" />
        </button>
        {entries.length > 0 && (
          <span className="text-[10px] font-medium text-muted-foreground tabular-nums">{entries.length}</span>
        )}
        <span
          className="mt-1 text-[10px] tracking-wide text-muted-foreground/70 select-none"
          style={{ writingMode: "vertical-rl" }}
        >
          Notebook
        </span>
      </div>
    );
  }

  // ── expanded panel ──────────────────────────────────────────────────────
  return (
    <div className="hidden lg:flex shrink-0 w-[380px] border-l bg-background flex-col min-h-0">
      <div className="shrink-0 flex items-center gap-2 px-3 h-12 border-b">
        <NotebookPen className="h-4 w-4 text-muted-foreground shrink-0" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 min-w-0 text-sm font-medium hover:text-foreground/80 transition-colors">
              <span className="truncate">{active?.title || "Notebook"}</span>
              {active?.visibility === "team" && <Users className="h-3 w-3 text-muted-foreground shrink-0" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {notebooks.map((n) => (
              <DropdownMenuItem key={n.id} onClick={() => setActiveId(n.id)} className="gap-2 text-sm">
                {n.visibility === "team" ? <Users className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                <span className="flex-1 truncate">{n.title}</span>
                {n.id === activeId && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={createNotebook} className="gap-2 text-sm">
              <Plus className="h-3.5 w-3.5" />
              New notebook
            </DropdownMenuItem>
            {isOwner && active && (
              <DropdownMenuItem
                onClick={() => setVisibility(active.visibility === "team" ? "private" : "team")}
                className="gap-2 text-sm"
              >
                {active.visibility === "team" ? <Lock className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
                {active.visibility === "team" ? "Make private" : "Share with team"}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex-1" />
        <button
          onClick={() => persistOpen(false)}
          title="Collapse the notebook"
          aria-label="Collapse the notebook"
          className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {active?.visibility === "team" && (
        <p className="shrink-0 px-3 py-2 text-[11px] leading-snug text-muted-foreground border-b bg-muted/30">
          Shared with the workspace. Anything you clipped from a private chat stays visible to you only.
        </p>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && visible.length === 0 && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}

        {!loading && visible.length === 0 && (
          <div className="px-4 py-10 text-center">
            <NotebookPen className="h-7 w-7 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm font-medium mb-1">Nothing saved yet</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Select any part of an answer and choose <span className="font-medium">Save to notebook</span>,
              or use the bookmark on a whole message.
            </p>
          </div>
        )}

        <div className="p-2 space-y-2">
          {visible.map((entry) => {
            const Icon = TYPE_ICON[entry.type] || MessageSquareQuote;
            const mine = entry.userId === currentUserId;
            return (
              <div key={entry.id} className="rounded-xl border bg-card p-2.5 group">
                <div className="flex items-start gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0 mt-0.5" />
                  <p className="flex-1 min-w-0 text-[13px] leading-relaxed text-foreground/90 line-clamp-6 whitespace-pre-wrap">
                    {entry.quote}
                  </p>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0"
                        aria-label="Entry actions"
                      >
                        {busy === entry.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      {onAskAbout && (
                        <DropdownMenuItem onClick={() => onAskAbout(entry)} className="gap-2 text-sm">
                          <Sparkles className="h-3.5 w-3.5" />
                          Ask about this
                        </DropdownMenuItem>
                      )}
                      {mine && (
                        <DropdownMenuItem onClick={() => togglePromote(entry)} className="gap-2 text-sm">
                          <Brain className="h-3.5 w-3.5" />
                          {entry.isMemory ? "Forget this" : "Remember this"}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() => { navigator.clipboard.writeText(entry.quote); toast.success("Copied"); }}
                        className="gap-2 text-sm"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Copy text
                      </DropdownMenuItem>
                      {mine && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => remove(entry)}
                            className="gap-2 text-sm text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Annotation */}
                {editingNote === entry.id ? (
                  <div className="mt-2">
                    <textarea
                      ref={noteRef}
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditingNote(null);
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveNote(entry, noteDraft);
                      }}
                      rows={2}
                      placeholder="Why does this matter?"
                      className="w-full resize-none rounded-lg border bg-background px-2 py-1.5 text-xs outline-none focus:border-foreground/30"
                    />
                    <div className="flex justify-end gap-1 mt-1">
                      <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setEditingNote(null)}>
                        Cancel
                      </Button>
                      <Button size="sm" className="h-6 text-[11px]" onClick={() => saveNote(entry, noteDraft)}>
                        Save
                      </Button>
                    </div>
                  </div>
                ) : entry.note ? (
                  <button
                    onClick={() => { if (mine) { setEditingNote(entry.id); setNoteDraft(entry.note || ""); } }}
                    className={cn(
                      "mt-2 w-full text-left rounded-lg bg-muted/50 px-2 py-1.5 text-xs text-foreground/80 leading-relaxed",
                      mine && "hover:bg-muted transition-colors"
                    )}
                  >
                    {entry.note}
                  </button>
                ) : mine ? (
                  <button
                    onClick={() => { setEditingNote(entry.id); setNoteDraft(""); }}
                    className="mt-1.5 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
                  >
                    + Add a note
                  </button>
                ) : null}

                {/* Footer: provenance + state */}
                <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground/70">
                  {entry.conversationId ? (
                    <button
                      onClick={() => onJumpToSource?.(entry.conversationId!, entry.messageId)}
                      className="flex items-center gap-1 min-w-0 hover:text-foreground transition-colors"
                      title="Go to the source message"
                    >
                      <CornerUpLeft className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate max-w-[170px]">{entry.sourceTitle || "source chat"}</span>
                    </button>
                  ) : (
                    <span className="truncate">{entry.sourceTitle || "no source"}</span>
                  )}
                  <div className="flex-1" />
                  {entry.isMemory && (
                    <span className="flex items-center gap-1 text-foreground/60" title="Saved as a memory">
                      <Brain className="h-2.5 w-2.5" />
                      memory
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
