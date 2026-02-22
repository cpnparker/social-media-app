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
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useState } from "react";

const navigation = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Compose",
    href: "/compose",
    icon: PenSquare,
  },
  {
    label: "Calendar",
    href: "/calendar",
    icon: CalendarDays,
  },
  {
    label: "Queue",
    href: "/queue",
    icon: ListOrdered,
  },
  {
    label: "Inbox",
    href: "/inbox",
    icon: Inbox,
    badge: 3,
  },
  {
    label: "Analytics",
    href: "/analytics",
    icon: BarChart3,
  },
  {
    label: "Accounts",
    href: "/accounts",
    icon: Link2,
  },
];

const bottomNav = [
  {
    label: "Settings",
    href: "/settings/workspace",
    icon: Settings,
  },
];

interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "h-screen sticky top-0 flex flex-col border-r border-white/[0.08] bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))] transition-all duration-300",
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

        {/* Navigation */}
        <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
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
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
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
                    {item.badge && (
                      <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[11px] font-semibold text-white">
                        {item.badge}
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
                    {item.badge && (
                      <span className="ml-2 text-blue-400">
                        ({item.badge})
                      </span>
                    )}
                  </TooltipContent>
                </Tooltip>
              );
            }

            return linkContent;
          })}
        </nav>

        {/* Bottom nav */}
        <div className="px-3 pb-2 space-y-1">
          {bottomNav.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const Icon = item.icon;

            const linkContent = (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
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
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent side="right" className="font-medium">
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              );
            }
            return linkContent;
          })}
        </div>

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
