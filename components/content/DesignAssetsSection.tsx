"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Palette, Sparkles, ExternalLink, Download } from "lucide-react";
import { getSubdomainUrl } from "@/lib/subdomain";

interface DesignAssetRow {
  id_asset: string;
  type_asset: "image" | "video" | "document" | "artlist_video";
  source: string;
  blob_url: string;
  prompt: string | null;
  metadata: Record<string, any>;
  date_created: string;
}

interface DesignAssetsSectionProps {
  workspaceId: string;
  /** Accepts string (UUID-routed content pages) or number (legacy id_content). */
  contentId: string | number;
}

const SOURCE_LABELS: Record<string, string> = {
  dalle: "DALL·E",
  grok_imagine: "Grok",
  runway: "Runway",
  artlist: "Artlist",
};

/**
 * Surfaced in the content detail page. Lists design assets that have been
 * published from a Design Mode session into this content piece (assets with
 * id_content set on ai_design_assets). Includes a deep-link to /design?content=N
 * if the team wants to keep iterating.
 */
export function DesignAssetsSection({ workspaceId, contentId }: DesignAssetsSectionProps) {
  const [assets, setAssets] = useState<DesignAssetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId || !contentId) return;
    let cancelled = false;
    fetch(`/api/ai/design/assets?workspaceId=${workspaceId}&contentId=${contentId}&limit=50`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((j) => { if (!cancelled) setAssets(j.assets || []); })
      .catch(() => { if (!cancelled) setError("Couldn't load design assets"); });
    return () => { cancelled = true; };
  }, [workspaceId, contentId]);

  const designUrl = useMemo(() => getSubdomainUrl("ai", `/design?content=${contentId}`), [contentId]);

  // Empty / loading state
  if (assets === null) {
    return (
      <section className="rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Palette className="h-3.5 w-3.5" />
          <span>Design assets · loading…</span>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-lg border bg-card p-3 text-[11px] text-destructive">{error}</section>
    );
  }

  if (assets.length === 0) {
    return (
      <section className="rounded-lg border bg-card p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Palette className="h-3.5 w-3.5 text-violet-600" />
            Design assets
          </div>
          <a
            href={designUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10.5px] text-violet-600 hover:underline"
          >
            Open Design <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
        <div className="rounded border border-dashed p-3 text-center text-[11px] text-muted-foreground">
          <Sparkles className="mx-auto mb-1 h-4 w-4 opacity-50" />
          No design assets yet. Generate visuals + video in Design Mode and publish them back here.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border bg-card p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Palette className="h-3.5 w-3.5 text-violet-600" />
          Design assets · <span className="text-muted-foreground">{assets.length}</span>
        </div>
        <a
          href={designUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10.5px] text-violet-600 hover:underline"
        >
          Open Design <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {assets.map((a) => <AssetCell key={a.id_asset} asset={a} />)}
      </div>
    </section>
  );
}

function AssetCell({ asset }: { asset: DesignAssetRow }) {
  const isVideo = asset.type_asset === "video" || asset.type_asset === "artlist_video";
  const sourceLabel = SOURCE_LABELS[asset.source] || asset.source;
  return (
    <div className="group relative aspect-square overflow-hidden rounded-md border" title={asset.prompt || ""}>
      {isVideo ? (
        <video src={asset.blob_url} className="h-full w-full object-cover" muted loop
               onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
               onMouseLeave={(e) => { (e.currentTarget as HTMLVideoElement).pause(); (e.currentTarget as HTMLVideoElement).currentTime = 0; }} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={asset.blob_url} alt={asset.prompt || ""} className="h-full w-full object-cover" loading="lazy" />
      )}
      {/* Source pill */}
      <span className={`absolute left-1 top-1 rounded px-1 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-white ${
        asset.source === "runway" ? "bg-purple-600" :
        asset.source === "artlist" ? "bg-emerald-600" :
        "bg-black/55"
      }`}>{sourceLabel}</span>
      {/* Video duration */}
      {isVideo && asset.metadata?.duration_sec && (
        <span className="absolute right-1 top-1 rounded bg-black/55 px-1 py-0.5 font-mono text-[9px] text-white/95">
          {asset.metadata.duration_sec}s
        </span>
      )}
      {/* Hover: download / open */}
      <a
        href={asset.blob_url}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute right-1 bottom-1 rounded-full bg-black/55 p-1 text-white/95 opacity-0 transition-opacity hover:bg-black group-hover:opacity-100"
        title="Open original"
        onClick={(e) => e.stopPropagation()}
      >
        <Download className="h-2.5 w-2.5" />
      </a>
    </div>
  );
}
