"use client";

import { useState, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X, Check, Copy, Download, Wand2, Star, BadgeCheck, AlertTriangle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DesignShot, DesignShotVersion } from "@/lib/design/types";
import { DESIGN_MODELS, LEGACY_MODEL_ALIASES } from "@/lib/design/types";

interface VersionDetailDialogProps {
  open: boolean;
  onClose: () => void;
  shot: DesignShot;
  version: DesignShotVersion | null;
  isCurrent: boolean;
  onSetCurrent: () => void;
  onAnimate?: () => void;
}

/**
 * Click any version thumbnail in the canvas strip → this opens. Big preview,
 * the full prompt, metadata, brand-check results, and the actions you'd want:
 * set as current, animate, copy URL, open original.
 */
export function VersionDetailDialog({
  open,
  onClose,
  shot,
  version,
  isCurrent,
  onSetCurrent,
  onAnimate,
}: VersionDetailDialogProps) {
  const [copied, setCopied] = useState(false);

  const copyUrl = useCallback(async () => {
    if (!version?.assetUrl) return;
    try {
      const fullUrl = typeof window !== "undefined"
        ? new URL(version.assetUrl, window.location.origin).toString()
        : version.assetUrl;
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, [version?.assetUrl]);

  if (!version) return null;

  const isVideo = version.assetType === "video" || version.assetType === "artlist_video";
  const resolvedModelId = version.modelId ? (LEGACY_MODEL_ALIASES[version.modelId] || version.modelId) : null;
  const modelInfo = DESIGN_MODELS.find((m) => m.id === resolvedModelId);

  // Brand check results live in metadata.brand_check ([{ rule, status, value, threshold, detail }])
  const brandChecks: any[] = Array.isArray(version.metadata?.brand_check) ? version.metadata.brand_check : [];
  const failedChecks = brandChecks.filter((c) => c?.status === "fail");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="design-mode max-w-[1100px] gap-0 overflow-hidden border p-0"
        style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg))" }}
      >
        <div className="grid grid-cols-[1fr_320px]">
          {/* Preview pane */}
          <div className="relative flex items-center justify-center bg-black" style={{ minHeight: 480 }}>
            {isVideo && version.assetUrl ? (
              <video
                src={version.assetUrl}
                controls
                autoPlay
                loop
                className="max-h-[80vh] w-full object-contain"
              />
            ) : version.assetUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={version.assetUrl}
                alt={version.promptUsed || shot.title}
                className="max-h-[80vh] w-full object-contain"
              />
            ) : (
              <div className="thumb thumb-stripe flex h-96 w-full items-center justify-center text-white/70">
                <span className="font-mono text-[10px]">No preview</span>
              </div>
            )}

            {/* Top-right meta */}
            <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
              {isCurrent && (
                <span className="pill pill-accent">
                  <Star className="h-3 w-3" /> Current version
                </span>
              )}
              {brandChecks.length > 0 && (
                failedChecks.length === 0 ? (
                  <span className="pill pill-success">
                    <BadgeCheck className="h-3 w-3" /> On brand
                  </span>
                ) : (
                  <span className="pill pill-warning">
                    <AlertTriangle className="h-3 w-3" /> Drift
                  </span>
                )
              )}
            </div>

            {/* Close (over the preview, in case the right pane is collapsed on narrow screens) */}
            <button
              onClick={onClose}
              className="absolute left-3 top-3 rounded-full bg-black/50 p-1.5 text-white/90 backdrop-blur hover:bg-black/80"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Side info pane */}
          <aside
            className="flex max-h-[85vh] flex-col overflow-y-auto border-l"
            style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg-elev))" }}
          >
            <div className="space-y-1 px-4 pt-4">
              <div className="section-label muted">Shot · {String(shot.idx).padStart(2, "0")} · v{version.idx}</div>
              <h2 className="editorial-display text-[18px] leading-tight">{shot.title}</h2>
              {shot.beat && <div className="text-[11px] text-muted-foreground">{shot.beat}</div>}
            </div>

            {/* Metadata */}
            <div className="space-y-2 border-b px-4 pb-4 pt-3"
                 style={{ borderColor: "hsl(var(--design-border))" }}>
              <MetaRow label="Model" value={modelInfo?.name || version.modelId || "—"} />
              {version.metadata?.duration_sec && (
                <MetaRow label="Duration" value={`${version.metadata.duration_sec}s`} />
              )}
              {version.metadata?.size && (
                <MetaRow label="Size" value={String(version.metadata.size)} />
              )}
              {version.metadata?.format && (
                <MetaRow label="Format" value={String(version.metadata.format)} />
              )}
              {version.metadata?.brand_applied && (
                <MetaRow
                  label="Brand"
                  value={<span className="pill pill-success"><BadgeCheck className="h-3 w-3" /> Auto-applied</span>}
                />
              )}
              <MetaRow label="Created" value={new Date(version.createdAt).toLocaleString()} />
            </div>

            {/* Brand check results */}
            {brandChecks.length > 0 && (
              <div className="space-y-2 border-b px-4 pb-4 pt-3"
                   style={{ borderColor: "hsl(var(--design-border))" }}>
                <div className="section-label muted">Brand check</div>
                <div className="space-y-1.5">
                  {brandChecks.map((c, i) => (
                    <BrandCheckRow key={i} check={c} />
                  ))}
                </div>
              </div>
            )}

            {/* Prompt */}
            {version.promptUsed && (
              <div className="space-y-1.5 border-b px-4 pb-4 pt-3"
                   style={{ borderColor: "hsl(var(--design-border))" }}>
                <div className="section-label muted">Prompt</div>
                <p className="rounded-md border p-2.5 font-mono text-[11px] leading-relaxed"
                   style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg))" }}>
                  {version.promptUsed}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="space-y-2 px-4 py-4">
              <div className="section-label muted">Actions</div>
              <div className="grid grid-cols-2 gap-2">
                <ActionBtn onClick={onSetCurrent} disabled={isCurrent}>
                  <Star className="h-3.5 w-3.5" /> {isCurrent ? "Current" : "Set as current"}
                </ActionBtn>
                {!isVideo && onAnimate && (
                  <ActionBtn onClick={onAnimate}>
                    <Wand2 className="h-3.5 w-3.5" /> Animate
                  </ActionBtn>
                )}
                {version.assetUrl && (
                  <>
                    <ActionBtn onClick={copyUrl}>
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? "Copied" : "Copy URL"}
                    </ActionBtn>
                    <ActionBtn onClick={() => window.open(version.assetUrl!, "_blank")}>
                      <Download className="h-3.5 w-3.5" /> Open original
                    </ActionBtn>
                  </>
                )}
              </div>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-20 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="flex-1 text-[12px]">{value}</dd>
    </div>
  );
}

function BrandCheckRow({ check }: { check: any }) {
  const status = check.status as "pass" | "warn" | "fail";
  return (
    <div className="flex items-start gap-2 rounded-md border px-2 py-1.5"
         style={{
           borderColor: status === "pass" ? "hsl(var(--design-success))/40"
                       : status === "warn" ? "hsl(var(--design-warning))/40"
                       : "hsl(var(--design-danger))/40",
           background: status === "pass" ? "hsl(158 60% 96%)"
                       : status === "warn" ? "hsl(38 85% 96%)"
                       : "hsl(0 85% 97%)",
         }}>
      {status === "pass" ? <Check className="h-3 w-3 flex-shrink-0 mt-0.5" style={{ color: "hsl(var(--design-success))" }} /> :
       status === "warn" ? <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" style={{ color: "hsl(25 70% 40%)" }} /> :
       <Sparkles className="h-3 w-3 flex-shrink-0 mt-0.5" style={{ color: "hsl(var(--design-danger))" }} />}
      <div className="flex-1 text-[11px]">
        <div className="font-medium">{check.rule}</div>
        {check.detail && <div className="text-muted-foreground">{check.detail}</div>}
      </div>
    </div>
  );
}

function ActionBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors hover:border-[hsl(var(--design-accent))]/40 hover:bg-[hsl(var(--design-accent-soft))]/40",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
      style={{ borderColor: "hsl(var(--design-border))" }}
    >
      {children}
    </button>
  );
}
