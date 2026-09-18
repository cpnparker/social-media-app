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
  isProductionHost,
  DEFAULT_HOST_CONFIG,
  type Area,
} from "@cpnparker/engine-nav";
import { FileSearch, Shield } from "lucide-react";

// Re-export Area so existing consumers don't need to change their imports
export type { Area } from "@cpnparker/engine-nav";
export type { ExtendedArea };

// ────────────────────────────────────────────────
// Access-flag mapping (Content-Engine-specific)
// ────────────────────────────────────────────────

type ExtendedArea = Area | "rfp-tool" | "authorityon" | "engineai";

const ACCESS_FLAG_KEYS: Record<string, "accessEngine" | "accessOperations" | "accessEngineGpt" | "accessMeetingBrain" | "accessAdmin"> = {
  engine: "accessEngine",
  operations: "accessOperations",
  enginegpt: "accessEngineGpt",  // DB column stays as enginegpt
  engineai: "accessEngineGpt",   // UI key maps to same DB column
  meetingbrain: "accessMeetingBrain",
  admin: "accessAdmin",
};

interface ExtendedRailItemConfig {
  area: ExtendedArea;
  icon: any;
  label: string;
  shortLabel: string;
}

interface RailItem extends ExtendedRailItemConfig {
  hidden: boolean;
}

// Custom rail items (inserted after MeetingBrain, before Admin)
const RFP_TOOL_ITEM: ExtendedRailItemConfig = {
  area: "rfp-tool",
  icon: FileSearch,
  label: "RFP Tool",
  shortLabel: "RFP",
};

const AUTHORITYON_ITEM: ExtendedRailItemConfig = {
  area: "authorityon",
  icon: Shield,
  label: "AuthorityOn",
  shortLabel: "Auth",
};

// ────────────────────────────────────────────────
// Hook: useRailItems
// ────────────────────────────────────────────────

export function useRailItems(): { items: RailItem[]; visibleCount: number } {
  const wsCtx = useWorkspaceSafe();
  const ws = wsCtx?.selectedWorkspace;

  // Build items from package, injecting RFP Tool after MeetingBrain
  // Admin is excluded from the rail — it lives in the user profile dropdown instead
  const items: RailItem[] = [];
  for (const item of RAIL_ITEMS) {
    if (item.area === "admin") continue; // Admin accessed via profile dropdown
    items.push({
      ...item,
      hidden: !(ws?.[ACCESS_FLAG_KEYS[item.area]] ?? false),
    });
    // Insert RFP Tool and AuthorityOn after MeetingBrain
    if (item.area === "meetingbrain") {
      items.push({
        ...RFP_TOOL_ITEM,
        hidden: !(ws?.accessRfpTool ?? false),
      });
      items.push({
        ...AUTHORITYON_ITEM,
        hidden: !(ws?.accessAuthorityOn ?? false),
      });
    }
  }

  const visibleCount = items.filter((i) => !i.hidden).length;
  return { items, visibleCount };
}

// ────────────────────────────────────────────────
// Desktop Rail Icons (vertical column)
// ────────────────────────────────────────────────

interface SectionRailProps {
  currentArea: ExtendedArea;
  /** Called instead of navigating when the target is on the same host/subdomain */
  onLocalSwitch?: (area: ExtendedArea) => void;
}

// Map "engineai" to "enginegpt" for comparison with package RAIL_ITEMS
const normalizeArea = (area: ExtendedArea): ExtendedArea =>
  area === "engineai" ? "enginegpt" as ExtendedArea : area;

export function SectionRailDesktop({ currentArea, onLocalSwitch }: SectionRailProps) {
  const { items } = useRailItems();
  const router = useRouter();
  const normalizedCurrent = normalizeArea(currentArea);

  const handleClick = (area: ExtendedArea) => {
    if (area === "rfp-tool") {
      if (isProductionHost()) {
        window.location.href = `https://${DEFAULT_HOST_CONFIG.hosts.engine}/rfp-tool`;
      } else {
        router.push("/rfp-tool");
      }
      return;
    }
    if (area === "authorityon") {
      window.location.href = isProductionHost()
        ? "https://authority.thecontentengine.com/"
        : "/";
      return;
    }
    navigateToArea(area as Area, currentArea as Area, { onLocalSwitch: onLocalSwitch as ((area: Area) => void) | undefined });
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
                  item.area === normalizedCurrent
                    ? "bg-white/15 text-white"
                    : "text-white/50 hover:bg-white/10 hover:text-white/80"
                )}
              >
                {item.area === normalizedCurrent && (
                  <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-blue-400" />
                )}
                {(() => { const Icon = item.icon as any; return <Icon className="h-[18px] w-[18px]" />; })()}
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
  const normalizedCurrent = normalizeArea(currentArea);

  const handleClick = (area: ExtendedArea) => {
    if (area === "rfp-tool") {
      if (isProductionHost()) {
        window.location.href = `https://${DEFAULT_HOST_CONFIG.hosts.engine}/rfp-tool`;
      } else {
        router.push("/rfp-tool");
      }
      return;
    }
    if (area === "authorityon") {
      window.location.href = isProductionHost()
        ? "https://authority.thecontentengine.com/"
        : "/";
      return;
    }
    navigateToArea(area as Area, currentArea as Area, { onLocalSwitch: onLocalSwitch as ((area: Area) => void) | undefined });
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
                item.area === normalizedCurrent
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
