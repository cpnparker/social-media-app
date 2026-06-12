"use client";

import { useState } from "react";
import { Pin, PinOff, Wand2, Download, Sparkles, BadgeCheck, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DesignAsset {
  id_asset: string;
  type_asset: "image" | "video" | "document" | "artlist_video";
  source: string;
  blob_url: string;
  thumbnail_url?: string | null;
  prompt?: string | null;
  metadata?: Record<string, any>;
  flag_pinned: number;
  date_created: string;
  /** Transient: still being generated (used by optimistic UI). */
  pending?: boolean;
  /** 0..100 if generation is in flight. */
  progress?: number;
}

interface AssetTileProps {
  asset: DesignAsset;
  onPin?: (asset: DesignAsset) => void;
  onArchive?: (asset: DesignAsset) => void;
  onAnimate?: (asset: DesignAsset) => void;
  onDownload?: (asset: DesignAsset) => void;
  onClick?: (asset: DesignAsset) => void;
  size?: "sm" | "md" | "lg";
}

const SOURCE_LABELS: Record<string, string> = {
  dalle: "DALL·E",
  grok_imagine: "Grok",
  runway: "Runway",
  artlist: "Artlist",
  upload: "Upload",
  chart: "Chart",
};

const SOURCE_PILL_CLASS: Record<string, string> = {
  dalle: "pill-accent",
  grok_imagine: "pill-accent",
  runway: "pill-runway",
  artlist: "pill-artlist",
  upload: "pill-neutral",
  chart: "pill-neutral",
};

export function AssetTile({ asset, onPin, onArchive, onAnimate, onDownload, onClick, size = "md" }: AssetTileProps) {
  const [hover, setHover] = useState(false);
  const isVideo = asset.type_asset === "video" || asset.type_asset === "artlist_video";
  const isPinned = asset.flag_pinned === 1;
  const sourceLabel = SOURCE_LABELS[asset.source] || asset.source;
  const sourcePill = SOURCE_PILL_CLASS[asset.source] || "pill-neutral";
  const brandApplied = !!asset.metadata?.brand_applied;
  const duration = asset.metadata?.duration_sec;

  return (
    <article
      className={cn(
        "design-tile design-card group relative flex flex-col overflow-hidden",
        onClick && "cursor-pointer",
      )}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onClick?.(asset)}
    >
      {/* Media */}
      <div className={cn(
        "relative overflow-hidden bg-muted",
        size === "sm" ? "aspect-square" : "aspect-[4/3]"
      )}>
        {asset.pending ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[hsl(var(--design-bg))] to-[hsl(var(--design-accent-soft))]">
            <Sparkles className="h-6 w-6 animate-pulse text-[hsl(var(--design-accent))]" />
            <div className="text-[11px] font-medium text-muted-foreground">
              {isVideo ? "Generating video" : "Generating image"}
              {typeof asset.progress === "number" && asset.progress > 0 ? ` · ${asset.progress}%` : "…"}
            </div>
            {typeof asset.progress === "number" && asset.progress > 0 && (
              <div className="h-1 w-3/4 overflow-hidden rounded-full bg-muted-foreground/10">
                <div className="h-full bg-[hsl(var(--design-accent))] transition-[width]" style={{ width: `${asset.progress}%` }} />
              </div>
            )}
          </div>
        ) : isVideo ? (
          <video
            src={asset.blob_url}
            className="h-full w-full object-cover"
            muted
            loop
            playsInline
            onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
            onMouseLeave={(e) => {
              const v = e.currentTarget as HTMLVideoElement;
              v.pause();
              v.currentTime = 0;
            }}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.blob_url} alt={asset.prompt || ""} className="h-full w-full object-cover" loading="lazy" />
        )}

        {/* Pinned indicator (top-right of media) */}
        {isPinned && !asset.pending && (
          <div className="absolute right-2 top-2 rounded-full bg-[hsl(var(--design-pin))] p-1 shadow-md">
            <Pin className="h-2.5 w-2.5 text-white" />
          </div>
        )}

        {/* Open-detail arrow (always on hover) */}
        {hover && !asset.pending && onClick && (
          <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-white/85 p-1 shadow-sm backdrop-blur">
            <ArrowUpRight className="h-3 w-3 text-foreground" />
          </div>
        )}

        {/* Hover action strip */}
        {hover && !asset.pending && (
          <div
            className="absolute inset-x-0 bottom-0 flex gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            {!isVideo && onAnimate && (
              <ActionIcon onClick={() => onAnimate(asset)} title="Animate this image">
                <Wand2 className="h-3.5 w-3.5" />
              </ActionIcon>
            )}
            {onPin && (
              <ActionIcon onClick={() => onPin(asset)} title={isPinned ? "Unpin" : "Pin to storyboard"}>
                {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </ActionIcon>
            )}
            {onDownload && (
              <ActionIcon onClick={() => onDownload(asset)} title="Download">
                <Download className="h-3.5 w-3.5" />
              </ActionIcon>
            )}
          </div>
        )}
      </div>

      {/* Editorial metadata footer */}
      <div className="flex flex-col gap-1.5 px-3 pb-2.5 pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("pill", sourcePill)}>{sourceLabel}</span>
          {isVideo && typeof duration === "number" && (
            <div className="flex items-baseline gap-0.5 text-foreground">
              <span className="editorial-numeric text-base leading-none">{duration}</span>
              <span className="text-[9px] uppercase tracking-wide text-muted-foreground">s</span>
            </div>
          )}
        </div>
        {asset.prompt && !asset.pending && (
          <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {asset.prompt}
          </div>
        )}
        {brandApplied && (
          <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--design-success))]">
            <BadgeCheck className="h-3 w-3" />
            Brand applied
          </div>
        )}
      </div>

      {/* Subtle archive on right-edge hover (out of the way) */}
      {hover && !asset.pending && onArchive && (
        <button
          onClick={(e) => { e.stopPropagation(); onArchive(asset); }}
          title="Remove from canvas"
          className="absolute right-2 bottom-1 rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
        >
          <Pin className="h-2.5 w-2.5 rotate-45" />
        </button>
      )}
    </article>
  );
}

function ActionIcon({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded-full bg-white/95 p-1.5 text-foreground shadow-sm backdrop-blur hover:bg-white"
    >
      {children}
    </button>
  );
}
