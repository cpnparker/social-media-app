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
      <div className={`flex h-full flex-col items-center justify-center gap-4 p-8 text-center ${className || ""}`}>
        <div className="relative">
          <div className="absolute inset-0 -m-4 rounded-full bg-[hsl(var(--design-accent-soft))] blur-2xl opacity-60" />
          <Sparkles className="relative h-10 w-10 text-[hsl(var(--design-accent))]" />
        </div>
        <div className="space-y-2 max-w-sm">
          <h3 className="editorial-display text-2xl text-foreground">A blank canvas.</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Generated images, animated videos, and licensed Artlist clips will land here as you create them. Pin your favourites to build a storyboard.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-6 overflow-y-auto p-5 ${className || ""}`}>
      {pinned.length > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-baseline gap-2">
            <Pin className="h-3 w-3 text-[hsl(var(--design-pin))]" />
            <div className="section-label" style={{ color: "hsl(var(--design-pin))" }}>Storyboard</div>
            <div className="editorial-numeric text-base text-foreground">{pinned.length}</div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
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
        </section>
      )}

      <section className="space-y-2.5">
        <div className="flex items-baseline gap-2">
          <div className="section-label">Session</div>
          <div className="editorial-numeric text-base text-foreground">{rest.length}</div>
          <div className="editorial-divider flex-1 ml-2" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
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
      </section>
    </div>
  );
}
