"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { CustomerProvider } from "@/lib/contexts/CustomerContext";
import { WorkspaceProvider } from "@/lib/contexts/WorkspaceContext";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Client-side auth guard (replaces middleware during Vercel middleware outage)
  useEffect(() => {
    fetch("/api/me")
      .then((r) => {
        if (!r.ok) {
          router.replace(`/login?callbackUrl=${encodeURIComponent(pathname)}`);
        } else {
          setAuthChecked(true);
        }
      })
      .catch(() => {
        router.replace("/login");
      });
  }, [router, pathname]);

  // Operations subdomain redirect
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.location.hostname === "operations.thecontentengine.com" &&
      pathname === "/"
    ) {
      router.replace("/operations/commissioned-cus");
    }
  }, [router, pathname]);

  if (!authChecked) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  return (
    <WorkspaceProvider>
    <CustomerProvider>
    <TooltipProvider>
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar: hidden on mobile, shown on lg+ */}
      <div
        className={`
          fixed inset-y-0 left-0 z-50 lg:static lg:z-auto shrink-0
          transform transition-transform duration-300 ease-in-out
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          lg:translate-x-0
        `}
      >
        <Suspense>
          <Sidebar onClose={() => setSidebarOpen(false)} />
        </Suspense>
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-muted/30">
          {children}
        </main>
      </div>
    </div>
    </TooltipProvider>
    </CustomerProvider>
    </WorkspaceProvider>
  );
}
