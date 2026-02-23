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
  Zap,
  ChevronsUpDown,
  Users,
  Check,
  Lightbulb,
  FileText,
  KanbanSquare,
  RefreshCcw,
  Search,
  LogOut,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState, useEffect, useCallback, useRef } from "react";
import { useTeamSafe } from "@/lib/contexts/TeamContext";
import { signOut } from "next-auth/react";

// ────────────────────────────────────────────────
// Nav structure — flat groups, no collapsing
// ────────────────────────────────────────────────
interface NavItem {
  label: string;
  href: string;
  icon: any;
  badgeKey?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Ideas",
    items: [{ label: "All Ideas", href: "/ideas", icon: Lightbulb }],
  },
  {
    label: "Content",
    items: [
      { label: "Content Items", href: "/content", icon: FileText },
      { label: "Production Board", href: "/production", icon: KanbanSquare },
    ],
  },
  {
    label: "Social",
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
    label: "Manage",
    items: [
      { label: "Replay Queue", href: "/replay-queue", icon: RefreshCcw },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

// ────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────
interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  const pathname = usePathname();
  const [inboxCount, setInboxCount] = useState(0);
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);
  const teamDropdownRef = useRef<HTMLDivElement>(null);
  const teamCtx = useTeamSafe();

  // ──── Inbox count ────
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
      setInboxCount(
        unread || (Array.isArray(conversations) ? conversations.length : 0)
      );
    } catch {
      setInboxCount(0);
    }
  }, []);

  useEffect(() => {
    fetchInboxCount();
    const interval = setInterval(fetchInboxCount, 60000);
    return () => clearInterval(interval);
  }, [fetchInboxCount]);

  // ──── Team dropdown outside-click ────
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

  const checkActive = (href: string) =>
    pathname === href ||
    (href !== "/dashboard" && pathname.startsWith(href));

  return (
    <aside className="h-screen sticky top-0 flex flex-col w-[260px] border-r border-border bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))]">
      {/* ──── Brand ──── */}
      <div className="flex items-center gap-3 px-5 h-14 shrink-0">
        <div className="h-8 w-8 rounded-xl bg-blue-500 flex items-center justify-center shrink-0">
          <Zap className="h-4 w-4 text-white" />
        </div>
        <p className="text-sm font-bold tracking-tight truncate">
          The Content Engine
        </p>
      </div>

      {/* ──── Search ──── */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search..."
            className="pl-9 h-9 text-sm bg-muted/50 border-0 focus-visible:ring-1 rounded-lg"
          />
        </div>
      </div>

      {/* ──── Team Selector ──── */}
      {teamCtx && teamCtx.teams.length > 0 && (
        <div className="px-4 pb-3" ref={teamDropdownRef}>
          <div className="relative">
            <button
              onClick={() => setTeamDropdownOpen(!teamDropdownOpen)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/60 hover:bg-muted transition-colors text-left"
            >
              <div className="h-6 w-6 rounded bg-violet-500/15 flex items-center justify-center shrink-0">
                <Users className="h-3.5 w-3.5 text-violet-500" />
              </div>
              <span className="text-sm font-medium truncate flex-1">
                {teamCtx.selectedTeamId === "all"
                  ? "All Teams"
                  : teamCtx.selectedTeam?.name || "Select Team"}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </button>

            {teamDropdownOpen && (
              <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
                <button
                  onClick={() => {
                    teamCtx.setSelectedTeam("all");
                    setTeamDropdownOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                >
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1 text-left truncate">All Teams</span>
                  {teamCtx.selectedTeamId === "all" && (
                    <Check className="h-3.5 w-3.5 text-primary" />
                  )}
                </button>
                <div className="border-t border-border" />
                {teamCtx.teams.map((team) => (
                  <button
                    key={team.id}
                    onClick={() => {
                      teamCtx.setSelectedTeam(team.id);
                      setTeamDropdownOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                  >
                    <div className="h-5 w-5 rounded bg-violet-500/15 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-bold text-violet-500">
                        {team.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span className="flex-1 text-left truncate">
                      {team.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {team.accountCount} acc
                    </span>
                    {teamCtx.selectedTeamId === team.id && (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ──── Navigation ──── */}
      <nav className="flex-1 overflow-y-auto px-3 pb-2">
        {navGroups.map((group, groupIdx) => (
          <div key={group.label} className={cn(groupIdx > 0 && "mt-5")}>
            {/* Group label */}
            <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {group.label}
            </p>

            {/* Group items */}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = checkActive(item.href);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
                      active
                        ? "bg-primary/10 text-primary font-medium border-l-[3px] border-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-[18px] w-[18px] shrink-0 transition-colors",
                        active
                          ? "text-primary"
                          : "text-muted-foreground/70 group-hover:text-foreground"
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                    {item.badgeKey && badges[item.badgeKey] > 0 && (
                      <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                        {badges[item.badgeKey]}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ──── User Profile ──── */}
      <div className="border-t border-border px-3 py-3 shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted transition-colors text-left">
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarImage src="" />
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                  CP
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">Chris Parker</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  chris@contentengine.io
                </p>
              </div>
              <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56 mb-1">
            <DropdownMenuItem asChild>
              <Link href="/settings/workspace" className="gap-2">
                <Settings className="h-4 w-4" />
                Workspace settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings/team" className="gap-2">
                <Users className="h-4 w-4" />
                Team members
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-destructive focus:text-destructive gap-2"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
