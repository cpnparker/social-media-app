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

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      {/* Drawer */}
      <aside className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-lg flex-col border-l bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold">Asset details</div>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Preview */}
          <div className="overflow-hidden rounded-lg border bg-muted">
            {isVideo ? (
              <video src={asset.blob_url} controls className="w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={asset.blob_url} alt={asset.prompt || ""} className="w-full" />
            )}
          </div>

          {/* Metadata */}
          <dl className="space-y-2 text-xs">
            <MetaRow label="Source" value={
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                asset.source === "artlist" ? "bg-emerald-100 text-emerald-700" :
                asset.source === "runway" ? "bg-purple-100 text-purple-700" :
                "bg-muted-foreground/10"
              }`}>{asset.source}</span>
            } />
            <MetaRow label="Type" value={asset.type_asset} />
            {asset.metadata?.duration_sec && (
              <MetaRow label="Duration" value={`${asset.metadata.duration_sec}s`} />
            )}
            {asset.metadata?.model && (
              <MetaRow label="Model" value={String(asset.metadata.model)} />
            )}
            {asset.metadata?.brand_applied !== undefined && (
              <MetaRow label="Brand applied" value={asset.metadata.brand_applied ? "Yes" : "No"} />
            )}
            <MetaRow label="Created" value={new Date(asset.date_created).toLocaleString()} />
            {asset.metadata?.license_terms && (
              <MetaRow label="License" value={<span className="text-[11px] text-muted-foreground">{String(asset.metadata.license_terms)}</span>} />
            )}
          </dl>

          {/* Prompt */}
          {asset.prompt && (
            <div className="space-y-1">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Prompt</div>
              <div className="rounded border bg-muted/40 p-2 text-xs leading-relaxed">{asset.prompt}</div>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Actions</div>
            <div className="grid grid-cols-2 gap-2">
              {!isVideo && (
                <ActionButton icon={<Wand2 className="h-3.5 w-3.5" />} label="Animate" onClick={() => onAnimate(asset)} />
              )}
              <ActionButton
                icon={<Wand2 className="h-3.5 w-3.5" />}
                label={isVideo ? "Regenerate video" : "Variations"}
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
                onClick={() => { onArchive(asset); onClose(); }}
              />
            </div>
          </div>

          {/* Content workflow */}
          {contentScopeId && onAttachToContent && (
            <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                <FileText className="h-3 w-3" />
                Linked to content
              </div>
              <div className="text-xs">
                {isAttachedToContent ? (
                  <span className="text-emerald-700 dark:text-emerald-300">
                    ✓ Attached to <span className="font-medium">{contentScopeTitle || `#${contentScopeId}`}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Attach this asset to <span className="font-medium">{contentScopeTitle || `content #${contentScopeId}`}</span> so it appears in the content&apos;s design assets.
                  </span>
                )}
              </div>
              {!isAttachedToContent && (
                <button
                  onClick={attach}
                  disabled={attaching}
                  className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {attaching ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                  {attached ? "Attached!" : attaching ? "Attaching…" : "Attach to content"}
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-24 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="flex-1 text-foreground">{value}</dd>
    </div>
  );
}

function ActionButton({ icon, label, onClick, tone }: { icon: React.ReactNode; label: string; onClick: () => void; tone?: "destructive" }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded border px-2 py-1.5 text-xs hover:bg-muted ${
        tone === "destructive" ? "text-destructive hover:border-destructive/40" : ""
      }`}
    >
      {icon} {label}
    </button>
  );
}
