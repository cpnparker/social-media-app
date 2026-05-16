"use client";

import { useState, useEffect } from "react";
import { Play, Pause, SkipBack, SkipForward, ChevronDown, Upload, Sparkles, Check, AlertTriangle, BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DesignShot } from "@/lib/design/types";
import { DESIGN_MODELS } from "@/lib/design/types";

interface CanvasStageProps {
  shot: DesignShot | null;
  onRegenerate: () => void;
  onCommit: () => void;
  onModelChange: (modelId: string) => void;
  onPromptSave: (prompt: string) => void;
  onFormatChange: (ratio: string) => void;
  activeFormat?: string;
  generating?: boolean;
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
  onRegenerate,
  onCommit,
  onModelChange,
  onPromptSave,
  onFormatChange,
  activeFormat = "16:9",
  generating = false,
}: CanvasStageProps) {
  const [playing, setPlaying] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState(shot?.prompt || "");

  // Reset prompt draft when the shot changes
  useEffect(() => {
    setPromptDraft(shot?.prompt || "");
    setEditingPrompt(false);
  }, [shot?.id, shot?.prompt]);

  if (!shot) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Sparkles className="h-7 w-7" style={{ color: "hsl(var(--design-accent))" }} />
        <h3 className="editorial-display text-xl">A blank stage.</h3>
        <p className="max-w-sm text-[12.5px] text-muted-foreground">
          Add a shot from the timeline or ask Engine AI to propose directions for this brief.
        </p>
      </div>
    );
  }

  const statusInfo = STATUS_PILL[shot.status] || STATUS_PILL.queued;
  const currentModel = DESIGN_MODELS.find((m) => m.id === shot.modelId) || DESIGN_MODELS[1];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* Top meta strip */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="section-label muted">Shot · {String(shot.idx).padStart(2, "0")}</span>
          <h2 className="editorial-display truncate text-[22px] leading-none">{shot.title}</h2>
          {shot.beat && <span className="text-[12px] text-muted-foreground whitespace-nowrap">· {shot.beat}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="editorial-numeric text-[14px] leading-none">{shot.duration.toFixed(1)}s</span>
          <span className="text-[10px] text-muted-foreground">/</span>
          <span className="text-[11px]">v{shot.versions.length || 1} of {shot.versions.length || 1}</span>
          {shot.onBrand ? (
            <span className="pill pill-success ml-2">
              <BadgeCheck className="h-3 w-3" /> On brand
            </span>
          ) : (
            <span className="pill pill-warning ml-2">
              <AlertTriangle className="h-3 w-3" /> Drift
            </span>
          )}
        </div>
      </div>

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
          <VersionsStrip versions={shot.versions} current={shot.currentVersionId} onVary={() => {}} />
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
                className="cursor-text rounded-lg border p-2.5 font-mono text-[11px] leading-relaxed hover:border-[hsl(var(--design-accent))]/40"
                style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg))" }}
              >
                {shot.prompt || <span className="italic text-muted-foreground">Click to add a prompt</span>}
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
                  <div key={r.id} className="relative aspect-square overflow-hidden rounded-md border"
                       style={{ borderColor: "hsl(var(--design-border))" }}>
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={r.caption || ""} className="h-full w-full object-cover" />
                    ) : (
                      <div className="thumb thumb-stripe h-full w-full" style={{ ['--th' as any]: "30" }} />
                    )}
                    {r.seedLocked && (
                      <span className="absolute right-0.5 top-0.5 rounded bg-[hsl(var(--design-pin))] px-1 text-[9px] font-bold text-white">S</span>
                    )}
                  </div>
                );
              })}
              {/* Upload affordance */}
              <button className="flex aspect-square items-center justify-center rounded-md border border-dashed text-muted-foreground hover:text-foreground hover:border-[hsl(var(--design-accent))]"
                      style={{ borderColor: "hsl(var(--design-border-strong))" }}
                      title="Upload reference">
                <Upload className="h-3.5 w-3.5" />
              </button>
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
              disabled={generating || !shot.prompt?.trim()}
              className="mt-2 w-full rounded-lg bg-[hsl(var(--design-accent))] px-3 py-2 text-[12px] font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
            >
              {generating ? "Generating…" : shot.versions.length === 0 ? "Generate · v1" : "Regenerate · new version"}
            </button>
            <button
              onClick={onCommit}
              className="w-full rounded-lg border px-3 py-2 text-[12px] font-medium hover:bg-[hsl(var(--design-bg))]"
              style={{ borderColor: "hsl(var(--design-border))" }}
            >
              Commit to timeline
            </button>
          </div>
        </aside>
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

function VersionsStrip({ versions, current, onVary }: { versions: DesignShot["versions"]; current: string | null; onVary: () => void }) {
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
              "relative flex h-12 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded",
              !v.assetUrl && "thumb thumb-stripe",
              isActive && "ring-2 ring-offset-1",
            )}
            style={{
              ['--th' as any]: String(((v.idx * 37) % 360)),
              ...(isActive ? { ['--tw-ring-color' as any]: "hsl(var(--design-accent))" } : {}),
            }}
            title={v.promptUsed || `v${v.idx}`}
          >
            {v.assetUrl && !isVideo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.assetUrl} alt={`v${v.idx}`} className="h-full w-full object-cover" />
            )}
            {v.assetUrl && isVideo && (
              <video src={v.assetUrl} className="h-full w-full object-cover" muted />
            )}
            <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 font-mono text-[9px] text-white/95">
              v{v.idx}
            </span>
          </div>
        );
      })}
      <button
        onClick={onVary}
        className="flex h-12 flex-shrink-0 items-center justify-center rounded border border-dashed px-3 text-[10.5px] font-medium text-muted-foreground hover:text-foreground"
        style={{ borderColor: "hsl(var(--design-border-strong))" }}
      >
        + VARY
      </button>
    </div>
  );
}

function FormatChip({ ratio, active, onClick }: { ratio: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[10.5px] font-medium",
        active
          ? "border-[hsl(var(--design-accent))] bg-[hsl(var(--design-accent-soft))] text-[hsl(var(--design-accent))]"
          : "border-[hsl(var(--design-border))] bg-[hsl(var(--design-bg-elev))] text-foreground hover:border-[hsl(var(--design-accent))]/40",
      )}
    >
      {ratio}
    </button>
  );
}

function ModelPicker({ activeId, onPick, onClose }: { activeId: string; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className="absolute right-0 top-full z-40 mt-1 w-[340px] overflow-hidden rounded-lg border bg-[hsl(var(--design-bg-elev))] shadow-lg"
        style={{ borderColor: "hsl(var(--design-border))", boxShadow: "var(--shadow-pop)" }}
      >
        <div className="border-b px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground"
             style={{ borderColor: "hsl(var(--design-border))" }}>
          Pick a generator
        </div>
        <ul className="max-h-[360px] overflow-y-auto">
          {DESIGN_MODELS.map((m) => {
            const active = m.id === activeId;
            const live = m.status === "live";
            return (
              <li key={m.id}>
                <button
                  onClick={() => live && onPick(m.id)}
                  disabled={!live}
                  className={cn(
                    "flex w-full items-start gap-2 border-b px-3 py-2 text-left transition-colors",
                    active && "bg-[hsl(var(--design-accent-soft))]",
                    !live && "opacity-50",
                    live && "hover:bg-[hsl(var(--design-accent-soft))]/60",
                  )}
                  style={{ borderColor: "hsl(var(--design-border))" }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12.5px] font-semibold">{m.name}</span>
                      {!live && <span className="pill pill-neutral">soon</span>}
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-muted-foreground">{m.tag}</div>
                    <div className="mt-0.5 text-[10px] italic text-muted-foreground">
                      <span style={{ color: "hsl(var(--design-success))" }}>{m.strength}</span>
                      <span className="mx-1">·</span>
                      <span style={{ color: "hsl(var(--design-warning))" }}>{m.weakness}</span>
                    </div>
                  </div>
                  {active && <Check className="h-3.5 w-3.5 mt-0.5" style={{ color: "hsl(var(--design-accent))" }} />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
