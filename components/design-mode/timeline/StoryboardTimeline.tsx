"use client";

import { useMemo } from "react";
import { Plus, AlertTriangle, BadgeCheck, Clock, X, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DesignShot } from "@/lib/design/types";

interface StoryboardTimelineProps {
  shots: DesignShot[];
  currentShotId: string | null;
  onSelectShot: (id: string) => void;
  onAddShot?: () => void;
  onDeleteShot?: (id: string) => void;
  onReorder?: (orderedIds: string[]) => void;
}

/**
 * Storyboard view — horizontal row of shot cards, grouped by beat.
 * Supports drag-to-reorder (within and across beats) and hover-delete.
 */
export function StoryboardTimeline({ shots, currentShotId, onSelectShot, onAddShot, onDeleteShot, onReorder }: StoryboardTimelineProps) {
  const totalDuration = useMemo(() => shots.reduce((a, s) => a + s.duration, 0), [shots]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = shots.findIndex((s) => s.id === active.id);
    const newIndex = shots.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(shots, oldIndex, newIndex);
    onReorder?.(reordered.map((s) => s.id));
  }

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

  // Build beat groupings while preserving order
  const beatGroups = (() => {
    const groups: Array<{ beat: string | null; shots: DesignShot[] }> = [];
    for (const s of shots) {
      const last = groups[groups.length - 1];
      if (last && last.beat === (s.beat || null)) last.shots.push(s);
      else groups.push({ beat: s.beat || null, shots: [s] });
    }
    return groups;
  })();

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

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={shots.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
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
                    <SortableShotCard
                      key={s.id}
                      shot={s}
                      active={s.id === currentShotId}
                      onClick={() => onSelectShot(s.id)}
                      onDelete={onDeleteShot ? () => onDeleteShot(s.id) : undefined}
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
        </SortableContext>
      </DndContext>
    </section>
  );
}

function SortableShotCard({
  shot, active, onClick, onDelete,
}: {
  shot: DesignShot;
  active: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: shot.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="relative">
      <ShotCard
        shot={shot}
        active={active}
        onClick={onClick}
        onDelete={onDelete}
        dragHandle={
          <button
            {...attributes}
            {...listeners}
            className="absolute left-1 top-1 z-10 rounded-md bg-black/40 p-1 text-white/80 opacity-0 backdrop-blur transition-opacity hover:text-white group-hover:opacity-100"
            title="Drag to reorder"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-3 w-3" />
          </button>
        }
      />
    </div>
  );
}

function ShotCard({
  shot, active, onClick, onDelete, dragHandle,
}: {
  shot: DesignShot;
  active: boolean;
  onClick: () => void;
  onDelete?: () => void;
  dragHandle?: React.ReactNode;
}) {
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

        {/* Drag handle (top-left, hover-only) */}
        {dragHandle}

        {/* Status dot */}
        <span
          className="absolute right-2 top-2 h-2 w-2 rounded-full ring-2 ring-white/80"
          style={{ background: statusColor(shot.status) }}
          title={shot.status}
        />

        {/* Drift warning */}
        {!shot.onBrand && (
          <div className="absolute left-2 bottom-2 flex items-center gap-0.5 rounded-full bg-[hsl(var(--design-warning))] px-1.5 py-0.5 text-[9px] font-semibold text-white">
            <AlertTriangle className="h-2.5 w-2.5" />
            drift
          </div>
        )}

        {/* On-brand committed check */}
        {shot.onBrand && shot.status === "approved" && (
          <div className="absolute left-2 bottom-2 rounded-full bg-[hsl(var(--design-success))]/95 p-1 text-white" title="Committed to timeline">
            <BadgeCheck className="h-2.5 w-2.5" />
          </div>
        )}

        {/* Hover delete (top-right, behind status dot) */}
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="absolute right-2 bottom-2 rounded-full bg-black/50 p-1 text-white/90 opacity-0 backdrop-blur transition-opacity hover:bg-[hsl(var(--design-danger))] group-hover:opacity-100"
            title="Delete shot"
          >
            <X className="h-2.5 w-2.5" />
          </button>
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
