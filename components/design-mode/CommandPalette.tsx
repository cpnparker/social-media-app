"use client";

import { useEffect, useMemo } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Plus, Wand2, BadgeCheck, Trash2, Film, Image as ImageIcon, ArrowRight, Copy, Share2, Sparkles, LayoutGrid, Rows3 } from "lucide-react";
import type { DesignShot } from "@/lib/design/types";
import { DESIGN_MODELS, LEGACY_MODEL_ALIASES } from "@/lib/design/types";
import { SESSION_TEMPLATES } from "@/lib/design/templates";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  shots: DesignShot[];
  currentShotId: string | null;
  onSelectShot: (id: string) => void;
  onAddShot: () => void;
  onRegenerate: () => void;
  onAnimate: () => void;
  onCommit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onChangeModel: (modelId: string) => void;
  /** Bulk actions */
  onCommitAll?: () => void;
  onGeneratePending?: () => void;
  onSwitchTimeline?: (shape: "storyboard" | "tracks") => void;
  onPublish?: () => void;
  onShare?: () => void;
  onOpenLibrary?: () => void;
  onApplyTemplate?: (templateId: string) => void;
}

/**
 * ⌘K command palette. Hub for everything a designer might want to do without
 * leaving the keyboard. Lists session shots, primary actions, and the model
 * picker. cmdk handles fuzzy search across all entries.
 */
export function CommandPalette({
  open,
  onClose,
  shots,
  currentShotId,
  onSelectShot,
  onAddShot,
  onRegenerate,
  onAnimate,
  onCommit,
  onDuplicate,
  onDelete,
  onChangeModel,
  onCommitAll,
  onGeneratePending,
  onSwitchTimeline,
  onPublish,
  onShare,
  onOpenLibrary,
  onApplyTemplate,
}: CommandPaletteProps) {
  // ESC handled by CommandDialog automatically; we still listen for /esc on the global ⌘K listener.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const currentShot = useMemo(
    () => shots.find((s) => s.id === currentShotId) || null,
    [shots, currentShotId],
  );

  function pickShot(id: string) {
    onSelectShot(id);
    onClose();
  }
  function pickAction(fn: () => void) {
    fn();
    onClose();
  }

  return (
    <CommandDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <CommandInput placeholder="Search shots, jump to a model, run an action…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        {/* Primary actions */}
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => pickAction(onAddShot)}>
            <Plus className="mr-2 h-4 w-4" /> New shot
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
          {currentShot && (
            <>
              <CommandItem onSelect={() => pickAction(onRegenerate)} disabled={!currentShot.prompt?.trim()}>
                <Wand2 className="mr-2 h-4 w-4" />
                {currentShot.versions.length === 0 ? "Generate" : "Regenerate"} S{String(currentShot.idx).padStart(2, "0")}
                <CommandShortcut>G</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => pickAction(onAnimate)}>
                <Film className="mr-2 h-4 w-4" />
                Animate S{String(currentShot.idx).padStart(2, "0")}
              </CommandItem>
              <CommandItem onSelect={() => pickAction(onCommit)} disabled={currentShot.versions.length === 0}>
                <BadgeCheck className="mr-2 h-4 w-4 text-[hsl(var(--design-success))]" />
                {currentShot.status === "approved" ? "Already committed" : "Commit S" + String(currentShot.idx).padStart(2, "0") + " to timeline"}
              </CommandItem>
              <CommandItem onSelect={() => pickAction(onDuplicate)}>
                <Copy className="mr-2 h-4 w-4" />
                Duplicate S{String(currentShot.idx).padStart(2, "0")}
                <CommandShortcut>⌘D</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => pickAction(onDelete)} className="text-[hsl(var(--design-danger))]">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete S{String(currentShot.idx).padStart(2, "0")}
              </CommandItem>
            </>
          )}
        </CommandGroup>

        {/* Bulk + global actions */}
        {(onCommitAll || onGeneratePending || onSwitchTimeline || onPublish || onShare) && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Session">
              {onGeneratePending && shots.some((s) => s.versions.length === 0 && s.prompt?.trim()) && (
                <CommandItem onSelect={() => pickAction(onGeneratePending)}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate v1 for all queued shots
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {shots.filter((s) => s.versions.length === 0 && s.prompt?.trim()).length} pending
                  </span>
                </CommandItem>
              )}
              {onCommitAll && shots.some((s) => s.status === "review" && s.versions.length > 0) && (
                <CommandItem onSelect={() => pickAction(onCommitAll)}>
                  <BadgeCheck className="mr-2 h-4 w-4 text-[hsl(var(--design-success))]" />
                  Commit all reviewed shots to timeline
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {shots.filter((s) => s.status === "review" && s.versions.length > 0).length} ready
                  </span>
                </CommandItem>
              )}
              {onSwitchTimeline && (
                <>
                  <CommandItem onSelect={() => pickAction(() => onSwitchTimeline("storyboard"))}>
                    <LayoutGrid className="mr-2 h-4 w-4" />
                    Switch to Storyboard view
                  </CommandItem>
                  <CommandItem onSelect={() => pickAction(() => onSwitchTimeline("tracks"))}>
                    <Rows3 className="mr-2 h-4 w-4" />
                    Switch to Tracks view
                  </CommandItem>
                </>
              )}
              {onOpenLibrary && (
                <CommandItem onSelect={() => pickAction(onOpenLibrary)}>
                  <ImageIcon className="mr-2 h-4 w-4" />
                  Open asset library
                </CommandItem>
              )}
              {onShare && (
                <CommandItem onSelect={() => pickAction(onShare)}>
                  <Share2 className="mr-2 h-4 w-4" />
                  Share this session
                </CommandItem>
              )}
              {onPublish && (
                <CommandItem onSelect={() => pickAction(onPublish)}>
                  <ArrowRight className="mr-2 h-4 w-4 text-[hsl(var(--design-accent))]" />
                  Publish to Engine
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}

        {/* Templates — add a pre-built sequence anytime */}
        {onApplyTemplate && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Add template">
              {SESSION_TEMPLATES.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`template ${t.name} ${t.description}`}
                  onSelect={() => pickAction(() => onApplyTemplate(t.id))}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  <span className="flex-1">{t.name}</span>
                  <span className="ml-2 text-[10px] text-muted-foreground">+{t.shots.length} shots</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Shots */}
        {shots.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Jump to shot">
              {shots.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`S${String(s.idx).padStart(2, "0")} ${s.title} ${s.beat || ""} ${s.modelId || ""}`}
                  onSelect={() => pickShot(s.id)}
                >
                  <span className="mr-2 inline-flex h-5 w-7 items-center justify-center rounded font-mono text-[10px] text-muted-foreground">
                    S{String(s.idx).padStart(2, "0")}
                  </span>
                  <span className="flex-1 truncate">{s.title}</span>
                  {s.beat && <span className="ml-2 text-[10px] text-muted-foreground">{s.beat}</span>}
                  <span className="ml-2 text-[10px] text-muted-foreground">{s.duration.toFixed(1)}s</span>
                  {s.id === currentShotId && <ArrowRight className="ml-2 h-3 w-3" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Models — only when a shot is focused */}
        {currentShot && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Switch model">
              {DESIGN_MODELS.filter((m) => m.status === "live").map((m) => {
                const resolvedCurrent = currentShot.modelId ? (LEGACY_MODEL_ALIASES[currentShot.modelId] || currentShot.modelId) : null;
                const isCurrent = m.id === resolvedCurrent;
                return (
                  <CommandItem
                    key={m.id}
                    value={`model ${m.name} ${m.tag}`}
                    onSelect={() => pickAction(() => onChangeModel(m.id))}
                  >
                    {m.provider === "openai-image" || m.provider === "xai-image" ? (
                      <ImageIcon className="mr-2 h-4 w-4" />
                    ) : (
                      <Film className="mr-2 h-4 w-4" />
                    )}
                    <span className="flex-1">{m.name}</span>
                    <span className="text-[10px] text-muted-foreground">{m.tag}</span>
                    {isCurrent && <span className="ml-2 text-[10px] text-[hsl(var(--design-accent))]">current</span>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
