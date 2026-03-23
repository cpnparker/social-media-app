"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceProvider, useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import { CustomerProvider } from "@/lib/contexts/CustomerContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import Image from "next/image";
import { signOut } from "next-auth/react";

export default function EngineAIShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const [authChecked, setAuthChecked] = useState(false);
  const [authRetries, setAuthRetries] = useState(0);
  const router = useRouter();

  // Auth guard — only redirect to login on 401 (not on 500 or network errors)
  useEffect(() => {
    let cancelled = false;
    const checkAuth = async () => {
      try {
        const r = await fetch("/api/me");
        if (cancelled) return;
        if (r.status === 401) {
          // Truly not authenticated — redirect to login
          const cb = encodeURIComponent(window.location.origin + "/");
          router.replace("/login?callbackUrl=" + cb);
        } else if (r.ok) {
          setAuthChecked(true);
        } else {
          // Server error (500, 404, etc.) — retry a few times before giving up
          console.warn(`[EngineAI] /api/me returned ${r.status}, retry ${authRetries + 1}`);
          if (authRetries < 3) {
            setTimeout(() => setAuthRetries((n) => n + 1), 1500);
          } else {
            // After retries, try to show the app anyway (workspace guard will catch access issues)
            setAuthChecked(true);
          }
        }
      } catch {
        // Network error — retry
        if (!cancelled && authRetries < 3) {
          setTimeout(() => setAuthRetries((n) => n + 1), 1500);
        }
      }
    };
    checkAuth();
    return () => { cancelled = true; };
  }, [router, authRetries]);

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
          <EngineAIAccessGuard>
            <div className="flex h-dvh bg-background overflow-hidden">
              {children}
            </div>
          </EngineAIAccessGuard>
        </TooltipProvider>
      </CustomerProvider>
    </WorkspaceProvider>
  );
}

// ── Access guard: checks user has EngineAI access ──
function EngineAIAccessGuard({ children }: { children: React.ReactNode }) {
  const wsCtx = useWorkspaceSafe();
  const [retrying, setRetrying] = useState(false);

  // Debug logging
  useEffect(() => {
    if (wsCtx && !wsCtx.loading) {
      console.log("[EngineAI Access Guard]", {
        workspaceCount: wsCtx.workspaces.length,
        selectedWorkspace: wsCtx.selectedWorkspace
          ? {
              id: wsCtx.selectedWorkspace.id,
              name: wsCtx.selectedWorkspace.name,
              accessEngineGpt: wsCtx.selectedWorkspace.accessEngineGpt,
              accessEngine: wsCtx.selectedWorkspace.accessEngine,
              role: wsCtx.selectedWorkspace.role,
            }
          : null,
      });
    }
  }, [wsCtx]);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    await wsCtx?.refreshWorkspaces();
    setRetrying(false);
  }, [wsCtx]);

  if (wsCtx?.loading || retrying) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  const ws = wsCtx?.selectedWorkspace;
  const noWorkspace = !ws;
  const noAccess = ws && !ws.accessEngineGpt;

  if (noWorkspace || noAccess) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="text-center px-4">
          <Image
            src="/assets/logo_engine_icon.svg"
            alt="EngineAI"
            width={48}
            height={48}
            className="mx-auto mb-4 opacity-50 dark:brightness-0 dark:invert"
          />
          <h1 className="text-xl font-bold mb-2">
            {noWorkspace ? "No Workspace Found" : "Access Restricted"}
          </h1>
          <p className="text-sm text-muted-foreground max-w-sm">
            {noWorkspace
              ? "Your account isn't linked to a workspace yet. Try signing out and back in, or contact your workspace admin to be added."
              : "You don't have access to EngineAI. Contact your workspace admin to request access."}
          </p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              onClick={handleRetry}
              className="text-sm text-primary underline"
            >
              Retry
            </button>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-sm text-primary underline"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
