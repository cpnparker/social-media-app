"use client";

import { useState } from "react";
import { LayoutGrid, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TrackTimeline } from "./TrackTimeline";
import { StoryboardTimeline } from "./StoryboardTimeline";
import type { DesignShot, DesignTrack } from "@/lib/design/types";

interface TimelineProps {
  tracks: DesignTrack[];
  shots: DesignShot[];
  currentShotId: string | null;
  defaultShape?: "storyboard" | "tracks";
  onSelectShot: (id: string) => void;
  onAddShot?: () => void;
  onDeleteShot?: (id: string) => void;
  onReorder?: (orderedIds: string[]) => void;
  onTrimClip?: (clipId: string, patch: { startSec?: number; durationSec?: number }) => void;
  onShapeChange?: (shape: "storyboard" | "tracks") => void;
}

/**
 * Timeline dispatcher with a view toggle.
 *
 * Storyboard is the default — much friendlier for new sessions (cards in a
 * horizontal strip, grouped by beat). Tracks view is opt-in for power users
 * who want to edit timing on a Premiere-style multi-track timeline.
 */
export function Timeline({
  tracks,
  shots,
  currentShotId,
  defaultShape = "storyboard",
  onSelectShot,
  onAddShot,
  onDeleteShot,
  onReorder,
  onTrimClip,
  onShapeChange,
}: TimelineProps) {
  const [shape, setShape] = useState<"storyboard" | "tracks">(defaultShape);

  function setShapeAndNotify(next: "storyboard" | "tracks") {
    setShape(next);
    onShapeChange?.(next);
  }

  return (
    <div className="relative h-full">
      {/* Floating view toggle — top-right */}
      <div className="pointer-events-auto absolute right-3 top-2 z-10 flex overflow-hidden rounded-full border bg-[hsl(var(--design-bg-elev))] shadow-sm"
           style={{ borderColor: "hsl(var(--design-border))" }}>
        <ToggleButton
          active={shape === "storyboard"}
          onClick={() => setShapeAndNotify("storyboard")}
          icon={<LayoutGrid className="h-3 w-3" />}
          label="Storyboard"
        />
        <ToggleButton
          active={shape === "tracks"}
          onClick={() => setShapeAndNotify("tracks")}
          icon={<Rows3 className="h-3 w-3" />}
          label="Tracks"
        />
      </div>

      {shape === "storyboard" ? (
        <StoryboardTimeline
          shots={shots}
          currentShotId={currentShotId}
          onSelectShot={onSelectShot}
          onAddShot={onAddShot}
          onDeleteShot={onDeleteShot}
          onReorder={onReorder}
        />
      ) : (
        <TrackTimeline
          tracks={tracks}
          shots={shots}
          currentShotId={currentShotId}
          onSelectShot={onSelectShot}
          onAddShot={onAddShot}
          onTrimClip={onTrimClip}
        />
      )}
    </div>
  );
}

function ToggleButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-[hsl(var(--design-accent))] text-white"
          : "text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--design-border))]/30",
      )}
    >
      {icon} {label}
    </button>
  );
}
