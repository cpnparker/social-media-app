"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bookmark, BookmarkPlus, Search, Loader2, Users, Trash2, Sparkles, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DESIGN_MODELS } from "@/lib/design/types";

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

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 8) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
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
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveTeam, setSaveTeam] = useState(false);
  const [saveModelHint, setSaveModelHint] = useState<string>("");
  const [saveTags, setSaveTags] = useState<string[]>([]);
  const [saveTagInput, setSaveTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!open || !workspaceId) return;
    setPrompts(null);
    setLoadError(null);
    const params = new URLSearchParams({ workspaceId });
    if (search.trim()) params.set("q", search.trim());
    try {
      const res = await fetch(`/api/design/saved-prompts?${params.toString()}`);
      if (res.ok) {
        const j = await res.json();
        setPrompts(j.prompts || []);
      } else {
        // Surface the failure so the UI doesn't sit on 'Loading…' forever.
        const j = await res.json().catch(() => ({}));
        setPrompts([]);
        setLoadError(j?.error || `HTTP ${res.status}`);
      }
    } catch (err: any) {
      setPrompts([]);
      setLoadError(err?.message || "Network error");
    }
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
        body: JSON.stringify({
          workspaceId,
          name,
          prompt,
          team: saveTeam,
          modelHint: saveModelHint || null,
          tags: saveTags.length > 0 ? saveTags : null,
        }),
      });
      if (res.ok) {
        toast.success(`Saved as "${name}"`);
        setSaveName("");
        setSaveTeam(false);
        setSaveModelHint("");
        setSaveTags([]);
        setSaveTagInput("");
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

  // Distinct tag set across all prompts, for the filter chips
  const allTags = useMemo(() => {
    if (!prompts) return [] as string[];
    const s = new Set<string>();
    prompts.forEach((p) => p.tags?.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [prompts]);

  const filteredPrompts = useMemo(() => {
    if (!prompts) return null;
    if (!tagFilter) return prompts;
    return prompts.filter((p) => p.tags?.includes(tagFilter));
  }, [prompts, tagFilter]);

  function addTag() {
    const t = saveTagInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!t || saveTags.includes(t) || saveTags.length >= 6) {
      setSaveTagInput("");
      return;
    }
    setSaveTags([...saveTags, t]);
    setSaveTagInput("");
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
      {/* design-mode class on the portal-rendered content so the CSS
          custom properties (--design-accent etc.) actually resolve here —
          Radix renders this in a portal outside the .design-mode scope. */}
      <PopoverContent align="end" className="design-mode w-[360px] p-0">
        <div className="flex border-b" style={{ borderColor: "hsl(var(--design-border))" }}>
          <TabButton active={tab === "pick"} onClick={() => setTab("pick")}>
            <Bookmark className="mr-1 h-3 w-3" /> Pick saved
          </TabButton>
          <TabButton active={tab === "save"} onClick={() => setTab("save")}>
            <BookmarkPlus className="mr-1 h-3 w-3" /> Save current
          </TabButton>
        </div>

        {tab === "pick" ? (
          <div className="flex max-h-[460px] flex-col">
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
              {allTags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {allTags.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTagFilter(tagFilter === t ? null : t)}
                      className={cn(
                        "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9.5px] font-medium transition-colors",
                        tagFilter === t
                          ? "border-[hsl(var(--design-accent))] bg-[hsl(var(--design-accent-soft))] text-[hsl(var(--design-accent))]"
                          : "border-[hsl(var(--design-border))] text-muted-foreground hover:border-[hsl(var(--design-accent))]/40",
                      )}
                    >
                      <Tag className="h-2 w-2" /> {t}
                    </button>
                  ))}
                  {tagFilter && (
                    <button
                      onClick={() => setTagFilter(null)}
                      className="text-[9.5px] text-muted-foreground underline"
                    >
                      clear
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-1.5">
              {prompts === null ? (
                <div className="flex items-center justify-center gap-1.5 py-6 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </div>
              ) : loadError ? (
                <div className="flex flex-col items-center gap-1 px-2 py-6 text-center text-[11px] text-muted-foreground">
                  <Bookmark className="h-4 w-4 opacity-50" />
                  <span>Couldn&apos;t load saved prompts</span>
                  <span className="text-[10px] opacity-80">{loadError}</span>
                  <span className="mt-1 text-[10px] italic">
                    The <code>design_saved_prompts</code> migration may not be applied yet.
                  </span>
                </div>
              ) : (filteredPrompts && filteredPrompts.length === 0) ? (
                <div className="flex flex-col items-center gap-1 px-2 py-6 text-center text-[11px] text-muted-foreground">
                  <Bookmark className="h-4 w-4 opacity-50" />
                  <span>{search || tagFilter ? "No matches" : "No saved prompts yet"}</span>
                  {!search && !tagFilter && (
                    <button onClick={() => setTab("save")} className="text-[10.5px] underline" style={{ color: "hsl(var(--design-accent))" }}>
                      Save the current prompt
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {(filteredPrompts || []).map((p) => (
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
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] text-muted-foreground">
                            {p.modelHint && <span>{p.modelHint}</span>}
                            {p.useCount > 0 && <span>·  used {p.useCount}×</span>}
                            {p.lastUsedAt && <span>·  {relativeTime(p.lastUsedAt)}</span>}
                            {p.tags && p.tags.length > 0 && (
                              <span className="flex flex-wrap gap-0.5">
                                {p.tags.slice(0, 4).map((t) => (
                                  <span key={t} className="rounded-full bg-[hsl(var(--design-bg))] px-1 py-0 text-[8.5px]">
                                    #{t}
                                  </span>
                                ))}
                              </span>
                            )}
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
          <div className="max-h-[460px] space-y-2 overflow-y-auto p-3">
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
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tuned for (optional)
              </label>
              <select
                value={saveModelHint}
                onChange={(e) => setSaveModelHint(e.target.value)}
                className="mt-0.5 w-full rounded-md border bg-[hsl(var(--design-bg-elev))] px-2 py-1.5 text-[12px] focus:border-[hsl(var(--design-accent))] focus:outline-none"
                style={{ borderColor: "hsl(var(--design-border))" }}
              >
                <option value="">No model hint</option>
                {DESIGN_MODELS.filter((m) => m.status === "live").map((m) => (
                  <option key={m.id} value={m.id}>{m.name} · {m.tag}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tags (optional)
              </label>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 rounded-md border bg-[hsl(var(--design-bg-elev))] px-1.5 py-1"
                   style={{ borderColor: "hsl(var(--design-border))" }}>
                {saveTags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-0.5 rounded-full bg-[hsl(var(--design-accent-soft))] px-1.5 py-0.5 text-[10px] font-medium" style={{ color: "hsl(var(--design-accent))" }}>
                    #{t}
                    <button
                      onClick={() => setSaveTags(saveTags.filter((x) => x !== t))}
                      className="rounded-full hover:bg-[hsl(var(--design-accent))]/15"
                      title="Remove tag"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
                <input
                  value={saveTagInput}
                  onChange={(e) => setSaveTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addTag();
                    } else if (e.key === "Backspace" && !saveTagInput && saveTags.length > 0) {
                      setSaveTags(saveTags.slice(0, -1));
                    }
                  }}
                  onBlur={() => saveTagInput.trim() && addTag()}
                  placeholder={saveTags.length === 0 ? "portrait, hero, b-roll…" : ""}
                  className="min-w-[80px] flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"
                  maxLength={20}
                  disabled={saveTags.length >= 6}
                />
              </div>
              {saveTags.length >= 6 && (
                <p className="mt-0.5 text-[9px] text-muted-foreground">Max 6 tags</p>
              )}
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
