"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Bell,
  Menu,
  Sun,
  Moon,
  Monitor,
  Settings,
  LogOut,
  Building2,
  Globe,
  Check,
  ChevronDown,
  Loader2,
  Search,
  Inbox,
  UserPlus,
  ListChecks,
  Boxes,
  FileText,
  Link2,
  CreditCard,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { signOut } from "next-auth/react";
import { useCustomerSafe } from "@/lib/contexts/CustomerContext";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import { cn } from "@/lib/utils";

interface TopBarProps {
  onMenuClick?: () => void;
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const { setTheme, resolvedTheme } = useTheme();
  const customerCtx = useCustomerSafe();
  const wsCtx = useWorkspaceSafe();
  const showAdmin = wsCtx?.selectedWorkspace?.accessAdmin ?? false;

  // Fetch user info from /api/me (same pattern as Sidebar)
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.user) {
          setUserName(d.user.name || "");
          setUserEmail(d.user.email || "");
        }
      })
      .catch(() => {});
  }, []);

  const userInitials = userName
    ? userName
        .split(" ")
        .map((w: string) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  // Prevent hydration mismatch — only render theme-dependent UI after mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Customer selector popover state
  const [customerOpen, setCustomerOpen] = useState(false);

  const customers = customerCtx?.customers ?? [];
  const selectedCustomerId = customerCtx?.selectedCustomerId ?? null;
  const selectedCustomer = customerCtx?.selectedCustomer ?? null;
  const canViewAll = customerCtx?.canViewAll ?? true;
  const isSingleCustomer = customerCtx?.isSingleCustomer ?? false;
  const loading = customerCtx?.loading ?? true;

  // Sort customers alphabetically
  const sortedCustomers = useMemo(
    () => [...customers].sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [customers]
  );

  const displayName = selectedCustomer?.name ?? "All Customers";
  const isCustomerMode = selectedCustomerId !== null;

  return (
    <header className="sticky top-0 z-30 h-14 border-b bg-background/80 backdrop-blur-xl flex items-center px-4 sm:px-6 gap-2">
      {/* Mobile menu button */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden shrink-0"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Spacer pushes everything to the right */}
      <div className="flex-1 min-w-0" />

      {/* Right-side items — fixed layout that doesn't shift */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Customer Selector — reserves space even while loading */}
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-1.5 h-9 mr-1">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : customers.length > 0 ? (
          <>
            {isSingleCustomer ? (
              /* Single customer — static label, no dropdown */
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 h-9 mr-1">
                <Building2 className="h-4 w-4 text-blue-500 shrink-0" />
                <span className="text-sm font-medium truncate max-w-[180px]">
                  {displayName}
                </span>
              </div>
            ) : (
              /* Multi-customer / admin — searchable selector */
              <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    role="combobox"
                    aria-expanded={customerOpen}
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
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 p-0">
                  <Command>
                    <CommandInput placeholder="Search customers..." />
                    <CommandList>
                      <CommandEmpty>No customer found.</CommandEmpty>
                      {canViewAll && (
                        <CommandGroup>
                          <CommandItem
                            value="all-customers"
                            onSelect={() => {
                              customerCtx?.setSelectedCustomerId(null);
                              setCustomerOpen(false);
                            }}
                            className="gap-2"
                          >
                            <Globe className="h-4 w-4 text-muted-foreground" />
                            <span className="flex-1">All Customers</span>
                            {!isCustomerMode && (
                              <Check className="h-4 w-4 text-blue-500" />
                            )}
                          </CommandItem>
                        </CommandGroup>
                      )}
                      {canViewAll && <CommandSeparator />}
                      <CommandGroup>
                        {sortedCustomers.map((customer) => (
                          <CommandItem
                            key={customer.id}
                            value={customer.name}
                            onSelect={() => {
                              customerCtx?.setSelectedCustomerId(customer.id);
                              setCustomerOpen(false);
                            }}
                            className="gap-2"
                          >
                            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="flex-1 truncate">{customer.name}</span>
                            {selectedCustomerId === customer.id && (
                              <Check className="h-4 w-4 text-blue-500 shrink-0" />
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </>
        ) : null}

        {/* Theme toggle — only renders after mount to prevent hydration flash */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9">
              {mounted ? (
                resolvedTheme === "dark" ? (
                  <Moon className="h-[18px] w-[18px] text-muted-foreground" />
                ) : (
                  <Sun className="h-[18px] w-[18px] text-muted-foreground" />
                )
              ) : (
                <div className="h-[18px] w-[18px]" />
              )}
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
        <Button variant="ghost" size="icon" className="h-9 w-9">
          <Bell className="h-[18px] w-[18px] text-muted-foreground" />
          <span className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full bg-blue-500" />
        </Button>

        {/* Profile avatar dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full"
            >
              <Avatar className="h-8 w-8">
                <AvatarImage src="" />
                <AvatarFallback className="bg-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-semibold">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-3 py-2">
              <p className="text-sm font-medium">{userName || "User"}</p>
              <p className="text-xs text-muted-foreground">
                {userEmail || ""}
              </p>
            </div>
            {showAdmin && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Administration</p>
                </div>
                <DropdownMenuItem asChild>
                  <Link href="/accounts" className="gap-2">
                    <Building2 className="h-4 w-4" />
                    Accounts
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/inbox" className="gap-2">
                    <Inbox className="h-4 w-4" />
                    Inbox
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings/workspace" className="gap-2">
                    <Settings className="h-4 w-4" />
                    Workspace
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings/customers" className="gap-2">
                    <Building2 className="h-4 w-4" />
                    Customers
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings/users" className="gap-2">
                    <UserPlus className="h-4 w-4" />
                    Users
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings/templates" className="gap-2">
                    <ListChecks className="h-4 w-4" />
                    Templates
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings/content-units" className="gap-2">
                    <Boxes className="h-4 w-4" />
                    Content Units
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings/content-formats" className="gap-2">
                    <FileText className="h-4 w-4" />
                    Content Formats
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings/links" className="gap-2">
                    <Link2 className="h-4 w-4" />
                    Links
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings/billing" className="gap-2">
                    <CreditCard className="h-4 w-4" />
                    Billing
                  </Link>
                </DropdownMenuItem>
              </>
            )}
            {!showAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings/workspace" className="gap-2">
                    <Settings className="h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
              </>
            )}
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
