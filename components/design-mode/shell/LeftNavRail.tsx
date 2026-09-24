"use client";

import { MessageSquare, BookOpen, Compass, Sparkles, Activity, Brain, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface LeftNavRailProps {
  active?: "chat" | "library" | "explore" | "design" | "operations" | "memory" | "trust";
  userInitial?: string;
}

const ITEMS = [
  { id: "chat",        icon: MessageSquare, label: "Chat",       href: "/" },
  { id: "library",     icon: BookOpen,      label: "Library",    href: "/" },
  { id: "explore",     icon: Compass,       label: "Explore",    href: "/" },
  { id: "design",      icon: Sparkles,      label: "Design",     href: "/design" },
  { id: "operations",  icon: Activity,      label: "Operations", href: "/" },
  { id: "memory",      icon: Brain,         label: "Memory",     href: "/" },
  { id: "trust",       icon: ShieldCheck,   label: "Trust",      href: "/" },
] as const;

/**
 * Outer EngineAI nav rail — 56px slate column. Sits to the left of the design
 * shell. The "Design" item is the active one when we're on /design.
 */
export function LeftNavRail({ active = "design", userInitial = "C" }: LeftNavRailProps) {
  return (
    <nav
      className="flex h-full w-14 flex-col items-center gap-1 py-3"
      style={{ background: "hsl(var(--slate-1))", color: "hsl(var(--slate-text-1))" }}
      aria-label="EngineAI services"
    >
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.id;
        return (
          <a
            key={item.id}
            href={item.href}
            title={item.label}
            className={cn(
              "relative flex h-10 w-10 items-center justify-center rounded-md transition-colors",
              isActive
                ? "text-white"
                : "text-[hsl(var(--slate-text-2))] hover:bg-[hsl(var(--slate-2))] hover:text-white",
            )}
            style={isActive ? { background: "hsl(var(--design-accent) / 0.18)" } : undefined}
          >
            {isActive && (
              <span
                aria-hidden
                className="absolute -left-3 h-6 w-[2.5px] rounded-full"
                style={{ background: "hsl(var(--design-accent))" }}
              />
            )}
            <Icon className="h-[18px] w-[18px]" />
          </a>
        );
      })}
      <div className="flex-1" />
      <div
        className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-medium"
        style={{ background: "hsl(var(--slate-3))", color: "hsl(var(--slate-text-1))" }}
        title="Account"
      >
        {userInitial}
      </div>
    </nav>
  );
}
