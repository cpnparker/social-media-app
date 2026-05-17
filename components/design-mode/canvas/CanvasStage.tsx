"use client";

import { useState, useEffect } from "react";
import { Play, Pause, SkipBack, SkipForward, ChevronDown, Sparkles, Check, AlertTriangle, BadgeCheck, Pencil, Plus, Wand2, MoreVertical, Trash2, Download, Columns2 } from "lucide-react";
import { ReferencePicker } from "./ReferencePicker";
import { VersionDetailDialog } from "./VersionDetailDialog";
import { VersionCompareDialog } from "./VersionCompareDialog";
import { SavedPromptsPopover } from "./SavedPromptsPopover";
import { QuickStartPicker } from "../QuickStartPicker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { DesignShot } from "@/lib/design/types";
import { DESIGN_MODELS, LEGACY_MODEL_ALIASES } from "@/lib/design/types";

interface CanvasStageProps {
  shot: DesignShot | null;
  /** All shots in the session — used by the references picker to surface candidate canvas assets. */
  allShots?: DesignShot[];
  /** Workspace id — needed for the saved prompts library scope. */
  workspaceId?: string;
  onRegenerate: () => void;
  onCommit: () => void;
  onModelChange: (modelId: string) => void;
  onPromptSave: (prompt: string) => void;
  onFormatChange: (ratio: string) => void;
  onSelectVersion?: (versionId: string) => void;
  onAddShot?: () => void;
  onApplyTemplate?: (templateId: string) => Promise<void>;
  onTitleSave?: (title: string) => void;
  onBeatSave?: (beat: string | null) => void;
  onDurationSave?: (duration: number) => void;
  onDelete?: () => void;
  onUploadReference?: (file: File) => void;
  onPickReferenceAsset?: (assetId: string, blobUrl: string) => void;
  onRemoveReference?: (refId: string) => void;
  onAnimateImage?: () => void;
  /** Re-generate the focused shot with brand-correction guidance appended. */
  onFixDrift?: () => void;
  activeFormat?: string;
  generating?: boolean;
  animating?: boolean;
}

const STATUS_PILL: Record<string, { label: string; className: string }> = {
  queued:     { label: "Queued",     className: "pill-neutral" },
  generating: { label: "Generating", className: "pill-accent" },
  review:     { label: "In review",  className: "pill-warning" },
  approved:   { label: "Approved",   className: "pill-success" },
  drift:      { label: "Drift",      className: "pill-warning" },
};

export function CanvasStage({
  shot,
  allShots,
  workspaceId,
  onRegenerate,
  onCommit,
  onModelChange,
  onPromptSave,
  onFormatChange,
  onSelectVersion,
  onAddShot,
  onApplyTemplate,
  onTitleSave,
  onBeatSave,
  onDurationSave,
  onDelete,
  onUploadReference,
  onPickReferenceAsset,
  onRemoveReference,
  onAnimateImage,
  onFixDrift,
  activeFormat = "16:9",
  generating = false,
  animating = false,
}: CanvasStageProps) {
  const [playing, setPlaying] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState(shot?.prompt || "");
  const [detailVersionId, setDetailVersionId] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);

  // Reset prompt draft when the shot changes
  useEffect(() => {
    setPromptDraft(shot?.prompt || "");
    setEditingPrompt(false);
  }, [shot?.id, shot?.prompt]);

  if (!shot) {
    return (
      <div className="flex h-full flex-col items-center justify-start gap-6 overflow-y-auto p-8">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <div className="relative">
            <div className="absolute inset-0 -m-4 rounded-full bg-[hsl(var(--design-accent-soft))] blur-2xl opacity-70" />
            <Sparkles className="relative h-9 w-9" style={{ color: "hsl(var(--design-accent))" }} />
          </div>
          <div className="space-y-1 max-w-md">
            <h3 className="editorial-display text-[24px] leading-tight">Let&apos;s design something.</h3>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Start from a template, add a single shot, or describe what you want in Engine AI on the right.
            </p>
          </div>
        </div>

        {/* Quick-start template picker */}
        {onApplyTemplate ? (
          <QuickStartPicker onPick={onApplyTemplate} onSkip={() => onAddShot?.()} />
        ) : onAddShot ? (
          <button
            onClick={onAddShot}
            className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--design-accent))] px-5 py-2 text-[13px] font-medium text-white shadow-sm transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Create a shot
          </button>
        ) : null}
      </div>
    );
  }

  const statusInfo = STATUS_PILL[shot.status] || STATUS_PILL.queued;
  const resolvedModelId = shot.modelId ? (LEGACY_MODEL_ALIASES[shot.modelId] || shot.modelId) : "runway-g4-5";
  const currentModel = DESIGN_MODELS.find((m) => m.id === resolvedModelId) || DESIGN_MODELS[0];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* Top meta strip — editable title + beat + duration */}
      <ShotMetaStrip
        shot={shot}
        onTitleSave={onTitleSave}
        onBeatSave={onBeatSave}
        onDurationSave={onDurationSave}
        onDelete={onDelete}
      />

      {/* Preview + inspector */}
      <div className="grid flex-1 gap-3 lg:grid-cols-[1fr_280px]">
        {/* Preview */}
        <div className="flex flex-col gap-2">
          <ShotPreview shot={shot} status={statusInfo} />
          <Transport
            playing={playing}
            onToggle={() => setPlaying((p) => !p)}
            duration={shot.duration}
          />
          <VersionsStrip
            versions={shot.versions}
            current={shot.currentVersionId}
            onSelect={onSelectVersion || (() => {})}
            onOpenDetail={setDetailVersionId}
            onVary={onRegenerate}
            onCompare={shot.versions.length >= 2 ? () => setCompareOpen(true) : undefined}
          />

          {/* Version detail dialog */}
          {detailVersionId && (() => {
            const v = shot.versions.find((x) => x.id === detailVersionId);
            if (!v) return null;
            return (
              <VersionDetailDialog
                open={true}
                onClose={() => setDetailVersionId(null)}
                shot={shot}
                version={v}
                isCurrent={v.id === shot.currentVersionId}
                onSetCurrent={() => {
                  onSelectVersion?.(v.id);
                  setDetailVersionId(null);
                }}
                onAnimate={onAnimateImage ? () => {
                  onAnimateImage();
                  setDetailVersionId(null);
                } : undefined}
              />
            );
          })()}

          {/* Version compare dialog */}
          {compareOpen && (
            <VersionCompareDialog
              open={compareOpen}
              onClose={() => setCompareOpen(false)}
              shot={shot}
              onSetCurrent={(versionId) => {
                onSelectVersion?.(versionId);
              }}
            />
          )}
        </div>

        {/* Inspector */}
        <aside className="flex flex-col gap-3 overflow-y-auto rounded-lg border bg-[hsl(var(--design-bg-elev))] p-3"
               style={{ borderColor: "hsl(var(--design-border))" }}>
          {/* Generator */}
          <div className="space-y-1.5">
            <div className="section-label muted">Generator</div>
            <div className="relative">
              <button
                onClick={() => setModelPickerOpen((o) => !o)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border bg-[hsl(var(--design-bg))] px-3 py-2 text-left hover:border-[hsl(var(--design-accent))]/40"
                style={{ borderColor: "hsl(var(--design-border))" }}
              >
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-semibold">{currentModel.name}</div>
                  <div className="truncate text-[10.5px] text-muted-foreground">{shot.modelNote || currentModel.tag}</div>
                </div>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {modelPickerOpen && (
                <ModelPicker
                  activeId={currentModel.id}
                  onPick={(id) => { setModelPickerOpen(false); onModelChange(id); }}
                  onClose={() => setModelPickerOpen(false)}
                />
              )}
            </div>
          </div>

          {/* Prompt — inline editable */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="section-label muted">Prompt</div>
              <div className="flex items-center gap-1.5">
                {workspaceId && (
                  <SavedPromptsPopover
                    workspaceId={workspaceId}
                    currentPrompt={editingPrompt ? promptDraft : (shot.prompt || "")}
                    onApply={(prompt, modelHint) => {
                      // Apply the saved prompt — overwrite the draft and persist.
                      setPromptDraft(prompt);
                      onPromptSave(prompt);
                      setEditingPrompt(false);
                      // Optional model hint — switch the generator if it's a real model id.
                      if (modelHint) {
                        const resolved = LEGACY_MODEL_ALIASES[modelHint] || modelHint;
                        if (DESIGN_MODELS.some((m) => m.id === resolved && m.status === "live")) {
                          onModelChange(resolved);
                        }
                      }
                    }}
                  />
                )}
                {editingPrompt ? (
                  <button
                    onClick={() => {
                      onPromptSave(promptDraft);
                      setEditingPrompt(false);
                    }}
                    className="text-[10.5px] font-semibold"
                    style={{ color: "hsl(var(--design-accent))" }}
                  >
                    Save
                  </button>
                ) : (
                  <button
                    onClick={() => setEditingPrompt(true)}
                    className="text-[10.5px] underline"
                    style={{ color: "hsl(var(--design-accent))" }}
                  >
                    Refine
                  </button>
                )}
              </div>
            </div>
            {editingPrompt ? (
              <textarea
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setPromptDraft(shot.prompt || "");
                    setEditingPrompt(false);
                  }
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    onPromptSave(promptDraft);
                    setEditingPrompt(false);
                  }
                }}
                rows={6}
                autoFocus
                className="w-full resize-none rounded-lg border p-2.5 font-mono text-[11px] leading-relaxed focus:border-[hsl(var(--design-accent))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--design-accent))]/20"
                style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg))" }}
                placeholder="Describe the shot — composition, lighting, motion, mood…"
              />
            ) : (
              <div
                onClick={() => setEditingPrompt(true)}
                className="group relative cursor-text rounded-lg border p-2.5 font-mono text-[11px] leading-relaxed transition-colors hover:border-[hsl(var(--design-accent))]/60"
                style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg))" }}
                title="Click to edit"
              >
                {shot.prompt ? (
                  shot.prompt
                ) : (
                  <span className="flex items-center gap-1.5 italic text-muted-foreground">
                    <Pencil className="h-3 w-3" />
                    Click to write a prompt
                  </span>
                )}
                <Pencil className="absolute right-2 top-2 h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60" />
              </div>
            )}
          </div>

          {/* References */}
          <div className="space-y-1.5">
            <div className="section-label muted">References</div>
            <div className="grid grid-cols-3 gap-1.5">
              {shot.refs.slice(0, 11).map((r) => {
                const url = r.assetUrl || r.externalUrl;
                return (
                  <div key={r.id} className="group relative aspect-square overflow-hidden rounded-md border"
                       style={{ borderColor: "hsl(var(--design-border))" }}
                       title={r.caption || "Reference"}>
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={r.caption || ""} className="h-full w-full object-cover" />
                    ) : (
                      <div className="thumb thumb-stripe h-full w-full" style={{ ['--th' as any]: "30" }} />
                    )}
                    {r.seedLocked && (
                      <span className="absolute right-0.5 top-0.5 rounded bg-[hsl(var(--design-pin))] px-1 text-[9px] font-bold text-white">S</span>
                    )}
                    {onRemoveReference && (
                      <button
                        onClick={() => onRemoveReference(r.id)}
                        className="absolute right-0.5 bottom-0.5 rounded-full bg-black/55 p-0.5 text-white opacity-0 transition-opacity hover:bg-[hsl(var(--design-danger))] group-hover:opacity-100"
                        title="Remove reference"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                );
              })}
              {/* Upload / pick affordance */}
              {onUploadReference && (
                <ReferencePicker
                  shots={allShots || []}
                  excludeShotId={shot.id}
                  onUpload={onUploadReference}
                  onPickAsset={(assetId, blobUrl) => onPickReferenceAsset?.(assetId, blobUrl)}
                />
              )}
            </div>
            {shot.refs.some((r) => r.seedLocked) && (
              <div className="text-[10px] italic text-muted-foreground">
                Seed-locked from previous shot · character carry
              </div>
            )}
          </div>

          {/* Output */}
          <div className="space-y-1.5">
            <div className="section-label muted">Output</div>
            <div className="flex flex-wrap gap-1">
              {["16:9", "9:16", "1:1", "4:5"].map((f) => (
                <FormatChip key={f} ratio={f} active={f === activeFormat} onClick={() => onFormatChange(f)} />
              ))}
            </div>
            <button
              onClick={onRegenerate}
              disabled={generating || animating || !shot.prompt?.trim()}
              className="mt-2 w-full rounded-lg bg-[hsl(var(--design-accent))] px-3 py-2 text-[12px] font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
            >
              {generating ? "Generating…" : shot.versions.length === 0 ? "Generate · v1" : "Regenerate · new version"}
            </button>
            {/* Drift recovery — only when the current version failed brand check */}
            {onFixDrift && shot.status === "drift" && !generating && !animating && (
              <button
                onClick={onFixDrift}
                disabled={!shot.prompt?.trim()}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[hsl(var(--design-warning))]/50 bg-[hsl(38_85%_96%)] px-3 py-2 text-[12px] font-medium text-[hsl(25_70%_40%)] transition-colors hover:bg-[hsl(38_85%_92%)] disabled:opacity-50"
                title="Re-generate with explicit brand-correction guidance"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Fix drift
              </button>
            )}
            {/* Animate-this-image shortcut — only when current version is an image */}
            {onAnimateImage && (() => {
              const cur = shot.versions.find((v) => v.id === shot.currentVersionId) || shot.versions[shot.versions.length - 1];
              if (!cur || cur.assetType !== "image") return null;
              return (
                <button
                  onClick={onAnimateImage}
                  disabled={generating || animating}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors hover:border-[hsl(var(--design-accent))] hover:text-[hsl(var(--design-accent))] disabled:opacity-50"
                  style={{ borderColor: "hsl(var(--design-border))" }}
                  title="Use this still as a Runway image-to-video seed"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  {animating ? "Animating…" : "Animate this image"}
                </button>
              );
            })()}
            <button
              onClick={onCommit}
              disabled={shot.versions.length === 0}
              className={cn(
                "flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors disabled:opacity-50",
                shot.status === "approved"
                  ? "border-[hsl(var(--design-success))] bg-[hsl(158_60%_96%)] text-[hsl(var(--design-success))]"
                  : "border-[hsl(var(--design-border))] hover:bg-[hsl(var(--design-bg))]",
              )}
            >
              {shot.status === "approved" ? (
                <><BadgeCheck className="h-3.5 w-3.5" /> Committed</>
              ) : (
                <>Commit to timeline</>
              )}
            </button>
            {/* Export current version */}
            {(() => {
              const cur = shot.versions.find((v) => v.id === shot.currentVersionId) || shot.versions[shot.versions.length - 1];
              if (!cur?.assetUrl) return null;
              const isVideo = cur.assetType === "video" || cur.assetType === "artlist_video";
              const ext = isVideo ? "mp4" : "png";
              const safeTitle = shot.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
              const filename = `${safeTitle || "shot"}-s${String(shot.idx).padStart(2, "0")}-v${cur.idx}.${ext}`;
              return (
                <a
                  href={cur.assetUrl}
                  download={filename}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors hover:bg-[hsl(var(--design-bg))]"
                  style={{ borderColor: "hsl(var(--design-border))" }}
                  title={`Download ${filename}`}
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
              );
            })()}
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * Editable top strip: Shot · NN | Title (inline editable) | Beat (inline editable)
 * + duration / version count / brand-status pill + overflow menu (delete).
 */
function ShotMetaStrip({
  shot, onTitleSave, onBeatSave, onDurationSave, onDelete,
}: {
  shot: DesignShot;
  onTitleSave?: (title: string) => void;
  onBeatSave?: (beat: string | null) => void;
  onDurationSave?: (duration: number) => void;
  onDelete?: () => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingBeat, setEditingBeat] = useState(false);
  const [editingDuration, setEditingDuration] = useState(false);
  const [titleDraft, setTitleDraft] = useState(shot.title);
  const [beatDraft, setBeatDraft] = useState(shot.beat || "");
  const [durationDraft, setDurationDraft] = useState(shot.duration);

  useEffect(() => { setTitleDraft(shot.title); setEditingTitle(false); }, [shot.id, shot.title]);
  useEffect(() => { setBeatDraft(shot.beat || ""); setEditingBeat(false); }, [shot.id, shot.beat]);
  useEffect(() => { setDurationDraft(shot.duration); setEditingDuration(false); }, [shot.id, shot.duration]);

  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="flex items-baseline gap-2 min-w-0 flex-1">
        <span className="section-label muted">Shot · {String(shot.idx).padStart(2, "0")}</span>

        {editingTitle && onTitleSave ? (
          <input
            value={titleDraft}
            autoFocus
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => { onTitleSave(titleDraft.trim() || shot.title); setEditingTitle(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { onTitleSave(titleDraft.trim() || shot.title); setEditingTitle(false); }
              if (e.key === "Escape") { setTitleDraft(shot.title); setEditingTitle(false); }
            }}
            className="editorial-display min-w-0 flex-1 truncate border-b border-[hsl(var(--design-accent))] bg-transparent text-[22px] leading-none outline-none focus:ring-0"
          />
        ) : (
          <h2
            onClick={() => onTitleSave && setEditingTitle(true)}
            className={cn(
              "editorial-display truncate text-[22px] leading-none",
              onTitleSave && "cursor-text rounded-sm transition-colors hover:bg-[hsl(var(--design-accent-soft))]/40",
            )}
            title={onTitleSave ? "Click to rename" : undefined}
          >
            {shot.title}
          </h2>
        )}

        {editingBeat && onBeatSave ? (
          <input
            value={beatDraft}
            autoFocus
            onChange={(e) => setBeatDraft(e.target.value)}
            onBlur={() => { onBeatSave(beatDraft.trim() || null); setEditingBeat(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { onBeatSave(beatDraft.trim() || null); setEditingBeat(false); }
              if (e.key === "Escape") { setBeatDraft(shot.beat || ""); setEditingBeat(false); }
            }}
            placeholder="Beat"
            className="w-24 border-b border-[hsl(var(--design-accent))] bg-transparent text-[12px] text-muted-foreground outline-none focus:ring-0"
          />
        ) : (
          <button
            onClick={() => onBeatSave && setEditingBeat(true)}
            className={cn(
              "text-[12px] text-muted-foreground whitespace-nowrap",
              onBeatSave && "cursor-text rounded-sm hover:text-foreground",
            )}
            title={onBeatSave ? "Click to set beat" : undefined}
          >
            {shot.beat ? `· ${shot.beat}` : <span className="italic">+ add beat</span>}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-baseline gap-1">
          {editingDuration && onDurationSave ? (
            <input
              type="number"
              step="0.5"
              min="0.5"
              max="30"
              value={durationDraft}
              autoFocus
              onChange={(e) => setDurationDraft(parseFloat(e.target.value) || 0)}
              onBlur={() => {
                if (durationDraft > 0 && durationDraft <= 30) onDurationSave(durationDraft);
                setEditingDuration(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (durationDraft > 0 && durationDraft <= 30) onDurationSave(durationDraft);
                  setEditingDuration(false);
                }
                if (e.key === "Escape") { setDurationDraft(shot.duration); setEditingDuration(false); }
              }}
              className="editorial-numeric w-14 border-b border-[hsl(var(--design-accent))] bg-transparent text-[14px] leading-none outline-none focus:ring-0"
            />
          ) : (
            <button
              onClick={() => onDurationSave && setEditingDuration(true)}
              className={cn(
                "editorial-numeric text-[14px] leading-none",
                onDurationSave && "cursor-text rounded-sm hover:bg-[hsl(var(--design-accent-soft))]/40",
              )}
              title={onDurationSave ? "Click to edit duration" : undefined}
            >
              {shot.duration.toFixed(1)}s
            </button>
          )}
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[11px] text-muted-foreground">v{shot.versions.length || 0}</span>
        </div>
        {shot.onBrand ? (
          <span className="pill pill-success">
            <BadgeCheck className="h-3 w-3" /> On brand
          </span>
        ) : (
          <span className="pill pill-warning">
            <AlertTriangle className="h-3 w-3" /> Drift
          </span>
        )}
        {onDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-full p-1 text-muted-foreground hover:bg-[hsl(var(--design-border))]/40 hover:text-foreground" title="More">
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={onDelete} className="text-xs gap-2 text-[hsl(var(--design-danger))]">
                <Trash2 className="h-3 w-3" />
                Delete shot
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

function ShotPreview({ shot, status }: { shot: DesignShot; status: { label: string; className: string } }) {
  const hue = shot.thumbHue ?? 215;
  const currentVersion = shot.versions.find((v) => v.id === shot.currentVersionId) || shot.versions[shot.versions.length - 1];
  const hasAsset = currentVersion?.assetUrl;
  const isVideo = currentVersion?.assetType === "video" || currentVersion?.assetType === "artlist_video";

  return (
    <div
      className={cn(
        "relative flex-1 overflow-hidden rounded-xl",
        !hasAsset && "thumb thumb-stripe",
        hasAsset && "bg-black",
      )}
      style={{ ['--th' as any]: String(hue), minHeight: 320, aspectRatio: "16/9" }}
    >
      {/* Real asset render */}
      {hasAsset && isVideo && (
        <video src={currentVersion!.assetUrl!} controls className="h-full w-full object-contain" />
      )}
      {hasAsset && !isVideo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={currentVersion!.assetUrl!} alt={shot.title} className="h-full w-full object-contain" />
      )}

      {/* Safe area guides — only show on placeholder/video */}
      {!hasAsset && (
        <>
          <div className="pointer-events-none absolute inset-[5%] border border-dashed border-white/20" />
          <div className="pointer-events-none absolute inset-[12%] border border-dashed border-white/10" />
        </>
      )}

      {shot.status === "generating" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 backdrop-blur-sm">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <div className="text-[11px] font-mono uppercase tracking-wider text-white/90">
            {DESIGN_MODELS.find((m) => m.id === shot.modelId)?.name || "Generating"} · streaming
          </div>
          <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-white/15">
            <div className="anim-shimmer h-full w-3/5" />
          </div>
        </div>
      ) : !hasAsset ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-white/85">
          <div className="text-[10.5px] font-mono tracking-wider opacity-80">
            SHOT {String(shot.idx).padStart(2, "0")}{shot.beat ? ` · ${shot.beat.toUpperCase()}` : ""}
          </div>
          <div className="editorial-display mt-1 px-6 text-[20px] text-white">{shot.title}</div>
          {shot.thumbLabel && (
            <div className="mt-2 text-[10px] font-mono opacity-70">{shot.thumbLabel}</div>
          )}
        </div>
      ) : null}

      {/* Top-left status pill */}
      <span className={cn("pill", status.className, "absolute left-3 top-3")}>{status.label}</span>

      {/* Top-right format chips */}
      {!hasAsset && (
        <div className="absolute right-3 top-3 flex gap-1">
          {["16:9", "9:16", "1:1"].map((f) => (
            <span key={f} className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[9px] text-white/80 backdrop-blur">{f}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function Transport({ playing, onToggle, duration }: { playing: boolean; onToggle: () => void; duration: number }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-[hsl(var(--design-bg-elev))] px-3 py-1.5"
         style={{ borderColor: "hsl(var(--design-border))" }}>
      <button className="rounded p-1 hover:bg-[hsl(var(--design-border))]/40" aria-label="Previous">
        <SkipBack className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onToggle}
        className="rounded-full p-1.5 text-white"
        style={{ background: "hsl(var(--design-fg))" }}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <button className="rounded p-1 hover:bg-[hsl(var(--design-border))]/40" aria-label="Next">
        <SkipForward className="h-3.5 w-3.5" />
      </button>
      {/* Scrubber */}
      <div className="relative ml-1 h-2 flex-1 rounded-full" style={{ background: "hsl(var(--design-border))" }}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: "14%", background: "hsl(var(--design-accent))" }} />
        <div
          className="absolute -top-1 h-4 w-4 rounded-full border-2 border-white shadow"
          style={{ left: "14%", transform: "translateX(-50%)", background: "hsl(var(--design-accent))" }}
        />
      </div>
      <div className="ml-2 font-mono text-[10px] text-muted-foreground tabular-nums">
        0:01.20 / 0:{String(Math.floor(duration)).padStart(2, "0")}.{String(Math.round((duration % 1) * 100)).padStart(2, "0")}
      </div>
    </div>
  );
}

function VersionsStrip({ versions, current, onSelect, onOpenDetail, onVary, onCompare }: { versions: DesignShot["versions"]; current: string | null; onSelect: (id: string) => void; onOpenDetail: (id: string) => void; onVary: () => void; onCompare?: () => void }) {
  if (versions.length === 0) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-dashed p-2 text-[10.5px] text-muted-foreground"
           style={{ borderColor: "hsl(var(--design-border-strong))" }}>
        No versions yet — Generate to create v1.
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto rounded-lg border bg-[hsl(var(--design-bg-elev))] p-1.5"
         style={{ borderColor: "hsl(var(--design-border))" }}>
      {versions.map((v) => {
        const isVideo = v.assetType === "video" || v.assetType === "artlist_video";
        const isActive = v.id === current;
        return (
          <div
            key={v.id}
            className={cn(
              "group relative flex h-12 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded transition-transform hover:scale-105",
              !v.assetUrl && "thumb thumb-stripe",
              isActive && "ring-2 ring-offset-1",
            )}
            style={{
              ['--th' as any]: String(((v.idx * 37) % 360)),
              ...(isActive ? { ['--tw-ring-color' as any]: "hsl(var(--design-accent))" } : {}),
            }}
          >
            <button
              onClick={() => onSelect(v.id)}
              onDoubleClick={() => onOpenDetail(v.id)}
              className="block h-full w-full"
              title={`${isActive ? "Current · " : ""}Click to select · Double-click to expand`}
            >
              {v.assetUrl && !isVideo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.assetUrl} alt={`v${v.idx}`} className="h-full w-full object-cover" />
              )}
              {v.assetUrl && isVideo && (
                <video src={v.assetUrl} className="h-full w-full object-cover" muted />
              )}
            </button>
            <span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 font-mono text-[9px] text-white/95">
              v{v.idx}
            </span>
            {/* Hover-only expand button */}
            <button
              onClick={(e) => { e.stopPropagation(); onOpenDetail(v.id); }}
              className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
              title="Open detail"
            >
              <Plus className="h-2.5 w-2.5" />
            </button>
          </div>
        );
      })}
      <button
        onClick={onVary}
        className="flex h-12 flex-shrink-0 items-center justify-center gap-1 rounded border border-dashed px-3 text-[10.5px] font-medium text-muted-foreground transition-colors hover:border-[hsl(var(--design-accent))] hover:text-[hsl(var(--design-accent))]"
        style={{ borderColor: "hsl(var(--design-border-strong))" }}
        title="Generate a new variation"
      >
        <Wand2 className="h-3 w-3" />
        Vary
      </button>
      {onCompare && (
        <button
          onClick={onCompare}
          className="flex h-12 flex-shrink-0 items-center justify-center gap-1 rounded border px-3 text-[10.5px] font-medium text-muted-foreground transition-colors hover:border-[hsl(var(--design-accent))] hover:text-[hsl(var(--design-accent))]"
          style={{ borderColor: "hsl(var(--design-border))" }}
          title="Compare two versions side by side"
        >
          <Columns2 className="h-3 w-3" />
          Compare
        </button>
      )}
    </div>
  );
}

const FORMAT_LABELS: Record<string, string> = {
  "16:9": "Landscape",
  "9:16": "Story",
  "1:1": "Square",
  "4:5": "Feed",
};

function FormatChip({ ratio, active, onClick }: { ratio: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={FORMAT_LABELS[ratio]}
      className={cn(
        "flex flex-col items-center gap-0 rounded-md border px-2 py-1 transition-colors",
        active
          ? "border-[hsl(var(--design-accent))] bg-[hsl(var(--design-accent-soft))] text-[hsl(var(--design-accent))]"
          : "border-[hsl(var(--design-border))] bg-[hsl(var(--design-bg-elev))] text-foreground hover:border-[hsl(var(--design-accent))]/40",
      )}
    >
      <span className="text-[10px] font-medium leading-none">{FORMAT_LABELS[ratio] || ratio}</span>
      <span className="font-mono text-[9px] opacity-60">{ratio}</span>
    </button>
  );
}

function ModelPicker({ activeId, onPick, onClose }: { activeId: string; onPick: (id: string) => void; onClose: () => void }) {
  // Group models into Video / Image / Coming soon to reduce overwhelm
  const videoModels = DESIGN_MODELS.filter((m) => (m.provider === "runway") && m.status === "live");
  const imageModels = DESIGN_MODELS.filter((m) => (m.provider === "openai-image" || m.provider === "xai-image") && m.status === "live");
  const comingSoon = DESIGN_MODELS.filter((m) => m.status === "coming-soon");

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className="absolute right-0 top-full z-40 mt-1 w-[340px] overflow-hidden rounded-lg border bg-[hsl(var(--design-bg-elev))] shadow-lg"
        style={{ borderColor: "hsl(var(--design-border))", boxShadow: "var(--shadow-pop)" }}
      >
        <div className="max-h-[440px] overflow-y-auto">
          <ModelGroup label="Video" models={videoModels} activeId={activeId} onPick={onPick} />
          <ModelGroup label="Image" models={imageModels} activeId={activeId} onPick={onPick} />
          {comingSoon.length > 0 && (
            <ModelGroup label="Coming soon" models={comingSoon} activeId={activeId} onPick={onPick} muted />
          )}
        </div>
      </div>
    </>
  );
}

function ModelGroup({
  label, models, activeId, onPick, muted,
}: {
  label: string;
  models: typeof DESIGN_MODELS;
  activeId: string;
  onPick: (id: string) => void;
  muted?: boolean;
}) {
  if (models.length === 0) return null;
  return (
    <div>
      <div className="sticky top-0 z-10 border-b bg-[hsl(var(--design-bg-elev))] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
           style={{ borderColor: "hsl(var(--design-border))" }}>
        {label}
      </div>
      <ul>
        {models.map((m) => {
          const active = m.id === activeId;
          const live = m.status === "live";
          return (
            <li key={m.id}>
              <button
                onClick={() => live && onPick(m.id)}
                disabled={!live}
                className={cn(
                  "flex w-full items-center gap-2 border-b px-3 py-2 text-left transition-colors",
                  active && "bg-[hsl(var(--design-accent-soft))]",
                  muted && "opacity-60",
                  live && "hover:bg-[hsl(var(--design-accent-soft))]/60",
                )}
                style={{ borderColor: "hsl(var(--design-border))" }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12.5px] font-semibold">{m.name}</span>
                    {!live && <span className="pill pill-neutral">soon</span>}
                  </div>
                  <div className="mt-0.5 line-clamp-1 text-[10.5px] text-muted-foreground">{m.tag}</div>
                </div>
                {active && <Check className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "hsl(var(--design-accent))" }} />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
