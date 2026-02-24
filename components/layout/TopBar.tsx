"use client";

import Link from "next/link";
import {
  Bell,
  Menu,
  Sun,
  Moon,
  Monitor,
  Settings,
  Users,
  LogOut,
  Building2,
  Globe,
  Check,
  ChevronDown,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "next-auth/react";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";
import { cn } from "@/lib/utils";

interface TopBarProps {
  onMenuClick?: () => void;
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const { setTheme } = useTheme();
  const customerCtx = useCustomerSafe();

  const customers = customerCtx?.customers ?? [];
  const selectedCustomerId = customerCtx?.selectedCustomerId ?? null;
  const selectedCustomer = customerCtx?.selectedCustomer ?? null;
  const canViewAll = customerCtx?.canViewAll ?? true;
  const isSingleCustomer = customerCtx?.isSingleCustomer ?? false;
  const loading = customerCtx?.loading ?? true;

  const displayName = selectedCustomer?.name ?? "All Customers";
  const isCustomerMode = selectedCustomerId !== null;

  return (
    <header className="sticky top-0 z-30 h-14 border-b bg-background/80 backdrop-blur-xl flex items-center justify-between px-4 sm:px-6 gap-4">
      {/* Mobile menu button */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden shrink-0"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Spacer */}
      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        {/* Customer Selector */}
        {!loading && customers.length > 0 && (
          <>
            {isSingleCustomer ? (
              /* Single customer — static label, no dropdown */
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 mr-1">
                <Building2 className="h-4 w-4 text-blue-500 shrink-0" />
                <span className="text-sm font-medium truncate max-w-[180px]">
                  {displayName}
                </span>
              </div>
            ) : (
              /* Multi-customer / admin — dropdown selector */
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "gap-2 h-9 px-3 mr-1 max-w-[220px] font-medium",
                      isCustomerMode &&
                        "border-blue-500/30 bg-blue-500/5 text-blue-600 dark:text-blue-400"
                    )}
                  >
                    {isCustomerMode ? (
                      <Building2 className="h-4 w-4 shrink-0 text-blue-500" />
                    ) : (
                      <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{displayName}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {canViewAll && (
                    <>
                      <DropdownMenuItem
                        onClick={() =>
                          customerCtx?.setSelectedCustomerId(null)
                        }
                        className="gap-2"
                      >
                        <Globe className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1">All Customers</span>
                        {!isCustomerMode && (
                          <Check className="h-4 w-4 text-blue-500" />
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {customers.map((customer) => (
                    <DropdownMenuItem
                      key={customer.id}
                      onClick={() =>
                        customerCtx?.setSelectedCustomerId(customer.id)
                      }
                      className="gap-2"
                    >
                      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate">{customer.name}</span>
                      {selectedCustomerId === customer.id && (
                        <Check className="h-4 w-4 text-blue-500 shrink-0" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}

        {/* Theme toggle */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative h-9 w-9">
              <Sun className="h-[18px] w-[18px] text-muted-foreground rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-[18px] w-[18px] text-muted-foreground rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Toggle theme</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem
              onClick={() => setTheme("light")}
              className="gap-2"
            >
              <Sun className="h-4 w-4" />
              <span>Light</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setTheme("dark")}
              className="gap-2"
            >
              <Moon className="h-4 w-4" />
              <span>Dark</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setTheme("system")}
              className="gap-2"
            >
              <Monitor className="h-4 w-4" />
              <span>System</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-[18px] w-[18px] text-muted-foreground" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-blue-500" />
        </Button>

        {/* Profile avatar dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative h-9 w-9 rounded-full"
            >
              <Avatar className="h-8 w-8">
                <AvatarImage src="" />
                <AvatarFallback className="bg-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-semibold">
                  CP
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-3 py-2">
              <p className="text-sm font-medium">Chris Parker</p>
              <p className="text-xs text-muted-foreground">
                chris@contentengine.io
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings/workspace" className="gap-2">
                <Settings className="h-4 w-4" />
                Settings
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
    </header>
  );
}
