"use client";

import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { X, Star, BadgeCheck, AlertTriangle, ArrowLeftRight, Eye, Columns2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DesignShot, DesignShotVersion } from "@/lib/design/types";
import { DESIGN_MODELS, LEGACY_MODEL_ALIASES } from "@/lib/design/types";

interface VersionCompareDialogProps {
  open: boolean;
  onClose: () => void;
  shot: DesignShot;
  /** Optional initial left version id; defaults to first version. */
  initialLeftId?: string | null;
  /** Optional initial right version id; defaults to current (or last) version. */
  initialRightId?: string | null;
  /** "Set as current" — only callable on the side currently focused. */
  onSetCurrent?: (versionId: string) => void;
}

type ViewMode = "side-by-side" | "swipe";

/**
 * Two-version comparison view.
 *
 *   Side-by-side  — two columns, both versions playing in sync.
 *   Swipe          — single frame, a drag-handle reveals the right half
 *                    over the left. Lighter for spotting palette / lighting
 *                    differences in stills.
 *
 * The dropdowns at the top let designers pin any two versions to compare;
 * the metadata strip diff highlights what actually changed between them
 * (model, prompt, format, brand-check delta).
 */
export function VersionCompareDialog({
  open,
  onClose,
  shot,
  initialLeftId,
  initialRightId,
  onSetCurrent,
}: VersionCompareDialogProps) {
  // Pick sane defaults: oldest version vs. current (or latest)
  const versions = shot.versions;
  const defaultRight = shot.currentVersionId || versions[versions.length - 1]?.id || null;
  const defaultLeft = (() => {
    if (initialLeftId) return initialLeftId;
    // Pick the version BEFORE the current one if possible — that's the natural diff.
    const curIdx = versions.findIndex((v) => v.id === defaultRight);
    if (curIdx > 0) return versions[curIdx - 1].id;
    return versions[0]?.id || null;
  })();

  const [leftId, setLeftId] = useState<string | null>(initialLeftId || defaultLeft);
  const [rightId, setRightId] = useState<string | null>(initialRightId || defaultRight);
  const [view, setView] = useState<ViewMode>("side-by-side");
  const [swipePct, setSwipePct] = useState(50); // 0..100

  useEffect(() => {
    // Re-anchor if the shot or its versions list changes underneath us.
    if (!open) return;
    if (!leftId || !versions.find((v) => v.id === leftId)) setLeftId(defaultLeft);
    if (!rightId || !versions.find((v) => v.id === rightId)) setRightId(defaultRight);
  }, [open, shot.id, versions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const left = useMemo(() => versions.find((v) => v.id === leftId) || null, [versions, leftId]);
  const right = useMemo(() => versions.find((v) => v.id === rightId) || null, [versions, rightId]);

  if (!open || versions.length < 2) return null;

  function swap() {
    setLeftId(rightId);
    setRightId(leftId);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="design-mode max-w-[1280px] gap-0 overflow-hidden border p-0"
        style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg))" }}
      >
        <DialogTitle className="sr-only">Compare versions for {shot.title}</DialogTitle>
        <DialogDescription className="sr-only">
          Side-by-side or swipe comparison of two versions of shot {shot.idx}.
        </DialogDescription>
        {/* Header — shot title + view mode toggle */}
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3"
                style={{ borderColor: "hsl(var(--design-border))" }}>
          <div className="min-w-0 flex-1">
            <div className="section-label muted">Compare · Shot {String(shot.idx).padStart(2, "0")}</div>
            <h2 className="editorial-display truncate text-[18px] leading-tight">{shot.title}</h2>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setView("side-by-side")}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium",
                view === "side-by-side"
                  ? "border-[hsl(var(--design-accent))] bg-[hsl(var(--design-accent-soft))] text-[hsl(var(--design-accent))]"
                  : "border-[hsl(var(--design-border))] hover:bg-[hsl(var(--design-bg-elev))]",
              )}
            >
              <Columns2 className="h-3 w-3" /> Side-by-side
            </button>
            <button
              onClick={() => setView("swipe")}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium",
                view === "swipe"
                  ? "border-[hsl(var(--design-accent))] bg-[hsl(var(--design-accent-soft))] text-[hsl(var(--design-accent))]"
                  : "border-[hsl(var(--design-border))] hover:bg-[hsl(var(--design-bg-elev))]",
              )}
            >
              <Eye className="h-3 w-3" /> Swipe
            </button>
            <button
              onClick={swap}
              title="Swap"
              className="ml-1 rounded-md border p-1 text-muted-foreground transition-colors hover:bg-[hsl(var(--design-bg-elev))] hover:text-foreground"
              style={{ borderColor: "hsl(var(--design-border))" }}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onClose}
              className="ml-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-[hsl(var(--design-bg-elev))] hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Version pickers + previews */}
        <div className="grid grid-cols-2 gap-0">
          {/* Left column */}
          <VersionPickerColumn
            label="A"
            shot={shot}
            currentId={leftId}
            other={rightId}
            onPick={setLeftId}
            onSetCurrent={onSetCurrent}
            isCurrent={left?.id === shot.currentVersionId}
            hidePreview={view === "swipe"}
          />
          {/* Right column */}
          <VersionPickerColumn
            label="B"
            shot={shot}
            currentId={rightId}
            other={leftId}
            onPick={setRightId}
            onSetCurrent={onSetCurrent}
            isCurrent={right?.id === shot.currentVersionId}
            hidePreview={view === "swipe"}
          />
        </div>

        {/* Swipe-mode single big preview */}
        {view === "swipe" && left && right && (
          <SwipeCompare leftVersion={left} rightVersion={right} pct={swipePct} onPct={setSwipePct} />
        )}

        {/* Diff strip — what changed between A and B */}
        {left && right && (
          <DiffStrip left={left} right={right} shot={shot} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Per-column header: picker dropdown + version preview (in side-by-side mode). */
function VersionPickerColumn({
  label,
  shot,
  currentId,
  other,
  onPick,
  onSetCurrent,
  isCurrent,
  hidePreview,
}: {
  label: string;
  shot: DesignShot;
  currentId: string | null;
  other: string | null;
  onPick: (id: string) => void;
  onSetCurrent?: (id: string) => void;
  isCurrent: boolean;
  hidePreview: boolean;
}) {
  const v = shot.versions.find((x) => x.id === currentId);
  const isVideo = v?.assetType === "video" || v?.assetType === "artlist_video";
  const resolvedModelId = v?.modelId ? (LEGACY_MODEL_ALIASES[v.modelId] || v.modelId) : null;
  const modelName = DESIGN_MODELS.find((m) => m.id === resolvedModelId)?.name || v?.modelId || "—";

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-r px-3 py-2"
           style={{ borderColor: "hsl(var(--design-border))" }}>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--design-fg))] font-mono text-[10px] font-bold text-white">
            {label}
          </span>
          <select
            value={currentId || ""}
            onChange={(e) => onPick(e.target.value)}
            className="rounded-md border bg-[hsl(var(--design-bg-elev))] px-2 py-1 text-[11.5px] font-medium focus:border-[hsl(var(--design-accent))] focus:outline-none"
            style={{ borderColor: "hsl(var(--design-border))" }}
          >
            {shot.versions.map((ver) => (
              <option key={ver.id} value={ver.id} disabled={ver.id === other}>
                v{ver.idx}
                {ver.id === shot.currentVersionId ? " · current" : ""}
                {ver.id === other ? " · in other side" : ""}
              </option>
            ))}
          </select>
          {isCurrent && (
            <span className="pill pill-accent">
              <Star className="h-3 w-3" /> Current
            </span>
          )}
        </div>
        {onSetCurrent && !isCurrent && currentId && (
          <button
            onClick={() => onSetCurrent(currentId)}
            className="text-[10.5px] underline"
            style={{ color: "hsl(var(--design-accent))" }}
            title="Promote this version to current"
          >
            Set as current
          </button>
        )}
      </div>
      {!hidePreview && (
        <div className="relative flex items-center justify-center border-r bg-black"
             style={{ borderColor: "hsl(var(--design-border))", minHeight: 360, maxHeight: "60vh" }}>
          {v?.assetUrl && isVideo ? (
            <video src={v.assetUrl} autoPlay loop muted controls className="max-h-[60vh] w-full object-contain" />
          ) : v?.assetUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.assetUrl} alt={`v${v.idx}`} className="max-h-[60vh] w-full object-contain" />
          ) : (
            <div className="thumb thumb-stripe h-72 w-full" />
          )}
          {/* Version chip */}
          <span className="absolute left-2 top-2 rounded bg-black/65 px-2 py-0.5 font-mono text-[10px] text-white backdrop-blur">
            v{v?.idx} · {modelName}
          </span>
        </div>
      )}
    </div>
  );
}

/** Swipe-mode: overlay right version on top of left, drag handle adjusts visible width. */
function SwipeCompare({
  leftVersion,
  rightVersion,
  pct,
  onPct,
}: {
  leftVersion: DesignShotVersion;
  rightVersion: DesignShotVersion;
  pct: number;
  onPct: (p: number) => void;
}) {
  const leftIsVideo = leftVersion.assetType === "video" || leftVersion.assetType === "artlist_video";
  const rightIsVideo = rightVersion.assetType === "video" || rightVersion.assetType === "artlist_video";

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    if (e.buttons !== 1) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    onPct(Math.max(0, Math.min(100, x)));
  }

  return (
    <div
      className="relative w-full overflow-hidden bg-black"
      style={{ minHeight: 480, maxHeight: "70vh", aspectRatio: "16/9" }}
      onMouseMove={onMove}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onPct(((e.clientX - rect.left) / rect.width) * 100);
      }}
    >
      {/* Left (base) */}
      <div className="absolute inset-0">
        {leftVersion.assetUrl && leftIsVideo ? (
          <video src={leftVersion.assetUrl} autoPlay loop muted className="h-full w-full object-contain" />
        ) : leftVersion.assetUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={leftVersion.assetUrl} alt={`v${leftVersion.idx}`} className="h-full w-full object-contain" />
        ) : null}
      </div>
      {/* Right (overlaid, clipped to pct from the left) */}
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 0 0 ${pct}%)` }}>
        {rightVersion.assetUrl && rightIsVideo ? (
          <video src={rightVersion.assetUrl} autoPlay loop muted className="h-full w-full object-contain" />
        ) : rightVersion.assetUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={rightVersion.assetUrl} alt={`v${rightVersion.idx}`} className="h-full w-full object-contain" />
        ) : null}
      </div>
      {/* Divider line + handle */}
      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-white shadow-[0_0_8px_rgba(0,0,0,0.5)]"
        style={{ left: `${pct}%` }}
      >
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[hsl(var(--design-accent))] shadow-lg"
             style={{ width: 30, height: 30 }}>
          <ArrowLeftRight className="absolute inset-0 m-auto h-3.5 w-3.5 text-white" />
        </div>
      </div>
      {/* Labels */}
      <span className="absolute left-3 top-3 rounded bg-black/65 px-2 py-0.5 font-mono text-[10px] text-white backdrop-blur">
        A · v{leftVersion.idx}
      </span>
      <span className="absolute right-3 top-3 rounded bg-black/65 px-2 py-0.5 font-mono text-[10px] text-white backdrop-blur">
        B · v{rightVersion.idx}
      </span>
    </div>
  );
}

/** What changed between A and B — shows the meaningful deltas. */
function DiffStrip({
  left, right, shot,
}: {
  left: DesignShotVersion;
  right: DesignShotVersion;
  shot: DesignShot;
}) {
  const leftModel = (left.modelId ? (LEGACY_MODEL_ALIASES[left.modelId] || left.modelId) : null);
  const rightModel = (right.modelId ? (LEGACY_MODEL_ALIASES[right.modelId] || right.modelId) : null);
  const leftModelName = DESIGN_MODELS.find((m) => m.id === leftModel)?.name || left.modelId || "—";
  const rightModelName = DESIGN_MODELS.find((m) => m.id === rightModel)?.name || right.modelId || "—";

  const leftBrandFails = brandFailures(left);
  const rightBrandFails = brandFailures(right);

  const promptChanged = (left.promptUsed || "").trim() !== (right.promptUsed || "").trim();

  const rows: { label: string; a: React.ReactNode; b: React.ReactNode; changed: boolean }[] = [
    {
      label: "Model",
      a: <span className="font-medium">{leftModelName}</span>,
      b: <span className="font-medium">{rightModelName}</span>,
      changed: leftModelName !== rightModelName,
    },
    {
      label: "Format",
      a: <span>{(left.metadata?.format || left.metadata?.ratio || "—") as React.ReactNode}</span>,
      b: <span>{(right.metadata?.format || right.metadata?.ratio || "—") as React.ReactNode}</span>,
      changed: (left.metadata?.format || left.metadata?.ratio) !== (right.metadata?.format || right.metadata?.ratio),
    },
    {
      label: "Duration",
      a: <span>{left.metadata?.duration_sec ? `${left.metadata.duration_sec}s` : "—"}</span>,
      b: <span>{right.metadata?.duration_sec ? `${right.metadata.duration_sec}s` : "—"}</span>,
      changed: left.metadata?.duration_sec !== right.metadata?.duration_sec,
    },
    {
      label: "Brand",
      a: brandPill(leftBrandFails),
      b: brandPill(rightBrandFails),
      changed: leftBrandFails.length !== rightBrandFails.length,
    },
    {
      label: "Created",
      a: <span className="text-[10.5px] text-muted-foreground">{new Date(left.createdAt).toLocaleString()}</span>,
      b: <span className="text-[10.5px] text-muted-foreground">{new Date(right.createdAt).toLocaleString()}</span>,
      changed: false,
    },
  ];

  return (
    <div className="border-t" style={{ borderColor: "hsl(var(--design-border))" }}>
      <div className="grid grid-cols-[88px_1fr_1fr] gap-0 text-[11.5px]">
        {rows.map((r) => (
          <div
            key={r.label}
            className={cn(
              "contents",
              r.changed && "[&>*]:bg-[hsl(var(--design-accent-soft))]/30",
            )}
          >
            <div className="border-r border-b px-3 py-1.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]"
                 style={{ borderColor: "hsl(var(--design-border))" }}>
              {r.label}
            </div>
            <div className="border-r border-b px-3 py-1.5"
                 style={{ borderColor: "hsl(var(--design-border))" }}>
              {r.a}
            </div>
            <div className="border-b px-3 py-1.5"
                 style={{ borderColor: "hsl(var(--design-border))" }}>
              {r.b}
            </div>
          </div>
        ))}
        {/* Prompt diff (full row) */}
        <div className="col-span-3 grid grid-cols-[88px_1fr_1fr] gap-0">
          <div className="border-r px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]"
               style={{ borderColor: "hsl(var(--design-border))" }}>
            Prompt
            {promptChanged && <div className="mt-0.5 font-mono text-[8px] normal-case tracking-normal text-[hsl(var(--design-accent))]">changed</div>}
          </div>
          <div className={cn(
            "border-r px-3 py-2 font-mono text-[10.5px] leading-relaxed",
            promptChanged && "bg-[hsl(var(--design-accent-soft))]/30",
          )} style={{ borderColor: "hsl(var(--design-border))" }}>
            {left.promptUsed || <span className="italic text-muted-foreground">No prompt recorded</span>}
          </div>
          <div className={cn(
            "px-3 py-2 font-mono text-[10.5px] leading-relaxed",
            promptChanged && "bg-[hsl(var(--design-accent-soft))]/30",
          )}>
            {right.promptUsed || <span className="italic text-muted-foreground">No prompt recorded</span>}
          </div>
        </div>
      </div>
      <div className="px-3 py-2 text-[10px] text-muted-foreground">
        {shot.versions.length} versions total. Comparing v{left.idx} → v{right.idx}.
      </div>
    </div>
  );
}

function brandFailures(v: DesignShotVersion): any[] {
  const arr = Array.isArray(v.metadata?.brand_check) ? v.metadata.brand_check : [];
  return arr.filter((c: any) => c?.status === "fail");
}

function brandPill(fails: any[]) {
  if (fails.length === 0) {
    return (
      <span className="pill pill-success">
        <BadgeCheck className="h-3 w-3" /> On brand
      </span>
    );
  }
  return (
    <span className="pill pill-warning">
      <AlertTriangle className="h-3 w-3" /> {fails.length} drift
    </span>
  );
}
