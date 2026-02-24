"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
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
  Plus,
  Home,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Share2,
  FolderKanban,
  Megaphone,
  CalendarRange,
  Tag,
  Calendar,
  Flag,
} from "lucide-react";
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
// Nav structure — collapsible sections with sub-pages
// ────────────────────────────────────────────────
interface NavSubItem {
  label: string;
  href: string;
}

interface NavSection {
  label: string;
  icon: any;
  items: NavSubItem[];
  defaultOpen?: boolean;
}

const navSections: NavSection[] = [
  {
    label: "Ideas",
    icon: Lightbulb,
    defaultOpen: true,
    items: [
      { label: "New Ideas", href: "/ideas?status=new" },
      { label: "Commissioned", href: "/ideas?status=commissioned" },
      { label: "Spiked", href: "/ideas?status=spiked" },
    ],
  },
  {
    label: "Production",
    icon: KanbanSquare,
    defaultOpen: false,
    items: [
      { label: "Content Tasks", href: "/production" },
      { label: "Social Tasks", href: "/production?filter=social" },
    ],
  },
  {
    label: "Content Items",
    icon: FileText,
    defaultOpen: false,
    items: [
      { label: "Content In Progress", href: "/content?status=in-progress" },
      { label: "All Content Items", href: "/content" },
    ],
  },
  {
    label: "Social Media",
    icon: Share2,
    defaultOpen: false,
    items: [
      { label: "Social Media Calendar", href: "/calendar" },
      { label: "Social Media Schedule", href: "/queue" },
      { label: "Replay Social Promos", href: "/replay-queue" },
      { label: "All Social Promos", href: "/compose" },
    ],
  },
  {
    label: "Project Plans",
    icon: FolderKanban,
    defaultOpen: false,
    items: [
      { label: "Editorial Calendar", href: "/calendar/editorial" },
      { label: "Topics", href: "/topics" },
      { label: "Events", href: "/events" },
      { label: "Campaigns", href: "/campaigns" },
    ],
  },
  {
    label: "Management",
    icon: Settings,
    defaultOpen: false,
    items: [
      { label: "Accounts", href: "/accounts" },
      { label: "Analytics", href: "/analytics" },
      { label: "Inbox", href: "/inbox" },
      { label: "Settings", href: "/settings" },
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
  const searchParams = useSearchParams();
  const [inboxCount, setInboxCount] = useState(0);
  const teamCtx = useTeamSafe();

  // Track which sections are open
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    () => {
      const initial: Record<string, boolean> = {};
      navSections.forEach((section) => {
        initial[section.label] = section.defaultOpen ?? false;
      });
      return initial;
    }
  );

  const toggleSection = (label: string) => {
    setOpenSections((prev) => ({ ...prev, [label]: !prev[label] }));
  };

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

  const checkActive = (href: string) => {
    const [basePath, queryString] = href.split("?");

    // If the href has query params, require exact match on both path AND the specific param
    if (queryString) {
      if (pathname !== basePath) return false;
      const hrefParams = new URLSearchParams(queryString);
      let allMatch = true;
      hrefParams.forEach((value, key) => {
        if (searchParams.get(key) !== value) allMatch = false;
      });
      return allMatch;
    }

    // No query params: match path, but NOT if current URL has query params that belong to a sub-item
    // (e.g. /ideas should not highlight when on /ideas?status=new)
    if (pathname === basePath) {
      return searchParams.toString() === "";
    }

    return false;
  };

  return (
    <aside className="h-screen sticky top-0 flex flex-col w-[260px] bg-[#3b4252] text-white">
      {/* ──── Brand ──── */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-4 shrink-0">
        <div className="h-9 w-9 rounded-xl bg-blue-500 flex items-center justify-center shrink-0">
          <Zap className="h-4.5 w-4.5 text-white" />
        </div>
        <p className="text-[15px] font-bold tracking-tight truncate text-white">
          The Content Engine
        </p>
      </div>

      {/* ──── Add New Idea CTA ──── */}
      <div className="px-4 pb-4">
        <Link
          href="/ideas/new"
          onClick={onClose}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 transition-colors text-white text-sm font-semibold"
        >
          <Plus className="h-4 w-4" />
          Add New Idea
        </Link>
      </div>

      {/* ──── Home link ──── */}
      <div className="px-3 pb-1">
        <Link
          href="/dashboard"
          onClick={onClose}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            pathname === "/dashboard"
              ? "bg-white/15 text-white"
              : "text-white/70 hover:bg-white/10 hover:text-white"
          )}
        >
          <Home className="h-[18px] w-[18px]" />
          Home
        </Link>
      </div>

      {/* ──── Navigation Sections ──── */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4 mt-1">
        <div className="space-y-1">
          {navSections.map((section) => {
            const Icon = section.icon;
            const isOpen = openSections[section.label];
            const hasActiveChild = section.items.some((item) =>
              checkActive(item.href)
            );

            return (
              <div key={section.label}>
                {/* Section header - clickable toggle */}
                <button
                  onClick={() => toggleSection(section.label)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
                    hasActiveChild
                      ? "text-white"
                      : "text-white/80 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="flex-1 text-left truncate">
                    {section.label}
                  </span>
                  {section.label === "Management" &&
                    inboxCount > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[11px] font-semibold text-white mr-1">
                        {inboxCount}
                      </span>
                    )}
                  {isOpen ? (
                    <ChevronUp className="h-4 w-4 shrink-0 text-white/50" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-white/50" />
                  )}
                </button>

                {/* Sub-items - collapsible */}
                {isOpen && (
                  <div className="ml-3 mt-0.5 space-y-0.5">
                    {section.items.map((item) => {
                      const active = checkActive(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={onClose}
                          className={cn(
                            "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors",
                            active
                              ? "bg-white/15 text-white font-medium"
                              : "text-white/60 hover:bg-white/10 hover:text-white/90"
                          )}
                        >
                          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{item.label}</span>
                          {item.label === "Inbox" && inboxCount > 0 && (
                            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[11px] font-semibold text-white">
                              {inboxCount}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      {/* ──── User Profile ──── */}
      <div className="border-t border-white/10 px-3 py-3 shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/10 transition-colors text-left">
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarImage src="" />
                <AvatarFallback className="bg-blue-500/30 text-blue-200 text-sm font-semibold">
                  CP
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate text-white">
                  Chris Parker
                </p>
                <p className="text-[11px] text-white/50 truncate">
                  chris@contentengine.io
                </p>
              </div>
              <ChevronsUpDown className="h-3.5 w-3.5 text-white/40 shrink-0" />
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
