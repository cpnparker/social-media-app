"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceProvider, useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import { CustomerProvider, useCustomerSafe } from "@/lib/contexts/CustomerContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Sparkles,
  LogOut,
  Building2,
  ChevronsUpDown,
  Check,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export default function EngineGPTLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [authChecked, setAuthChecked] = useState(false);
  const router = useRouter();

  // Auth guard
  useEffect(() => {
    fetch("/api/me")
      .then((r) => {
        if (!r.ok) {
          router.replace("/login?callbackUrl=/");
        } else {
          setAuthChecked(true);
        }
      })
      .catch(() => {
        router.replace("/login");
      });
  }, [router]);

  if (!authChecked) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  return (
    <WorkspaceProvider>
      <CustomerProvider>
        <TooltipProvider>
          <EngineGPTAccessGuard>
            <div className="flex flex-col h-screen bg-background">
              <StandaloneHeader />
              <main className="flex-1 overflow-hidden">{children}</main>
            </div>
          </EngineGPTAccessGuard>
        </TooltipProvider>
      </CustomerProvider>
    </WorkspaceProvider>
  );
}

// ── Access guard: checks user has EngineGPT access ──
function EngineGPTAccessGuard({ children }: { children: React.ReactNode }) {
  const wsCtx = useWorkspaceSafe();

  if (wsCtx?.loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  const ws = wsCtx?.selectedWorkspace;
  if (ws && ws.accessEngineGpt === false) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center px-4">
          <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="h-8 w-8 text-destructive" />
          </div>
          <h1 className="text-xl font-bold mb-2">Access Restricted</h1>
          <p className="text-sm text-muted-foreground max-w-sm">
            You don&apos;t have access to EngineGPT. Contact your workspace admin to
            request access.
          </p>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="mt-6 text-sm text-primary underline"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

// ── Standalone header bar ──
function StandaloneHeader() {
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const customerCtx = useCustomerSafe();

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.user?.name) setUserName(d.user.name);
        if (d.user?.email) setUserEmail(d.user.email);
      })
      .catch(() => {});
  }, []);

  const userInitials = userName
    ? userName
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  const customers = customerCtx?.customers || [];
  const selectedCustomer = customerCtx?.selectedCustomer;
  const canViewAll = customerCtx?.canViewAll ?? false;

  return (
    <header className="shrink-0 border-b bg-background">
      <div className="flex items-center justify-between h-14 px-4 max-w-5xl mx-auto w-full">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <span className="text-base font-bold tracking-tight">EngineGPT</span>
        </div>

        {/* Right: Client dropdown + User */}
        <div className="flex items-center gap-3">
          {/* Client dropdown */}
          {customers.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="max-w-[140px] truncate">
                    {selectedCustomer?.name || "All Clients"}
                  </span>
                  <ChevronsUpDown className="h-3 w-3 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {canViewAll && (
                  <>
                    <DropdownMenuItem
                      onClick={() => customerCtx?.setSelectedCustomerId(null)}
                      className="gap-2"
                    >
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1">All Clients</span>
                      {!selectedCustomer && (
                        <Check className="h-4 w-4 text-primary shrink-0" />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {customers.map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onClick={() => customerCtx?.setSelectedCustomerId(c.id)}
                    className="gap-2"
                  >
                    {c.logoUrl ? (
                      <img
                        src={c.logoUrl}
                        alt=""
                        className="h-4 w-4 rounded object-cover"
                      />
                    ) : (
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="flex-1 truncate">{c.name}</span>
                    {selectedCustomer?.id === c.id && (
                      <Check className="h-4 w-4 text-primary shrink-0" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/50 transition-colors">
                <Avatar className="h-7 w-7">
                  <AvatarImage src="" />
                  <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium hidden sm:inline max-w-[100px] truncate">
                  {userName || "User"}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-3 py-2">
                <p className="text-sm font-medium">{userName || "User"}</p>
                <p className="text-xs text-muted-foreground">{userEmail}</p>
              </div>
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
      </div>
    </header>
  );
}
