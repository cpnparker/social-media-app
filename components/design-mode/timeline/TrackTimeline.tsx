"use client";

import { useMemo } from "react";
import { Type, Layers, Mic, Music, Volume2, AlertTriangle, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DesignShot, DesignTrack } from "@/lib/design/types";

interface TrackTimelineProps {
  tracks: DesignTrack[];
  shots: DesignShot[];
  currentShotId: string | null;
  onSelectShot: (id: string) => void;
  onAddShot?: () => void;
}

const PIXELS_PER_SECOND = 24;
const TIMELINE_DURATION_SEC = 60;
const LEFT_GUTTER_PX = 120;
const PLAYHEAD_SEC = 18.2; // static for v2 ship; real scrubbing in a follow-up

const TRACK_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  title: Type,
  video: Layers,
  overlay: Layers,
  voice: Mic,
  music: Music,
  ambience: Volume2,
};

export function TrackTimeline({ tracks, shots, currentShotId, onSelectShot, onAddShot }: TrackTimelineProps) {
  // Build a fast lookup from shot id → shot, and from track id → shots in order
  const shotMap = useMemo(() => new Map(shots.map((s) => [s.id, s])), [shots]);
  const usedSec = useMemo(() => shots.reduce((a, s) => a + s.duration, 0), [shots]);

  // Compute clip placement per track. For the "video" track without explicit clips,
  // auto-place shots back-to-back as a visual default.
  const tracksWithComputedClips = useMemo(() => {
    return tracks.map((t) => {
      if (t.clips.length > 0) return t;
      if (t.kind === "video") {
        // Auto-place shots end-to-end
        let cursor = 0;
        const clips = shots.map((s) => {
          const clip = {
            id: `auto-${s.id}`,
            shotId: s.id,
            assetId: null,
            startSec: cursor,
            durationSec: s.duration,
            inOffsetSec: 0,
            outOffsetSec: 0,
            metadata: {},
          };
          cursor += s.duration;
          return clip;
        });
        return { ...t, clips };
      }
      return t;
    });
  }, [tracks, shots]);

  return (
    <section
      className="flex h-full flex-col border-t"
      style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg-elev))" }}
    >
      {/* Head */}
      <div className="flex items-center justify-between border-b px-3 py-2"
           style={{ borderColor: "hsl(var(--design-border))" }}>
        <div className="flex items-baseline gap-2">
          <span className="section-label">Timeline</span>
          <span className="text-[11px] text-muted-foreground">tracks · 24fps</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span><span className="editorial-numeric text-foreground">{usedSec.toFixed(1)}</span> of {TIMELINE_DURATION_SEC}s used</span>
          <div className="flex gap-1.5">
            <button className="rounded px-1.5 py-0.5 hover:bg-[hsl(var(--design-border))]/40">Split</button>
            <button className="rounded px-1.5 py-0.5 hover:bg-[hsl(var(--design-border))]/40">Track</button>
            <button className="rounded px-1.5 py-0.5 hover:bg-[hsl(var(--design-border))]/40">Snap</button>
            <span>{tracks.length} layers</span>
          </div>
        </div>
      </div>

      {/* Ruler */}
      <div className="flex border-b text-[9px] text-muted-foreground"
           style={{ borderColor: "hsl(var(--design-border))" }}>
        <div className="flex-shrink-0" style={{ width: LEFT_GUTTER_PX }} />
        <div className="relative h-5 flex-1 overflow-x-auto">
          <div className="relative h-full" style={{ width: TIMELINE_DURATION_SEC * PIXELS_PER_SECOND }}>
            {Array.from({ length: TIMELINE_DURATION_SEC + 1 }).map((_, sec) => (
              <div
                key={sec}
                className="absolute top-0 h-full"
                style={{ left: sec * PIXELS_PER_SECOND, width: 1 }}
              >
                <div className={cn("h-2 w-px", sec % 5 === 0 ? "bg-foreground/40" : "bg-foreground/15")} />
                {sec % 5 === 0 && (
                  <span className="absolute left-0 top-2 text-[9px] font-mono">{sec}s</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tracks */}
      <div className="flex-1 overflow-auto">
        <div className="relative">
          {tracksWithComputedClips.map((t) => (
            <TrackRow
              key={t.id}
              track={t}
              shotMap={shotMap}
              currentShotId={currentShotId}
              onSelectShot={onSelectShot}
            />
          ))}

          {/* Playhead (full-height amber pin) */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-px"
            style={{ left: LEFT_GUTTER_PX + PLAYHEAD_SEC * PIXELS_PER_SECOND, background: "hsl(var(--design-pin))" }}
          >
            <div
              className="absolute -top-1 -left-1.5 h-3 w-3 rotate-45"
              style={{ background: "hsl(var(--design-pin))" }}
            />
          </div>
        </div>
        {onAddShot && (
          <div className="border-t p-2" style={{ borderColor: "hsl(var(--design-border))" }}>
            <button
              onClick={onAddShot}
              className="inline-flex items-center gap-1 rounded-md border border-dashed px-2.5 py-1 text-[10.5px] font-medium text-muted-foreground hover:text-foreground hover:border-[hsl(var(--design-accent))]"
              style={{ borderColor: "hsl(var(--design-border-strong))" }}
            >
              <Plus className="h-3 w-3" /> Add shot
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function TrackRow({
  track,
  shotMap,
  currentShotId,
  onSelectShot,
}: {
  track: DesignTrack;
  shotMap: Map<string, DesignShot>;
  currentShotId: string | null;
  onSelectShot: (id: string) => void;
}) {
  const Icon = TRACK_ICON[track.kind] || Layers;
  const isPrimary = track.kind === "video";
  const isAudio = track.kind === "voice" || track.kind === "music" || track.kind === "ambience";
  const isTitles = track.kind === "title";
  const isOverlay = track.kind === "overlay";
  const rowHeight = isPrimary ? 56 : 36;

  return (
    <div
      className="relative flex border-b"
      style={{ borderColor: "hsl(var(--design-border))", height: rowHeight }}
    >
      {/* Label gutter */}
      <div
        className="flex flex-shrink-0 items-center gap-1.5 border-r px-2.5 text-[10.5px]"
        style={{ width: LEFT_GUTTER_PX, borderColor: "hsl(var(--design-border))", color: "hsl(var(--design-muted-strong))" }}
      >
        <Icon className="h-3 w-3 flex-shrink-0" />
        <span className="truncate font-medium">{track.label}</span>
      </div>

      {/* Lane */}
      <div className="relative flex-1 overflow-hidden">
        <div className="relative h-full" style={{ width: TIMELINE_DURATION_SEC * PIXELS_PER_SECOND }}>
          {track.clips.map((c) => {
            const shot = c.shotId ? shotMap.get(c.shotId) : null;
            const left = c.startSec * PIXELS_PER_SECOND;
            const width = c.durationSec * PIXELS_PER_SECOND;

            if (isTitles) {
              return (
                <ClipBox key={c.id} left={left} width={width} top={4} height={rowHeight - 8} style={{ background: "hsl(var(--design-accent-soft))", borderColor: "hsl(235 50% 80%)" }}>
                  <span className="editorial-display text-[11px]" style={{ color: "hsl(var(--design-accent))" }}>
                    {(c.metadata as any)?.text || "Title"}
                  </span>
                </ClipBox>
              );
            }
            if (isOverlay) {
              return (
                <ClipBox key={c.id} left={left} width={width} top={4} height={rowHeight - 8} style={{ background: "hsl(38 85% 88%)", borderColor: "hsl(35 70% 78%)" }}>
                  <span className="text-[10px] font-medium" style={{ color: "hsl(25 70% 35%)" }}>Overlay</span>
                </ClipBox>
              );
            }
            if (isAudio) {
              return (
                <ClipBox key={c.id} left={left} width={width} top={6} height={rowHeight - 12} style={{ background: "hsl(40 30% 92%)", borderColor: "hsl(36 25% 80%)" }}>
                  <AudioWaveform />
                </ClipBox>
              );
            }
            // Video shot clip — tinted gradient + status dot + alert
            const hue = shot?.thumbHue ?? 215;
            const isActive = shot?.id === currentShotId;
            return (
              <ClipBox
                key={c.id}
                left={left}
                width={width}
                top={6}
                height={rowHeight - 12}
                onClick={() => shot && onSelectShot(shot.id)}
                style={{
                  background: `linear-gradient(135deg, hsl(${hue} 40% 35%), hsl(${hue} 35% 18%))`,
                  borderColor: isActive ? "hsl(var(--design-accent))" : "transparent",
                  boxShadow: isActive ? "0 0 0 2px hsl(var(--design-accent))" : undefined,
                }}
              >
                <div className="absolute left-1.5 top-1 h-1.5 w-1.5 rounded-full"
                     style={{ background: statusColor(shot?.status) }}
                />
                {shot && !shot.onBrand && (
                  <div className="absolute right-1 top-1 rounded bg-[hsl(var(--design-warning))] px-1 py-0.5 text-[8px] font-bold text-white">
                    <AlertTriangle className="h-2 w-2" />
                  </div>
                )}
                {width > 60 && shot && (
                  <div className="flex h-full flex-col justify-between p-1.5 text-white/90">
                    <span className="font-mono text-[9px] opacity-80">S{String(shot.idx).padStart(2, "0")}</span>
                    <span className="line-clamp-1 text-[10px] font-semibold">{shot.title}</span>
                  </div>
                )}
              </ClipBox>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ClipBox({
  left,
  width,
  top,
  height,
  style,
  onClick,
  children,
}: {
  left: number;
  width: number;
  top: number;
  height: number;
  style?: React.CSSProperties;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "absolute overflow-hidden rounded-md border",
        onClick && "cursor-pointer transition-transform hover:-translate-y-px",
      )}
      style={{ left, width, top, height, ...style }}
    >
      <div className="flex h-full items-center justify-start px-1.5">{children}</div>
    </div>
  );
}

function AudioWaveform() {
  // Procedural waveform of 24 little bars
  const heights = useMemo(() =>
    Array.from({ length: 32 }).map(() => 25 + Math.round(Math.random() * 60)),
    []);
  return (
    <div className="flex h-full w-full items-center gap-[1px] px-1">
      {heights.map((h, i) => (
        <div key={i} className="flex-1" style={{ height: `${h}%`, background: "hsl(35 60% 50% / 0.65)", borderRadius: 1 }} />
      ))}
    </div>
  );
}

function statusColor(status: string | undefined): string {
  switch (status) {
    case "approved":   return "hsl(var(--design-success))";
    case "generating": return "hsl(var(--design-accent))";
    case "review":     return "hsl(var(--design-warning))";
    case "drift":      return "hsl(var(--design-danger))";
    default:           return "hsl(var(--design-muted-strong))";
  }
}
