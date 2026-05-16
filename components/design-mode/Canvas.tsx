"use client";

import { useMemo } from "react";
import { Sparkles, Pin } from "lucide-react";
import { AssetTile, type DesignAsset } from "./AssetTile";

interface CanvasProps {
  assets: DesignAsset[];
  onAnimate?: (asset: DesignAsset) => void;
  onPin?: (asset: DesignAsset) => void;
  onArchive?: (asset: DesignAsset) => void;
  onSelect?: (asset: DesignAsset) => void;
  className?: string;
}

export function Canvas({ assets, onAnimate, onPin, onArchive, onSelect, className }: CanvasProps) {
  const { pinned, rest } = useMemo(() => {
    const pinned = assets.filter((a) => a.flag_pinned === 1);
    const rest = assets.filter((a) => a.flag_pinned !== 1);
    return { pinned, rest };
  }, [assets]);

  if (assets.length === 0) {
    return (
      <div className={`flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground ${className || ""}`}>
        <Sparkles className="h-8 w-8" />
        <div className="space-y-1">
          <div className="text-sm font-medium">Canvas is empty</div>
          <div className="text-xs">Generated images, videos, and licensed Artlist clips will appear here as you create them.</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-4 overflow-y-auto p-4 ${className || ""}`}>
      {pinned.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Pin className="h-3 w-3" />
            Storyboard
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {pinned.map((a) => (
              <AssetTile
                key={a.id_asset}
                asset={a}
                onAnimate={onAnimate}
                onPin={onPin}
                onArchive={onArchive}
                onClick={onSelect}
              />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Session ({rest.length})
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          {rest.map((a) => (
            <AssetTile
              key={a.id_asset}
              asset={a}
              onAnimate={onAnimate}
              onPin={onPin}
              onArchive={onArchive}
              onClick={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
