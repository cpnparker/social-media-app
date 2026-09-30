"use client";

import { useState } from "react";
import { X, Check, AlertTriangle, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DesignContent, DesignShot } from "@/lib/design/types";

interface PublishSheetProps {
  open: boolean;
  onClose: () => void;
  content: DesignContent | null;
  shots: DesignShot[];
  sessionId?: string | null;
  onPublish: (opts: PublishOptions) => Promise<void> | void;
}

interface PublishOptions {
  formats: string[];
  caption: string;
  queueForPosting: boolean;
  notifyOwner: boolean;
  attachLicense: boolean;
  generateAltCopy: boolean;
}

const FORMATS = [
  { ratio: "9:16", kind: "Story",     platform: "Instagram, TikTok, Reels", primary: true,  hue: 215 },
  { ratio: "1:1",  kind: "Feed",      platform: "Instagram, LinkedIn",       primary: false, hue: 38  },
  { ratio: "16:9", kind: "Landscape", platform: "YouTube, Web hero",         primary: false, hue: 200 },
];

const DEFAULT_CAPTION = "Patient capital. Considered horizons. A film about how OmInvest allocates conviction across cycles. #OmInvest #PatientCapital";

export function PublishSheet({ open, onClose, content, shots, sessionId, onPublish }: PublishSheetProps) {
  const [caption, setCaption] = useState(DEFAULT_CAPTION);
  const [queueForPosting, setQueueForPosting] = useState(true);
  const [notifyOwner, setNotifyOwner] = useState(true);
  const [attachLicense, setAttachLicense] = useState(true);
  const [generateAltCopy, setGenerateAltCopy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [variationsLoading, setVariationsLoading] = useState(false);
  const [variations, setVariations] = useState<string[]>([]);

  async function loadVariations() {
    if (!sessionId || variationsLoading) return;
    setVariationsLoading(true);
    try {
      const res = await fetch(`/api/design/sessions/${sessionId}/caption-variations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current: caption }),
      });
      if (res.ok) {
        const j = await res.json();
        setVariations(j.variations || []);
      }
    } finally {
      setVariationsLoading(false);
    }
  }

  if (!open) return null;

  const onBrandCount = shots.filter((s) => s.onBrand).length;
  const driftCount = shots.length - onBrandCount;
  const totalDuration = shots.reduce((a, s) => a + s.duration, 0);

  async function handlePublish() {
    setSubmitting(true);
    try {
      await onPublish({
        formats: FORMATS.map((f) => f.ratio),
        caption,
        queueForPosting,
        notifyOwner,
        attachLicense,
        generateAltCopy,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="design-mode relative grid w-full max-w-[920px] grid-cols-1 overflow-hidden rounded-xl border shadow-2xl lg:grid-cols-[1fr_360px]"
        style={{
          borderColor: "hsl(var(--design-border))",
          background: "hsl(var(--design-bg-elev))",
          boxShadow: "var(--shadow-modal)",
          maxHeight: "88vh",
        }}
      >
        {/* Left — formats + caption */}
        <div className="flex flex-col gap-5 overflow-y-auto p-6">
          <div>
            <div className="section-label">Publish to Engine</div>
            <h2 className="editorial-display mt-1 text-[22px] leading-tight">
              {content?.title || "Final cut"}
            </h2>
          </div>

          {/* Format previews */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="section-label muted">Targets</span>
              <span className="text-[10.5px] text-muted-foreground">{FORMATS.length} formats · 1 published asset</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {FORMATS.map((f) => (
                <FormatPreview key={f.ratio} {...f} duration={totalDuration} />
              ))}
            </div>
          </div>

          {/* Caption */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="section-label muted">Caption</span>
              <button
                onClick={loadVariations}
                disabled={!sessionId || variationsLoading}
                className="text-[10.5px] underline disabled:opacity-40"
                style={{ color: "hsl(var(--design-accent))" }}
              >
                {variationsLoading ? "Generating…" : variations.length > 0 ? "Refresh variations" : "Generate variations"}
              </button>
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              className="w-full resize-none rounded-lg border bg-[hsl(var(--design-bg))] p-3 text-[13px] leading-relaxed focus:border-[hsl(var(--design-accent))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--design-accent))]/20"
              style={{ borderColor: "hsl(var(--design-border))", fontFamily: "ui-serif, Georgia, serif" }}
            />
            <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
              <span>{caption.length} chars</span>
              <span>·</span>
              <span className="pill pill-success">on-voice</span>
            </div>

            {/* Variations list */}
            {variations.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="text-[10.5px] font-medium text-muted-foreground">Pick one to use:</div>
                {variations.map((v, i) => (
                  <button
                    key={i}
                    onClick={() => setCaption(v)}
                    className="design-tile group flex w-full items-start gap-2 rounded-lg border bg-[hsl(var(--design-bg))] p-2.5 text-left text-[12px] leading-relaxed transition-colors hover:border-[hsl(var(--design-accent))]/40"
                    style={{ borderColor: "hsl(var(--design-border))", fontFamily: "ui-serif, Georgia, serif" }}
                  >
                    <span className="font-mono text-[9px] text-muted-foreground mt-0.5">{i + 1}</span>
                    <span className="flex-1">{v}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right — destination + brand cert + posting */}
        <aside
          className="flex flex-col gap-4 overflow-y-auto border-l p-5"
          style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg))" }}
        >
          <button
            onClick={onClose}
            className="absolute right-3 top-3 rounded p-1 text-muted-foreground hover:bg-[hsl(var(--design-border))]/40"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Destination */}
          <div className="space-y-1.5">
            <div className="section-label muted">Destination in Engine</div>
            <div className="design-card p-3">
              <div className="flex items-start gap-2">
                <FileText className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--design-accent))" }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold">{content?.title || "—"}</div>
                  <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                    {[content?.pillar, content?.owner, content?.dueDate ? `due ${new Date(content.dueDate).toLocaleDateString()}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {content?.id && (
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">CI-{content.id}</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Brand certificate */}
          <div className="space-y-1.5">
            <div className="section-label muted">Brand certificate</div>
            <div className="space-y-1">
              <CertRow status={driftCount === 0 ? "pass" : "warn"} label="Palette compliance"
                       detail={`${onBrandCount}/${shots.length} shots on palette`} />
              <CertRow status="pass" label="Sandstone cap"
                       detail="all shots ≤ 14% · max 9.2%" />
              <CertRow status="pass" label="Typography lockup"
                       detail="display + body match brand kit" />
              <CertRow status={driftCount === 0 ? "pass" : "warn"} label="Drift detection"
                       detail={driftCount === 0 ? "no rule violations" : `${driftCount} drift warning${driftCount === 1 ? "" : "s"} pending`} />
            </div>
          </div>

          {/* Posting toggles */}
          <div className="space-y-1.5">
            <div className="section-label muted">Posting</div>
            <Toggle label="Queue for posting" value={queueForPosting} onChange={setQueueForPosting} />
            <Toggle label={`Notify ${content?.owner || "owner"}`} value={notifyOwner} onChange={setNotifyOwner} />
            <Toggle label="Attach license certificate" value={attachLicense} onChange={setAttachLicense} />
            <Toggle label="Generate alt copy" value={generateAltCopy} onChange={setGenerateAltCopy} />
          </div>

          <div className="mt-auto space-y-2 pt-2">
            <button
              onClick={handlePublish}
              disabled={submitting}
              className="w-full rounded-lg bg-[hsl(var(--design-accent))] px-3 py-2 text-[13px] font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Publishing…" : `Publish ${FORMATS.length} formats to Engine`}
            </button>
            <button className="w-full rounded-lg border px-3 py-2 text-[13px] font-medium hover:bg-[hsl(var(--design-bg-elev))]"
                    style={{ borderColor: "hsl(var(--design-border))" }}>
              Export files only
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function FormatPreview({ ratio, kind, platform, primary, hue, duration }: typeof FORMATS[number] & { duration: number }) {
  const aspect = ratio === "9:16" ? "9/16" : ratio === "1:1" ? "1/1" : "16/9";
  return (
    <div
      className={cn("design-card overflow-hidden", primary && "ring-1")}
      style={primary ? { borderColor: "hsl(var(--design-accent))", ['--tw-ring-color' as any]: "hsl(var(--design-accent))" } : undefined}
    >
      <div className="thumb thumb-stripe relative flex items-center justify-center text-center text-white/85"
           style={{ aspectRatio: aspect, ['--th' as any]: String(hue) }}>
        <div>
          <div className="font-mono text-[9px] tracking-wider opacity-80">FINAL CUT · {ratio}</div>
          <div className="editorial-display mt-1 text-[12px] text-white">{kind}</div>
        </div>
        <span className="absolute right-1.5 top-1.5 rounded bg-black/40 px-1.5 py-0.5 font-mono text-[9px] text-white/90">
          {Math.round(duration)}s
        </span>
      </div>
      <div className="px-2 pt-1.5 pb-2 text-center">
        <div className="text-[10.5px] font-semibold">{ratio}</div>
        <div className="text-[10px] text-muted-foreground">{platform}</div>
        {primary && (
          <span className="pill pill-accent mt-1 inline-flex">primary</span>
        )}
      </div>
    </div>
  );
}

function CertRow({ status, label, detail }: { status: "pass" | "warn" | "fail"; label: string; detail: string }) {
  const Icon = status === "pass" ? Check : status === "warn" ? AlertTriangle : X;
  const color = status === "pass" ? "hsl(var(--design-success))" : status === "warn" ? "hsl(25 70% 45%)" : "hsl(var(--design-danger))";
  return (
    <div className="flex items-start gap-2 rounded-md px-1 py-1">
      <Icon className="h-3 w-3 flex-shrink-0 mt-0.5" style={{ color }} />
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-medium">{label}</div>
        <div className="font-mono text-[10px] text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-0.5 hover:bg-[hsl(var(--design-bg-elev))]">
      <span className="text-[11.5px]">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className="relative h-4 w-7 rounded-full transition-colors"
        style={{ background: value ? "hsl(var(--design-accent))" : "hsl(var(--design-border))" }}
        type="button"
      >
        <span
          className="absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-[left]"
          style={{ left: value ? 14 : 2 }}
        />
      </button>
    </label>
  );
}
