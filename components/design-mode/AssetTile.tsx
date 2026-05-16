"use client";

import { useState } from "react";
import { Pin, PinOff, Trash2, Wand2, Download, Sparkles } from "lucide-react";
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

export function AssetTile({ asset, onPin, onArchive, onAnimate, onDownload, onClick, size = "md" }: AssetTileProps) {
  const [hover, setHover] = useState(false);
  const isVideo = asset.type_asset === "video" || asset.type_asset === "artlist_video";
  const isPinned = asset.flag_pinned === 1;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-muted",
        "transition-shadow hover:shadow-md",
        size === "sm" ? "aspect-square" : "aspect-[4/3]",
        onClick && "cursor-pointer",
      )}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onClick?.(asset)}
    >
      {asset.pending ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-muted to-muted-foreground/10">
          <Sparkles className="h-6 w-6 animate-pulse text-muted-foreground" />
          <div className="text-xs text-muted-foreground">
            {isVideo ? "Generating video" : "Generating image"}
            {typeof asset.progress === "number" && asset.progress > 0 ? ` · ${asset.progress}%` : "…"}
          </div>
          {typeof asset.progress === "number" && asset.progress > 0 && (
            <div className="h-1 w-3/4 overflow-hidden rounded bg-muted-foreground/10">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${asset.progress}%` }} />
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

      {/* Source badge */}
      <div className="absolute left-2 top-2 flex gap-1">
        <span className={cn(
          "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
          asset.source === "artlist" ? "bg-emerald-600 text-white" :
          asset.source === "runway" ? "bg-purple-600 text-white" :
          "bg-black/60 text-white",
        )}>
          {asset.source === "artlist" ? "Artlist" : asset.source === "runway" ? "Runway" : asset.source}
        </span>
        {isPinned && (
          <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] text-white"><Pin className="inline h-2.5 w-2.5" /></span>
        )}
      </div>

      {/* Duration badge for video */}
      {isVideo && asset.metadata?.duration_sec && (
        <div className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          {asset.metadata.duration_sec}s
        </div>
      )}

      {/* Hover actions */}
      {hover && !asset.pending && (
        <div
          className="absolute inset-x-0 bottom-0 flex gap-1 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {!isVideo && onAnimate && (
            <button onClick={() => onAnimate(asset)} title="Animate this image"
              className="rounded bg-white/20 p-1.5 text-white hover:bg-white/30 backdrop-blur">
              <Wand2 className="h-3.5 w-3.5" />
            </button>
          )}
          {onPin && (
            <button onClick={() => onPin(asset)} title={isPinned ? "Unpin" : "Pin to storyboard"}
              className="rounded bg-white/20 p-1.5 text-white hover:bg-white/30 backdrop-blur">
              {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            </button>
          )}
          {onDownload && (
            <button onClick={() => onDownload(asset)} title="Download"
              className="rounded bg-white/20 p-1.5 text-white hover:bg-white/30 backdrop-blur">
              <Download className="h-3.5 w-3.5" />
            </button>
          )}
          {onArchive && (
            <button onClick={() => onArchive(asset)} title="Remove from canvas"
              className="ml-auto rounded bg-white/20 p-1.5 text-white hover:bg-red-500/60 backdrop-blur">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Prompt caption */}
      {asset.prompt && !asset.pending && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-4 text-[11px] text-white/90 group-hover:opacity-0">
          {asset.prompt.length > 80 ? asset.prompt.slice(0, 77) + "…" : asset.prompt}
        </div>
      )}
    </div>
  );
}
