"use client";

import { useMemo } from "react";
import { Plus, AlertTriangle, BadgeCheck, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DesignShot } from "@/lib/design/types";

interface StoryboardTimelineProps {
  shots: DesignShot[];
  currentShotId: string | null;
  onSelectShot: (id: string) => void;
  onAddShot?: () => void;
}

/**
 * Storyboard view — horizontal row of shot cards, grouped by beat.
 * Much simpler than the Premiere-style Tracks view; the default for new
 * sessions.
 */
export function StoryboardTimeline({ shots, currentShotId, onSelectShot, onAddShot }: StoryboardTimelineProps) {
  const totalDuration = useMemo(() => shots.reduce((a, s) => a + s.duration, 0), [shots]);

  // Group by beat — preserves shot.idx order
  const beatGroups = useMemo(() => {
    const groups: Array<{ beat: string | null; shots: DesignShot[] }> = [];
    for (const s of shots) {
      const last = groups[groups.length - 1];
      if (last && last.beat === (s.beat || null)) last.shots.push(s);
      else groups.push({ beat: s.beat || null, shots: [s] });
    }
    return groups;
  }, [shots]);

  if (shots.length === 0) {
    return (
      <section
        className="flex h-full flex-col items-center justify-center gap-3 border-t p-6 text-center"
        style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg-elev))" }}
      >
        <div className="section-label">Storyboard</div>
        <p className="max-w-xs text-[12.5px] text-muted-foreground">
          Your first shot starts the storyboard. Tap below to add one.
        </p>
        {onAddShot && (
          <button
            onClick={onAddShot}
            className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--design-accent))] px-4 py-1.5 text-[12px] font-medium text-white shadow-sm hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> Add your first shot
          </button>
        )}
      </section>
    );
  }

  return (
    <section
      className="flex h-full flex-col border-t"
      style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg-elev))" }}
    >
      {/* Head — minimal */}
      <div className="flex items-baseline justify-between border-b px-4 py-2"
           style={{ borderColor: "hsl(var(--design-border))" }}>
        <div className="flex items-baseline gap-2">
          <span className="section-label">Storyboard</span>
          <span className="text-[11px] text-muted-foreground">
            <span className="editorial-numeric text-foreground">{shots.length}</span>
            {" "}{shots.length === 1 ? "shot" : "shots"}
            {" · "}
            <span className="editorial-numeric text-foreground">{totalDuration.toFixed(0)}</span>s
          </span>
        </div>
      </div>

      {/* Strip */}
      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex h-full items-stretch gap-2.5">
          {beatGroups.map((g, gi) => (
            <div key={gi} className="flex items-stretch gap-2.5">
              {g.beat && (
                <div className="flex flex-col items-center justify-center px-1">
                  <div className="text-[9px] font-semibold uppercase tracking-wider"
                       style={{ color: "hsl(var(--design-accent))" }}>
                    {g.beat}
                  </div>
                  <div className="h-full w-px bg-[hsl(var(--design-border))] mt-1" />
                </div>
              )}
              {g.shots.map((s) => (
                <ShotCard
                  key={s.id}
                  shot={s}
                  active={s.id === currentShotId}
                  onClick={() => onSelectShot(s.id)}
                />
              ))}
            </div>
          ))}
          {/* Add shot affordance */}
          {onAddShot && (
            <button
              onClick={onAddShot}
              className="flex h-full min-h-[150px] w-[148px] flex-shrink-0 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-muted-foreground transition-colors hover:border-[hsl(var(--design-accent))] hover:text-[hsl(var(--design-accent))]"
              style={{ borderColor: "hsl(var(--design-border-strong))" }}
            >
              <Plus className="h-5 w-5" />
              <span className="text-[11px] font-medium">Add shot</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function ShotCard({ shot, active, onClick }: { shot: DesignShot; active: boolean; onClick: () => void }) {
  const current = shot.versions.find((v) => v.id === shot.currentVersionId) || shot.versions[shot.versions.length - 1];
  const hasAsset = !!current?.assetUrl;
  const isVideo = current?.assetType === "video" || current?.assetType === "artlist_video";
  const hue = shot.thumbHue ?? 215;

  return (
    <button
      onClick={onClick}
      className={cn(
        "design-tile group relative flex w-[180px] flex-shrink-0 flex-col overflow-hidden rounded-xl border bg-[hsl(var(--design-card))] text-left transition-all",
        active && "ring-2 ring-offset-2",
      )}
      style={{
        borderColor: active ? "hsl(var(--design-accent))" : "hsl(var(--design-border))",
        ...(active ? { ['--tw-ring-color' as any]: "hsl(var(--design-accent))" } : {}),
      }}
    >
      {/* Thumb */}
      <div className={cn(
        "relative aspect-video w-full overflow-hidden",
        !hasAsset && "thumb thumb-stripe",
      )}
      style={{ ['--th' as any]: String(hue) }}
      >
        {hasAsset && isVideo && (
          <video src={current!.assetUrl!} className="h-full w-full object-cover" muted loop
                 onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                 onMouseLeave={(e) => { (e.currentTarget as HTMLVideoElement).pause(); (e.currentTarget as HTMLVideoElement).currentTime = 0; }} />
        )}
        {hasAsset && !isVideo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current!.assetUrl!} alt={shot.title} className="h-full w-full object-cover" />
        )}
        {!hasAsset && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-white/80">
            <span className="font-mono text-[9px] tracking-wider">S{String(shot.idx).padStart(2, "0")}</span>
            <span className="px-3 text-center text-[10px]">{shot.title}</span>
          </div>
        )}

        {/* Status dot — top left */}
        <span
          className="absolute left-2 top-2 h-2 w-2 rounded-full ring-2 ring-white/80"
          style={{ background: statusColor(shot.status) }}
          title={shot.status}
        />

        {/* Drift warning */}
        {!shot.onBrand && (
          <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-full bg-[hsl(var(--design-warning))] px-1.5 py-0.5 text-[9px] font-semibold text-white">
            <AlertTriangle className="h-2.5 w-2.5" />
            drift
          </div>
        )}

        {/* On-brand check */}
        {shot.onBrand && shot.status === "approved" && (
          <div className="absolute right-2 top-2 rounded-full bg-[hsl(var(--design-success))]/95 p-1 text-white">
            <BadgeCheck className="h-2.5 w-2.5" />
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="space-y-0.5 px-2.5 pb-2 pt-1.5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="font-mono">S{String(shot.idx).padStart(2, "0")}</span>
          <span className="inline-flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            <span className="editorial-numeric">{shot.duration.toFixed(1)}</span>s
          </span>
        </div>
        <div className="line-clamp-1 text-[12px] font-medium leading-tight">{shot.title}</div>
        <div className="line-clamp-1 text-[10px] text-muted-foreground">
          v{shot.versions.length || 0} · {shot.modelId || "no model"}
        </div>
      </div>
    </button>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "approved":   return "hsl(var(--design-success))";
    case "generating": return "hsl(var(--design-accent))";
    case "review":     return "hsl(var(--design-warning))";
    case "drift":      return "hsl(var(--design-danger))";
    default:           return "hsl(var(--design-muted-strong))";
  }
}
