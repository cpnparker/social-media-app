"use client";

import { cn } from "@/lib/utils";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useRouter } from "next/navigation";
import {
  RAIL_ITEMS,
  navigateToArea,
  getAreaUrl,
  isProductionHost,
  type Area,
  type RailItemConfig,
} from "@cpnparker/engine-nav";

// Re-export Area so existing consumers don't need to change their imports
export type { Area } from "@cpnparker/engine-nav";

// ────────────────────────────────────────────────
// Access-flag mapping (Content-Engine-specific)
// ────────────────────────────────────────────────

const ACCESS_FLAG_KEYS: Record<Area, "accessEngine" | "accessOperations" | "accessEngineGpt" | "accessMeetingBrain" | "accessAdmin"> = {
  engine: "accessEngine",
  operations: "accessOperations",
  enginegpt: "accessEngineGpt",
  meetingbrain: "accessMeetingBrain",
  admin: "accessAdmin",
};

interface RailItem extends RailItemConfig {
  hidden: boolean;
}

// ────────────────────────────────────────────────
// Hook: useRailItems
// ────────────────────────────────────────────────

export function useRailItems(): { items: RailItem[]; visibleCount: number } {
  const wsCtx = useWorkspaceSafe();
  const ws = wsCtx?.selectedWorkspace;

  const items: RailItem[] = RAIL_ITEMS.map((item) => ({
    ...item,
    hidden: !(ws?.[ACCESS_FLAG_KEYS[item.area]] ?? false),
  }));

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
  const router = useRouter();

  const handleClick = (area: Area) => {
    if (area === "admin") {
      // Admin navigates directly to settings instead of switching sidebar panel
      if (isProductionHost()) {
        window.location.href = getAreaUrl("admin");
      } else {
        router.push("/settings/workspace");
      }
      return;
    }
    navigateToArea(area, currentArea, { onLocalSwitch });
  };

  return (
    <div className="flex flex-col items-center gap-1">
      {items
        .filter((item) => !item.hidden)
        .map((item) => (
          <Tooltip key={item.area} delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                onClick={() => handleClick(item.area)}
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
  const router = useRouter();

  const handleClick = (area: Area) => {
    if (area === "admin") {
      if (isProductionHost()) {
        window.location.href = getAreaUrl("admin");
      } else {
        router.push("/settings/workspace");
      }
      return;
    }
    navigateToArea(area, currentArea, { onLocalSwitch });
  };

  return (
    <div className="lg:hidden px-3 pt-3 pb-2">
      <div className="flex items-center gap-1 bg-white/10 rounded-lg p-0.5">
        {items
          .filter((i) => !i.hidden)
          .map((item) => (
            <button
              key={item.area}
              onClick={() => handleClick(item.area)}
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
