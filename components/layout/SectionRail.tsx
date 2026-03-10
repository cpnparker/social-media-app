"use client";

import { Package, Gauge, Sparkles, Brain, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  navigateToSubdomain,
  getCurrentSubdomain,
  isProductionHost,
} from "@/lib/subdomain";

// ────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────

export type Area = "engine" | "operations" | "enginegpt" | "meetingbrain" | "admin";

interface RailItem {
  area: Area;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortLabel: string;
  hidden: boolean;
}

// ────────────────────────────────────────────────
// Navigation helpers
// ────────────────────────────────────────────────

/** Subdomain key for each area (admin shares engine's subdomain) */
const SUBDOMAIN_KEYS: Record<Area, "engine" | "operations" | "ai" | "meetingbrain"> = {
  engine: "engine",
  operations: "operations",
  enginegpt: "ai",
  meetingbrain: "meetingbrain",
  admin: "engine",
};

/** Landing paths used on localhost (all areas share one host) */
const LOCAL_PATHS: Record<Area, string> = {
  engine: "/dashboard",
  operations: "/operations/commissioned-cus",
  enginegpt: "/enginegpt",
  meetingbrain: "/meetingbrain",
  admin: "/settings/workspace",
};

/** Paths to pass when navigating cross-subdomain on production.
 *  `undefined` falls back to the subdomain's default root ("/"). */
const PROD_PATHS: Partial<Record<Area, string>> = {
  engine: "/dashboard",
  operations: "/operations/commissioned-cus",
  admin: "/settings/workspace",
};

/**
 * Navigate to a different area.
 *
 * - Same-area click → no-op
 * - Cross-subdomain (production) or separate app (EngineGPT / MeetingBrain on localhost) → navigate
 * - Same host → call `onLocalSwitch` (e.g. to swap the Sidebar panel) or navigate locally
 */
function navigateToArea(
  targetArea: Area,
  currentArea: Area,
  onLocalSwitch?: (area: Area) => void
) {
  if (targetArea === currentArea) return;

  // ── Production: subdomain-based routing ──
  if (isProductionHost()) {
    const currentSub = getCurrentSubdomain();
    const targetSub = SUBDOMAIN_KEYS[targetArea];

    if (currentSub !== targetSub) {
      navigateToSubdomain(targetSub, PROD_PATHS[targetArea]);
      return;
    }

    // Same subdomain (e.g. engine ↔ admin)
    if (onLocalSwitch) {
      onLocalSwitch(targetArea);
    } else {
      window.location.href = LOCAL_PATHS[targetArea];
    }
    return;
  }

  // ── Localhost: all areas share one host ──
  // EngineGPT has its own layout; MeetingBrain is a separate app.
  // Always use full navigation for these.
  if (targetArea === "enginegpt" || targetArea === "meetingbrain") {
    window.location.href = LOCAL_PATHS[targetArea];
    return;
  }

  // Engine / Operations / Admin — switch panel or navigate
  if (onLocalSwitch) {
    onLocalSwitch(targetArea);
  } else {
    window.location.href = LOCAL_PATHS[targetArea];
  }
}

// ────────────────────────────────────────────────
// Hook: useRailItems
// ────────────────────────────────────────────────

export function useRailItems(): { items: RailItem[]; visibleCount: number } {
  const wsCtx = useWorkspaceSafe();
  const ws = wsCtx?.selectedWorkspace;

  const items: RailItem[] = [
    { area: "engine",       icon: Package,  label: "The Engine",     shortLabel: "Engine", hidden: !(ws?.accessEngine ?? true) },
    { area: "operations",   icon: Gauge,    label: "Operations",     shortLabel: "Ops",    hidden: !(ws?.accessOperations ?? false) },
    { area: "enginegpt",    icon: Sparkles, label: "EngineGPT",      shortLabel: "GPT",    hidden: !(ws?.accessEngineGpt ?? true) },
    { area: "meetingbrain", icon: Brain,    label: "MeetingBrain",   shortLabel: "MB",     hidden: !(ws?.accessMeetingBrain ?? false) },
    { area: "admin",        icon: Settings, label: "Administration", shortLabel: "Admin",  hidden: !(ws?.accessAdmin ?? true) },
  ];

  const visibleCount = items.filter((i) => !i.hidden).length;
  return { items, visibleCount };
}

// ────────────────────────────────────────────────
// Desktop Rail Icons (vertical column)
// ────────────────────────────────────────────────

interface SectionRailProps {
  currentArea: Area;
  /** Called instead of navigating when the target is on the same host/subdomain */
  onLocalSwitch?: (area: Area) => void;
}

export function SectionRailDesktop({ currentArea, onLocalSwitch }: SectionRailProps) {
  const { items } = useRailItems();

  return (
    <div className="flex flex-col items-center gap-1">
      {items
        .filter((item) => !item.hidden)
        .map((item) => (
          <Tooltip key={item.area} delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigateToArea(item.area, currentArea, onLocalSwitch)}
                className={cn(
                  "relative flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-150",
                  item.area === currentArea
                    ? "bg-white/15 text-white"
                    : "text-white/50 hover:bg-white/10 hover:text-white/80"
                )}
              >
                {item.area === currentArea && (
                  <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-blue-400" />
                )}
                <item.icon className="h-[18px] w-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {item.label}
            </TooltipContent>
          </Tooltip>
        ))}
    </div>
  );
}

// ────────────────────────────────────────────────
// Mobile Section Tabs (horizontal pill bar)
// ────────────────────────────────────────────────

export function SectionRailMobile({ currentArea, onLocalSwitch }: SectionRailProps) {
  const { items } = useRailItems();

  return (
    <div className="lg:hidden px-3 pt-3 pb-2">
      <div className="flex items-center gap-1 bg-white/10 rounded-lg p-0.5">
        {items
          .filter((i) => !i.hidden)
          .map((item) => (
            <button
              key={item.area}
              onClick={() => navigateToArea(item.area, currentArea, onLocalSwitch)}
              className={cn(
                "flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors text-center",
                item.area === currentArea
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-white/50 hover:text-white/80"
              )}
            >
              {item.shortLabel}
            </button>
          ))}
      </div>
    </div>
  );
}
