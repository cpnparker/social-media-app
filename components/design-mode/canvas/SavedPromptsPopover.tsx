"use client";

import { useState, useEffect, useCallback } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bookmark, BookmarkPlus, Search, Loader2, Users, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface SavedPrompt {
  id: string;
  name: string;
  prompt: string;
  modelHint: string | null;
  tags: string[];
  useCount: number;
  lastUsedAt: string | null;
  isTeam: boolean;
  isMine: boolean;
}

interface SavedPromptsPopoverProps {
  workspaceId: string;
  /** Current prompt — used as the default when saving. */
  currentPrompt: string;
  /** Called when a saved prompt is picked. */
  onApply: (prompt: string, modelHint: string | null) => void;
}

/**
 * Bookmark-icon button next to the prompt block. Opens a popover with:
 *   - Save the current prompt (with a name + optional team toggle)
 *   - Search + pick from saved prompts
 *
 * Workspace-scoped: shows own prompts + any team-shared ones.
 */
export function SavedPromptsPopover({ workspaceId, currentPrompt, onApply }: SavedPromptsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"pick" | "save">("pick");
  const [prompts, setPrompts] = useState<SavedPrompt[] | null>(null);
  const [search, setSearch] = useState("");
  const [saveName, setSaveName] = useState("");
  const [saveTeam, setSaveTeam] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!open || !workspaceId) return;
    setPrompts(null);
    const params = new URLSearchParams({ workspaceId });
    if (search.trim()) params.set("q", search.trim());
    try {
      const res = await fetch(`/api/design/saved-prompts?${params.toString()}`);
      if (res.ok) {
        const j = await res.json();
        setPrompts(j.prompts || []);
      }
    } catch { /* non-fatal */ }
  }, [open, workspaceId, search]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [open, search, load]);

  async function applyPrompt(p: SavedPrompt) {
    onApply(p.prompt, p.modelHint);
    setOpen(false);
    // Bump use count async (don't block UI)
    fetch(`/api/design/saved-prompts`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id }),
    }).catch(() => {});
  }

  async function savePrompt() {
    const name = saveName.trim();
    const prompt = currentPrompt.trim();
    if (!name || !prompt) {
      toast.error("Name and prompt required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/design/saved-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, name, prompt, team: saveTeam }),
      });
      if (res.ok) {
        toast.success(`Saved as "${name}"`);
        setSaveName("");
        setSaveTeam(false);
        setTab("pick");
        load();
      } else {
        const j = await res.json().catch(() => ({}));
        toast.error(j?.error || "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  async function deletePrompt(p: SavedPrompt) {
    if (!confirm(`Delete "${p.name}"?`)) return;
    const res = await fetch(`/api/design/saved-prompts?id=${p.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Deleted");
      load();
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-[hsl(var(--design-border))]/40 hover:text-[hsl(var(--design-accent))]"
          title="Saved prompts"
        >
          <Bookmark className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex border-b" style={{ borderColor: "hsl(var(--design-border))" }}>
          <TabButton active={tab === "pick"} onClick={() => setTab("pick")}>
            <Bookmark className="mr-1 h-3 w-3" /> Pick saved
          </TabButton>
          <TabButton active={tab === "save"} onClick={() => setTab("save")}>
            <BookmarkPlus className="mr-1 h-3 w-3" /> Save current
          </TabButton>
        </div>

        {tab === "pick" ? (
          <div className="flex max-h-[420px] flex-col">
            <div className="border-b p-2" style={{ borderColor: "hsl(var(--design-border))" }}>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search saved prompts…"
                  className="w-full rounded-md border bg-[hsl(var(--design-bg-elev))] py-1 pl-7 pr-2 text-[11.5px] focus:border-[hsl(var(--design-accent))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--design-accent))]/20"
                  style={{ borderColor: "hsl(var(--design-border))" }}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5">
              {prompts === null ? (
                <div className="flex items-center justify-center gap-1.5 py-6 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </div>
              ) : prompts.length === 0 ? (
                <div className="flex flex-col items-center gap-1 px-2 py-6 text-center text-[11px] text-muted-foreground">
                  <Bookmark className="h-4 w-4 opacity-50" />
                  <span>{search ? "No matches" : "No saved prompts yet"}</span>
                  {!search && (
                    <button onClick={() => setTab("save")} className="text-[10.5px] underline" style={{ color: "hsl(var(--design-accent))" }}>
                      Save the current prompt
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {prompts.map((p) => (
                    <div key={p.id} className="design-tile group rounded-md border p-2"
                         style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg-elev))" }}>
                      <div className="flex items-start gap-2">
                        <button onClick={() => applyPrompt(p)} className="min-w-0 flex-1 text-left">
                          <div className="flex items-center gap-1">
                            <span className="line-clamp-1 text-[11.5px] font-medium">{p.name}</span>
                            {p.isTeam && <Users className="h-2.5 w-2.5 text-purple-600" />}
                          </div>
                          <p className="mt-0.5 line-clamp-2 font-mono text-[10px] text-muted-foreground">
                            {p.prompt}
                          </p>
                          <div className="mt-1 flex items-center gap-1.5 text-[9px] text-muted-foreground">
                            {p.modelHint && <span>{p.modelHint}</span>}
                            {p.useCount > 0 && <span>·  used {p.useCount}×</span>}
                          </div>
                        </button>
                        {p.isMine && (
                          <button
                            onClick={() => deletePrompt(p)}
                            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-[hsl(var(--design-danger))] group-hover:opacity-100"
                            title="Delete"
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2 p-3">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Name</label>
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="e.g. 'Editorial landscape · golden hour'"
                className="mt-0.5 w-full rounded-md border bg-[hsl(var(--design-bg-elev))] px-2 py-1.5 text-[12px] focus:border-[hsl(var(--design-accent))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--design-accent))]/20"
                style={{ borderColor: "hsl(var(--design-border))" }}
                maxLength={120}
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Prompt</label>
              <div className="mt-0.5 max-h-32 overflow-y-auto rounded-md border bg-[hsl(var(--design-bg))] p-2 font-mono text-[11px]"
                   style={{ borderColor: "hsl(var(--design-border))" }}>
                {currentPrompt || <span className="italic text-muted-foreground">No prompt to save yet</span>}
              </div>
            </div>
            <label className="flex items-center gap-2 rounded-md px-1 py-1 text-[11px] hover:bg-[hsl(var(--design-bg-elev))]">
              <input
                type="checkbox"
                checked={saveTeam}
                onChange={(e) => setSaveTeam(e.target.checked)}
                className="h-3 w-3"
              />
              <span className="flex-1">Share with the team</span>
              <Users className="h-3 w-3 text-muted-foreground" />
            </label>
            <button
              onClick={savePrompt}
              disabled={saving || !saveName.trim() || !currentPrompt.trim()}
              className={cn(
                "flex w-full items-center justify-center gap-1.5 rounded-md bg-[hsl(var(--design-accent))] px-3 py-1.5 text-[12px] font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-50",
              )}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {saving ? "Saving…" : "Save to library"}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 inline-flex items-center justify-center px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wider transition-colors",
        active
          ? "border-b-2 border-[hsl(var(--design-accent))] text-[hsl(var(--design-accent))]"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
