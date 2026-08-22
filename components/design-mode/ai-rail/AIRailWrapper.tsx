"use client";

import { useState } from "react";
import { Sparkles, ChevronRight } from "lucide-react";
import { AIRailSide } from "./AIRailSide";
import type { DesignShot } from "@/lib/design/types";

interface AIRailWrapperProps {
  currentShot: DesignShot | null;
  workspaceId: string | null;
  clientId: number | null;
  contentId: number | null;
  designSessionId?: string | null;
  allShots?: DesignShot[];
  briefExcerpt?: string | null;
  brandSummary?: string | null;
  onAssetReady?: () => void;
  defaultOpen?: boolean;
}

/**
 * Wraps AIRailSide with collapse/expand. When collapsed the rail shrinks to
 * a 48px column with a single "Ask Engine AI" button. The canvas gets the
 * reclaimed space.
 */
export function AIRailWrapper(props: AIRailWrapperProps) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);

  if (!open) {
    return (
      <aside
        className="flex w-12 flex-shrink-0 flex-col items-center gap-2 border-l py-3"
        style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg-elev))" }}
      >
        <button
          onClick={() => setOpen(true)}
          className="group relative flex h-10 w-10 items-center justify-center rounded-full transition-colors"
          style={{ background: "hsl(var(--design-accent-soft))", color: "hsl(var(--design-accent))" }}
          title="Open Engine AI"
        >
          <Sparkles className="h-4 w-4" />
          <span
            className="pointer-events-none absolute right-12 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border bg-[hsl(var(--design-bg-elev))] px-2 py-1 text-[11px] opacity-0 shadow transition-opacity group-hover:opacity-100"
            style={{ borderColor: "hsl(var(--design-border))" }}
          >
            Ask Engine AI
          </span>
        </button>
        <div className="mt-1 w-full px-1.5">
          <div
            className="rotate-180 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            style={{ writingMode: "vertical-rl" }}
          >
            Engine AI
          </div>
        </div>
      </aside>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(false)}
        className="absolute -left-3 top-3 z-20 flex h-6 w-6 items-center justify-center rounded-full border bg-[hsl(var(--design-bg-elev))] shadow-sm hover:border-[hsl(var(--design-accent))]/40"
        style={{ borderColor: "hsl(var(--design-border))" }}
        title="Collapse"
      >
        <ChevronRight className="h-3 w-3" />
      </button>
      <AIRailSide {...props} onClose={() => setOpen(false)} />
    </div>
  );
}
