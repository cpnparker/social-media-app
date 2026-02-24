"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Settings, Users, UserPlus, ListChecks, Link2, CreditCard, Boxes } from "lucide-react";

const settingsNav = [
  { label: "Workspace", href: "/settings/workspace", icon: Settings },
  { label: "Users", href: "/settings/users", icon: UserPlus },
  { label: "Team", href: "/settings/team", icon: Users },
  { label: "Templates", href: "/settings/templates", icon: ListChecks },
  { label: "Content Units", href: "/settings/content-units", icon: Boxes },
  { label: "Links", href: "/settings/links", icon: Link2 },
  { label: "Billing", href: "/settings/billing", icon: CreditCard },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="max-w-5xl space-y-6">
      {/* Page title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your workspace, team, and preferences
        </p>
      </div>

      {/* Sub-navigation tabs */}
      <nav className="flex gap-1 border-b -mb-px">
        {settingsNav.map(({ label, href, icon: Icon }) => {
          const isActive =
            pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                isActive
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Settings content */}
      <div>{children}</div>
    </div>
  );
}
