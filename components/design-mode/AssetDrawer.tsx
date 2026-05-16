"use client";

import { useState, useCallback } from "react";
import { X, Pin, PinOff, Wand2, Download, Trash2, ExternalLink, Copy, Check, FileText, Loader2 } from "lucide-react";
import type { DesignAsset } from "./AssetTile";

interface AssetDrawerProps {
  asset: DesignAsset | null;
  contentScopeId?: number | null;
  contentScopeTitle?: string | null;
  onClose: () => void;
  onPin: (a: DesignAsset) => void;
  onArchive: (a: DesignAsset) => void;
  onAnimate: (a: DesignAsset) => void;
  /** Send the asset's URL + a regenerate prompt back into the chat. */
  onRegenerate: (a: DesignAsset) => void;
  /** Attach this asset to the current content scope. */
  onAttachToContent?: (a: DesignAsset) => Promise<void>;
}

const SOURCE_LABELS: Record<string, string> = {
  dalle: "DALL·E 3",
  grok_imagine: "Grok Imagine",
  runway: "Runway Gen-4",
  artlist: "Artlist · Artgrid",
  upload: "Uploaded",
  chart: "Generated chart",
};

export function AssetDrawer({
  asset,
  contentScopeId,
  contentScopeTitle,
  onClose,
  onPin,
  onArchive,
  onAnimate,
  onRegenerate,
  onAttachToContent,
}: AssetDrawerProps) {
  const [attaching, setAttaching] = useState(false);
  const [attached, setAttached] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyUrl = useCallback(async () => {
    if (!asset) return;
    try {
      const fullUrl = typeof window !== "undefined" ? new URL(asset.blob_url, window.location.origin).toString() : asset.blob_url;
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, [asset]);

  const attach = useCallback(async () => {
    if (!asset || !onAttachToContent) return;
    setAttaching(true);
    try {
      await onAttachToContent(asset);
      setAttached(true);
      setTimeout(() => setAttached(false), 2000);
    } finally {
      setAttaching(false);
    }
  }, [asset, onAttachToContent]);

  if (!asset) return null;
  const isVideo = asset.type_asset === "video" || asset.type_asset === "artlist_video";
  const isPinned = asset.flag_pinned === 1;
  const isAttachedToContent = !!(asset as any).id_content && (asset as any).id_content === contentScopeId;
  const sourceLabel = SOURCE_LABELS[asset.source] || asset.source;
  const duration = asset.metadata?.duration_sec;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm" onClick={onClose} />
      <aside className="design-mode fixed right-0 top-0 z-50 flex h-screen w-full max-w-lg flex-col border-l border-[hsl(var(--design-border))] bg-[hsl(var(--design-bg))] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[hsl(var(--design-border))] bg-[hsl(var(--design-bg-elev))] px-5 py-3.5">
          <div className="flex items-baseline gap-2">
            <h2 className="editorial-display text-lg">Asset</h2>
            <span className="section-label">{sourceLabel}</span>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-[hsl(var(--design-border))]/40 hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Preview */}
          <div className="overflow-hidden rounded-xl border border-[hsl(var(--design-border))] bg-[hsl(var(--design-card))] shadow-sm">
            {isVideo ? (
              <video src={asset.blob_url} controls className="w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={asset.blob_url} alt={asset.prompt || ""} className="w-full" />
            )}
          </div>

          {/* Metric strip (editorial dashboard style) */}
          <div className="grid grid-cols-3 gap-2">
            {isVideo && typeof duration === "number" && (
              <MetricCard label="Duration" value={duration} unit="s" />
            )}
            {asset.metadata?.model && (
              <MetricCard label="Model" valueText={String(asset.metadata.model)} />
            )}
            <MetricCard label="Created" valueText={relativeTime(asset.date_created)} />
          </div>

          {/* Status pills row */}
          <div className="flex flex-wrap gap-1.5">
            {asset.metadata?.brand_applied && (
              <span className="pill pill-success">Brand applied</span>
            )}
            {isPinned && (
              <span className="pill pill-warning"><Pin className="h-2.5 w-2.5" />Pinned</span>
            )}
            {asset.metadata?.license_terms && (
              <span className="pill pill-artlist">Licensed</span>
            )}
            {(asset as any).id_content && contentScopeId && (asset as any).id_content === contentScopeId && (
              <span className="pill pill-accent">Linked to content</span>
            )}
          </div>

          {/* Prompt */}
          {asset.prompt && (
            <div className="space-y-1.5">
              <div className="section-label">Prompt</div>
              <div className="rounded-lg border border-[hsl(var(--design-border))] bg-[hsl(var(--design-card))] p-3 text-[12.5px] leading-relaxed text-foreground">
                {asset.prompt}
              </div>
            </div>
          )}

          {/* License terms (Artlist) */}
          {asset.metadata?.license_terms && (
            <div className="space-y-1.5">
              <div className="section-label">License</div>
              <div className="text-[11px] leading-relaxed text-muted-foreground">
                {String(asset.metadata.license_terms)}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2">
            <div className="section-label">Actions</div>
            <div className="grid grid-cols-2 gap-2">
              {!isVideo && (
                <ActionButton icon={<Wand2 className="h-3.5 w-3.5" />} label="Animate" onClick={() => onAnimate(asset)} />
              )}
              <ActionButton
                icon={<Wand2 className="h-3.5 w-3.5" />}
                label={isVideo ? "Regenerate" : "Variations"}
                onClick={() => onRegenerate(asset)}
              />
              <ActionButton
                icon={isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                label={isPinned ? "Unpin" : "Pin"}
                onClick={() => onPin(asset)}
              />
              <ActionButton
                icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                label={copied ? "Copied" : "Copy URL"}
                onClick={copyUrl}
              />
              <ActionButton
                icon={<Download className="h-3.5 w-3.5" />}
                label="Open"
                onClick={() => window.open(asset.blob_url, "_blank")}
              />
              <ActionButton
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label="Remove"
                tone="destructive"
                onClick={() => { onArchive(asset); }}
              />
            </div>
          </div>

          {/* Content workflow */}
          {contentScopeId && onAttachToContent && (
            <div className="rounded-xl border border-[hsl(235_50%_88%)] bg-[hsl(var(--design-accent-soft))]/50 p-3.5 space-y-2">
              <div className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-[hsl(var(--design-accent))]" />
                <span className="section-label">Content workflow</span>
              </div>
              <div className="text-[12.5px] leading-relaxed">
                {isAttachedToContent ? (
                  <span className="text-[hsl(var(--design-success))]">
                    ✓ Attached to <span className="font-semibold">{contentScopeTitle || `content #${contentScopeId}`}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Attach to <span className="font-semibold text-foreground">{contentScopeTitle || `content #${contentScopeId}`}</span> so it appears in the content&apos;s design assets.
                  </span>
                )}
              </div>
              {!isAttachedToContent && (
                <button
                  onClick={attach}
                  disabled={attaching}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--design-accent))] px-3 py-1.5 text-[11.5px] font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                >
                  {attaching ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                  {attached ? "Attached" : attaching ? "Attaching…" : "Attach to content"}
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function MetricCard({ label, value, unit, valueText }: { label: string; value?: number; unit?: string; valueText?: string }) {
  return (
    <div className="design-card flex flex-col gap-0.5 px-3 py-2.5">
      <div className="section-label">{label}</div>
      {value != null ? (
        <div className="flex items-baseline gap-0.5 text-foreground">
          <span className="editorial-numeric text-2xl leading-none">{value}</span>
          {unit && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{unit}</span>}
        </div>
      ) : (
        <div className="text-sm font-medium leading-tight text-foreground">{valueText}</div>
      )}
    </div>
  );
}

function ActionButton({ icon, label, onClick, tone }: { icon: React.ReactNode; label: string; onClick: () => void; tone?: "destructive" }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-[hsl(var(--design-border))] bg-[hsl(var(--design-card))] px-2.5 py-2 text-[12px] font-medium transition-colors hover:border-[hsl(var(--design-accent))]/40 hover:bg-[hsl(var(--design-accent-soft))]/50 ${
        tone === "destructive" ? "text-[hsl(var(--design-danger))] hover:border-[hsl(var(--design-danger))]/40 hover:bg-[hsl(var(--design-danger))]/5" : ""
      }`}
    >
      {icon} {label}
    </button>
  );
}

function relativeTime(iso: string): string {
  try {
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  } catch {
    return iso;
  }
}
