"use client";

import { useState } from "react";
import { Image as ImageIcon, Video, Film, Grid2x2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SESSION_TEMPLATES, type SessionTemplate } from "@/lib/design/templates";

interface QuickStartPickerProps {
  onPick: (templateId: string) => Promise<void>;
  onSkip: () => void;
}

const ICON_FOR: Record<SessionTemplate["icon"], React.ComponentType<{ className?: string }>> = {
  image: ImageIcon,
  video: Video,
  carousel: Grid2x2,
  reel: Film,
  broll: Film,
};

/**
 * Quick-start template picker. Shown in the canvas empty state.
 * Each card describes a template; click to apply and start with shots
 * already populated. 'Start from scratch' button skips the template.
 */
export function QuickStartPicker({ onPick, onSkip }: QuickStartPickerProps) {
  const [applying, setApplying] = useState<string | null>(null);

  async function applyTemplate(id: string) {
    if (applying) return;
    setApplying(id);
    try {
      await onPick(id);
    } finally {
      setApplying(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <div className="text-center space-y-1">
        <div className="section-label">Quick start</div>
        <p className="text-[12.5px] text-muted-foreground">
          Pick a starting point — or skip and build from scratch.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {SESSION_TEMPLATES.map((t) => {
          const Icon = ICON_FOR[t.icon] || ImageIcon;
          const isApplying = applying === t.id;
          return (
            <button
              key={t.id}
              onClick={() => applyTemplate(t.id)}
              disabled={!!applying}
              className={cn(
                "design-tile design-card group flex items-start gap-3 p-3 text-left transition-all",
                "hover:border-[hsl(var(--design-accent))]/40 disabled:opacity-50",
                isApplying && "border-[hsl(var(--design-accent))]",
              )}
            >
              <div
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md"
                style={{ background: "hsl(var(--design-accent-soft))", color: "hsl(var(--design-accent))" }}
              >
                {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="editorial-display text-[14px] leading-tight">{t.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {t.shots.length} shot{t.shots.length === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">
                  {t.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="pt-1 text-center">
        <button
          onClick={onSkip}
          disabled={!!applying}
          className="text-[11.5px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
        >
          Skip — start from scratch
        </button>
      </div>
    </div>
  );
}
