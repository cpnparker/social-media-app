"use client";

import { useState, useEffect, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Search, Loader2, Image as ImageIcon, Film, Download, Copy, Check, Library } from "lucide-react";
import { cn } from "@/lib/utils";

interface AssetRow {
  id_asset: string;
  type_asset: "image" | "video" | "document" | "artlist_video";
  source: string;
  blob_url: string;
  prompt: string | null;
  metadata: Record<string, any>;
  date_created: string;
  id_shot: string | null;
}

interface AssetLibraryProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  /** When set, an "Add to refs" button appears on each asset. */
  onAddToRefs?: (assetId: string) => void;
}

const TYPE_FILTERS: Array<{ id: string; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "all", label: "All", icon: Library },
  { id: "image", label: "Images", icon: ImageIcon },
  { id: "video", label: "Videos", icon: Film },
];

/**
 * Slide-in library of every design asset in the workspace the user has
 * access to. Searchable by prompt, filterable by type. Each asset can be
 * copied / downloaded / added as a reference to the current shot.
 */
export function AssetLibrary({ open, onClose, workspaceId, onAddToRefs }: AssetLibraryProps) {
  const [assets, setAssets] = useState<AssetRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | "image" | "video">("all");
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  // Debounce the search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    if (!workspaceId || !open) return;
    setAssets(null);
    const params = new URLSearchParams({ workspaceId, limit: "60" });
    if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
    if (type !== "all") params.set("type", type);
    try {
      const res = await fetch(`/api/ai/design/assets?${params.toString()}`);
      if (res.ok) {
        const j = await res.json();
        setAssets(j.assets || []);
      }
    } catch { /* non-fatal */ }
  }, [workspaceId, open, debouncedSearch, type]);

  useEffect(() => { load(); }, [load]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="design-mode flex w-full flex-col p-0 sm:max-w-[640px]"
        style={{ background: "hsl(var(--design-bg))" }}
      >
        <SheetHeader className="space-y-3 border-b p-4"
                     style={{ borderColor: "hsl(var(--design-border))" }}>
          <SheetTitle className="editorial-display text-lg flex items-center gap-2">
            <Library className="h-4 w-4" /> Asset library
          </SheetTitle>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search assets by prompt…"
                className="w-full rounded-md border bg-[hsl(var(--design-bg-elev))] py-1.5 pl-8 pr-3 text-[12.5px] focus:border-[hsl(var(--design-accent))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--design-accent))]/20"
                style={{ borderColor: "hsl(var(--design-border))" }}
              />
            </div>
            <div className="flex overflow-hidden rounded-md border" style={{ borderColor: "hsl(var(--design-border))" }}>
              {TYPE_FILTERS.map((f) => {
                const Icon = f.icon;
                return (
                  <button
                    key={f.id}
                    onClick={() => setType(f.id as any)}
                    className={cn(
                      "inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] font-medium",
                      type === f.id
                        ? "bg-[hsl(var(--design-accent))] text-white"
                        : "text-muted-foreground hover:bg-[hsl(var(--design-border))]/30",
                    )}
                  >
                    <Icon className="h-3 w-3" /> {f.label}
                  </button>
                );
              })}
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          {assets === null ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : assets.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-[12px] text-muted-foreground">
              <Library className="h-6 w-6 opacity-40" />
              <span>No assets {debouncedSearch ? `matching "${debouncedSearch}"` : "yet"}.</span>
              {debouncedSearch && (
                <button onClick={() => setSearch("")} className="underline">Clear search</button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {assets.map((a) => <AssetCell key={a.id_asset} asset={a} onAddToRefs={onAddToRefs} />)}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AssetCell({ asset, onAddToRefs }: { asset: AssetRow; onAddToRefs?: (id: string) => void }) {
  const [copied, setCopied] = useState(false);
  const isVideo = asset.type_asset === "video" || asset.type_asset === "artlist_video";
  const sourceLabel = (asset.source || "").replace("_", " ");

  return (
    <div className="design-tile design-card group relative overflow-hidden">
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {isVideo ? (
          <video
            src={asset.blob_url}
            className="h-full w-full object-cover"
            muted
            loop
            playsInline
            onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
            onMouseLeave={(e) => { (e.currentTarget as HTMLVideoElement).pause(); (e.currentTarget as HTMLVideoElement).currentTime = 0; }}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.blob_url} alt={asset.prompt || ""} className="h-full w-full object-cover" loading="lazy" />
        )}

        {/* Source pill top-left */}
        <span className={cn(
          "absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white",
          asset.source === "runway" ? "bg-purple-600" :
          asset.source === "artlist" ? "bg-emerald-600" :
          "bg-black/60",
        )}>
          {sourceLabel}
        </span>

        {/* Duration top-right (video) */}
        {isVideo && asset.metadata?.duration_sec && (
          <span className="absolute right-1.5 top-1.5 rounded bg-black/55 px-1 py-0.5 font-mono text-[9px] text-white/95">
            {asset.metadata.duration_sec}s
          </span>
        )}

        {/* Hover actions strip */}
        <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          {onAddToRefs && (
            <button
              onClick={(e) => { e.stopPropagation(); onAddToRefs(asset.id_asset); }}
              className="rounded bg-white/95 px-2 py-1 text-[10px] font-medium text-foreground shadow hover:bg-white"
              title="Add as reference to current shot"
            >
              + Refs
            </button>
          )}
          <button
            onClick={async (e) => {
              e.stopPropagation();
              try {
                const fullUrl = typeof window !== "undefined" ? new URL(asset.blob_url, window.location.origin).toString() : asset.blob_url;
                await navigator.clipboard.writeText(fullUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch { /* ignore */ }
            }}
            className="rounded bg-white/95 p-1 text-foreground shadow hover:bg-white"
            title="Copy URL"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
          <a
            href={asset.blob_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="ml-auto rounded bg-white/95 p-1 text-foreground shadow hover:bg-white"
            title="Open original"
          >
            <Download className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Caption */}
      <div className="space-y-0.5 px-2 pt-1.5 pb-2">
        <div className="line-clamp-2 text-[11px] leading-snug">{asset.prompt || "Untitled"}</div>
        <div className="text-[9px] text-muted-foreground">
          {new Date(asset.date_created).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}
