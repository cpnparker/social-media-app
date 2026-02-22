"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  PenSquare,
  CalendarDays,
  ListOrdered,
  Inbox,
  BarChart3,
  Link2,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Zap,
  ChevronsUpDown,
  Users,
  Check,
  Lightbulb,
  FileText,
  KanbanSquare,
  RefreshCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useState, useEffect, useCallback, useRef } from "react";
import { useTeamSafe } from "@/lib/contexts/TeamContext";

interface NavItem {
  label: string;
  href: string;
  icon: any;
  badgeKey?: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    label: "Ideas",
    items: [
      { label: "All Ideas", href: "/ideas", icon: Lightbulb },
    ],
  },
  {
    label: "Content",
    items: [
      { label: "Content Items", href: "/content", icon: FileText },
      { label: "Production Board", href: "/production", icon: KanbanSquare },
    ],
  },
  {
    label: "Social Media",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Compose", href: "/compose", icon: PenSquare },
      { label: "Calendar", href: "/calendar", icon: CalendarDays },
      { label: "Queue", href: "/queue", icon: ListOrdered },
      { label: "Inbox", href: "/inbox", icon: Inbox, badgeKey: "inbox" },
      { label: "Analytics", href: "/analytics", icon: BarChart3 },
      { label: "Accounts", href: "/accounts", icon: Link2 },
    ],
  },
  {
    label: "Management",
    items: [
      { label: "Replay Queue", href: "/replay-queue", icon: RefreshCcw },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);
  const teamDropdownRef = useRef<HTMLDivElement>(null);
  const teamCtx = useTeamSafe();

  // Section collapse state — persisted in localStorage
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const stored = localStorage.getItem("sidebar-sections");
      if (stored) setCollapsedSections(JSON.parse(stored));
    } catch {}
  }, []);

  const toggleSection = (label: string) => {
    setCollapsedSections((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try {
        localStorage.setItem("sidebar-sections", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Auto-expand section containing active route
  useEffect(() => {
    for (const section of sections) {
      const hasActive = section.items.some(
        (item) =>
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(item.href))
      );
      if (hasActive && collapsedSections[section.label]) {
        setCollapsedSections((prev) => {
          const next = { ...prev, [section.label]: false };
          try {
            localStorage.setItem("sidebar-sections", JSON.stringify(next));
          } catch {}
          return next;
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const fetchInboxCount = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox?type=conversations&limit=50");
      if (!res.ok) return;
      const data = await res.json();
      const conversations =
        data.conversations || data.comments || data.reviews || data.data || [];
      const unread = Array.isArray(conversations)
        ? conversations.filter(
            (c: any) => c.status === "open" || c.unread === true
          ).length
        : 0;
      setInboxCount(unread || (Array.isArray(conversations) ? conversations.length : 0));
    } catch {
      setInboxCount(0);
    }
  }, []);

  useEffect(() => {
    fetchInboxCount();
    const interval = setInterval(fetchInboxCount, 60000);
    return () => clearInterval(interval);
  }, [fetchInboxCount]);

  // Close team dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        teamDropdownRef.current &&
        !teamDropdownRef.current.contains(e.target as Node)
      ) {
        setTeamDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const badges: Record<string, number> = {};
  if (inboxCount > 0) badges.inbox = inboxCount;

  const renderNavItem = (item: NavItem) => {
    const isActive =
      pathname === item.href ||
      (item.href !== "/dashboard" && pathname.startsWith(item.href));
    const Icon = item.icon;

    const linkContent = (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClose}
        className={cn(
          "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all",
          isActive
            ? "bg-blue-500/15 text-blue-400"
            : "text-white/60 hover:bg-white/[0.06] hover:text-white",
          collapsed && "justify-center px-0 w-12 mx-auto"
        )}
      >
        <Icon
          className={cn(
            "h-[18px] w-[18px] shrink-0",
            isActive
              ? "text-blue-400"
              : "text-white/40 group-hover:text-white/70"
          )}
        />
        {!collapsed && (
          <>
            <span className="truncate">{item.label}</span>
            {item.badgeKey && badges[item.badgeKey] > 0 && (
              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[11px] font-semibold text-white">
                {badges[item.badgeKey]}
              </span>
            )}
          </>
        )}
      </Link>
    );

    if (collapsed) {
      return (
        <Tooltip key={item.href}>
          <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            {item.label}
            {item.badgeKey && badges[item.badgeKey] > 0 && (
              <span className="ml-2 text-blue-400">
                ({badges[item.badgeKey]})
              </span>
            )}
          </TooltipContent>
        </Tooltip>
      );
    }

    return linkContent;
  };

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "h-screen sticky top-0 flex flex-col border-r border-white/[0.08] bg-[var(--sidebar)] text-[var(--sidebar-foreground)] transition-all duration-300",
          collapsed ? "w-[72px]" : "w-[260px]"
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            "flex items-center gap-3 px-5 h-16 border-b border-white/[0.08] shrink-0",
            collapsed && "justify-center px-0"
          )}
        >
          <div className="h-9 w-9 rounded-lg bg-blue-500 flex items-center justify-center shrink-0">
            <Zap className="h-5 w-5 text-white" />
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <p className="text-sm font-bold text-white truncate tracking-tight">
                The Content Engine
              </p>
              <p className="text-[11px] text-white/40 truncate">
                Social Media Management
              </p>
            </div>
          )}
        </div>

        {/* Team Selector */}
        {teamCtx && teamCtx.teams.length > 0 && !collapsed && (
          <div className="px-3 mt-3" ref={teamDropdownRef}>
            <div className="relative">
              <button
                onClick={() => setTeamDropdownOpen(!teamDropdownOpen)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] transition-colors text-left"
              >
                <div className="h-6 w-6 rounded bg-violet-500/20 flex items-center justify-center shrink-0">
                  <Users className="h-3.5 w-3.5 text-violet-400" />
                </div>
                <span className="text-sm font-medium text-white/80 truncate flex-1">
                  {teamCtx.selectedTeamId === "all"
                    ? "All Teams"
                    : teamCtx.selectedTeam?.name || "Select Team"}
                </span>
                <ChevronsUpDown className="h-3.5 w-3.5 text-white/40 shrink-0" />
              </button>

              {teamDropdownOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border border-white/[0.08] bg-[var(--sidebar)] shadow-xl overflow-hidden">
                  <button
                    onClick={() => {
                      teamCtx.setSelectedTeam("all");
                      setTeamDropdownOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:bg-white/[0.06] transition-colors"
                  >
                    <Users className="h-3.5 w-3.5 text-white/40" />
                    <span className="flex-1 text-left truncate">All Teams</span>
                    {teamCtx.selectedTeamId === "all" && (
                      <Check className="h-3.5 w-3.5 text-blue-400" />
                    )}
                  </button>
                  <div className="border-t border-white/[0.06]" />
                  {teamCtx.teams.map((team) => (
                    <button
                      key={team.id}
                      onClick={() => {
                        teamCtx.setSelectedTeam(team.id);
                        setTeamDropdownOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:bg-white/[0.06] transition-colors"
                    >
                      <div className="h-5 w-5 rounded bg-violet-500/20 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-violet-400">
                          {team.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="flex-1 text-left truncate">
                        {team.name}
                      </span>
                      <span className="text-[11px] text-white/30">
                        {team.accountCount} acc
                      </span>
                      {teamCtx.selectedTeamId === team.id && (
                        <Check className="h-3.5 w-3.5 text-blue-400" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {teamCtx && teamCtx.teams.length > 0 && collapsed && (
          <div className="px-2 mt-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    if (!teamCtx.teams.length) return;
                    const currentIdx = teamCtx.teams.findIndex(
                      (t) => t.id === teamCtx.selectedTeamId
                    );
                    const nextIdx = (currentIdx + 1) % (teamCtx.teams.length + 1);
                    if (nextIdx === teamCtx.teams.length) {
                      teamCtx.setSelectedTeam("all");
                    } else {
                      teamCtx.setSelectedTeam(teamCtx.teams[nextIdx].id);
                    }
                  }}
                  className="w-12 h-10 mx-auto flex items-center justify-center rounded-lg bg-white/[0.06] hover:bg-white/[0.1] transition-colors"
                >
                  <Users className="h-4 w-4 text-violet-400" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="font-medium">
                {teamCtx.selectedTeamId === "all"
                  ? "All Teams"
                  : teamCtx.selectedTeam?.name || "Select Team"}
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Compose button */}
        <div className={cn("px-3 mt-4 mb-2", collapsed && "px-2")}>
          <Link href="/compose">
            <Button
              className={cn(
                "w-full bg-blue-500 hover:bg-blue-600 text-white font-medium shadow-lg shadow-blue-500/20 transition-all",
                collapsed ? "h-10 w-10 p-0 mx-auto" : "h-11 gap-2"
              )}
            >
              <PenSquare className="h-4 w-4" />
              {!collapsed && "New Post"}
            </Button>
          </Link>
        </div>

        {/* Section-based Navigation */}
        <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
          {sections.map((section) => {
            const isSectionCollapsed = collapsedSections[section.label] || false;

            return (
              <div key={section.label}>
                {/* Section header */}
                {!collapsed ? (
                  <button
                    onClick={() => toggleSection(section.label)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 mt-2 first:mt-0 text-[11px] font-semibold uppercase tracking-wider text-white/30 hover:text-white/50 transition-colors"
                  >
                    <ChevronDown
                      className={cn(
                        "h-3 w-3 transition-transform",
                        isSectionCollapsed && "-rotate-90"
                      )}
                    />
                    <span>{section.label}</span>
                  </button>
                ) : (
                  <div className="my-2 mx-3 border-t border-white/[0.06]" />
                )}

                {/* Section items */}
                {(!isSectionCollapsed || collapsed) && (
                  <div className="space-y-0.5">
                    {section.items.map((item) => renderNavItem(item))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Collapse toggle */}
        <div className="px-3 pb-4 pt-2 border-t border-white/[0.08]">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-all w-full",
              collapsed && "justify-center px-0 w-12 mx-auto"
            )}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
