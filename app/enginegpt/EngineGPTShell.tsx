"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceProvider, useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import { CustomerProvider } from "@/lib/contexts/CustomerContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import Image from "next/image";
import { signOut } from "next-auth/react";

export default function EngineGPTShell({
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
          const cb = encodeURIComponent(window.location.origin + "/");
          router.replace("/login?callbackUrl=" + cb);
        } else {
          setAuthChecked(true);
        }
      })
      .catch(() => {
        const cb = encodeURIComponent(window.location.origin + "/");
        router.replace("/login?callbackUrl=" + cb);
      });
  }, [router]);

  if (!authChecked) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  return (
    <WorkspaceProvider>
      <CustomerProvider>
        <TooltipProvider>
          <EngineGPTAccessGuard>
            <div className="flex h-dvh bg-background overflow-hidden">
              {children}
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
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  const ws = wsCtx?.selectedWorkspace;
  if (ws && ws.accessEngineGpt === false) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="text-center px-4">
          <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <Image
              src="/assets/logo_engine_icon.svg"
              alt="EngineGPT"
              width={32}
              height={32}
              className="opacity-50"
            />
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
