"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Settings,
  ChevronsUpDown,
  Check,
  Lightbulb,
  FileText,
  Share2,
  FolderKanban,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  LogOut,
  Plus,
  Home,
  Search,
  Inbox,
  Building2,
  UserPlus,
  ListChecks,
  Link2,
  CreditCard,
  Boxes,
  Users,
  Sparkles,
  FileSearch,
  Globe,
  PenTool,
  Brain,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useState, useEffect, useCallback } from "react";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import { signOut } from "next-auth/react";
import { getSubdomainUrl } from "@/lib/subdomain";
import { SectionRailDesktop, SectionRailMobile, type Area, type ExtendedArea } from "@/components/layout/SectionRail";
import dynamic from "next/dynamic";

const ClientContextDialog = dynamic(
  () => import("@/components/ai-writer/ClientContextDialog"),
  { ssr: false }
);

// ────────────────────────────────────────────────
// Types & constants
// ────────────────────────────────────────────────

interface NavSubItem {
  label: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  children?: NavSubItem[];
}

interface NavSection {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavSubItem[];
  defaultOpen?: boolean;
}

const deriveArea = (pathname: string): ExtendedArea => {
  if (pathname.startsWith("/rfp-tool")) return "rfp-tool";
  if (pathname.startsWith("/operations")) return "operations";
  if (pathname.startsWith("/meetingbrain")) return "meetingbrain";
  if (
    pathname.startsWith("/settings") ||
    pathname === "/accounts" ||
    pathname === "/inbox"
  )
    return "admin";
  return "engine";
};


// ── Engine sections (collapsible) ──
const engineSections: NavSection[] = [
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
    label: "Content Items",
    icon: FileText,
    defaultOpen: false,
    items: [
      { label: "In Progress", href: "/content?status=in-progress" },
      { label: "All Content", href: "/content" },
    ],
  },
  {
    label: "Social Media",
    icon: Share2,
    defaultOpen: false,
    items: [
      { label: "Social Media Calendar", href: "/calendar" },
      { label: "Social Media Schedule", href: "/queue" },
      { label: "Replay Social Media", href: "/replay-queue" },
      { label: "All Social Promos", href: "/social-promos" },
      { label: "Compose New", href: "/compose" },
      { label: "Analytics", href: "/analytics" },
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
];

// ── Operations items (grouped) ──
const operationsItems: NavSubItem[] = [
  {
    label: "Content",
    href: "/operations/commissioned-cus",
    children: [
      { label: "Commissioned", href: "/operations/commissioned-cus" },
      { label: "Delivered", href: "/operations/delivered" },
      { label: "Spiked", href: "/operations/spiked" },
    ],
  },
  {
    label: "Contracts",
    href: "/operations/contracts",
    children: [
      { label: "Contracts", href: "/operations/contracts" },
      { label: "Contracts Grid", href: "/operations/contracts-grid" },
      { label: "Formats", href: "/operations/formats" },
      { label: "Profitability", href: "/operations/profitability" },
    ],
  },
  {
    label: "Production",
    href: "/operations/timeline-resourcing",
    children: [
      { label: "Timeline Resourcing", href: "/operations/timeline-resourcing" },
      { label: "Team Production", href: "/operations/team-production" },
      { label: "Work in Progress", href: "/operations/work-in-progress" },
    ],
  },
  { label: "Duty Editor", href: "/operations/duty-editor" },
];

// ── Admin items (flat list) ──
const adminItems: NavSubItem[] = [
  { label: "Accounts", href: "/accounts", icon: Building2 },
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Workspace", href: "/settings/workspace", icon: Settings },
  { label: "Customers", href: "/settings/customers", icon: Building2 },
  { label: "Users", href: "/settings/users", icon: UserPlus },
  { label: "Templates", href: "/settings/templates", icon: ListChecks },
  { label: "Content Units", href: "/settings/content-units", icon: Boxes },
  { label: "Content Formats", href: "/settings/content-formats", icon: FileText },
  { label: "AI Usage", href: "/settings/ai-usage", icon: Sparkles },
  { label: "Links", href: "/settings/links", icon: Link2 },
  { label: "Billing", href: "/settings/billing", icon: CreditCard },
];

// ── RFP Tool items (flat list) ──
const rfpToolItems: NavSubItem[] = [
  { label: "Discover RFPs", href: "/rfp-tool?tab=discover", icon: Globe },
  { label: "Company Profile", href: "/rfp-tool?tab=library", icon: FileText },
  { label: "Pipeline", href: "/rfp-tool?tab=pipeline", icon: FolderKanban },
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
  const [userRole, setUserRole] = useState<string>("none");
  const [userName, setUserName] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string>("");
  const wsCtx = useWorkspaceSafe();

  // Compute initials from user name (e.g. "Ed Rycroft" → "ER")
  const userInitials = userName
    ? userName
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  const showAdmin = wsCtx?.selectedWorkspace?.accessAdmin ?? false;
  const [clientContextOpen, setClientContextOpen] = useState(false);

  const [activeArea, setActiveArea] = useState<ExtendedArea>(() => deriveArea(pathname));

  // Auto-update area when pathname changes (e.g. direct navigation)
  useEffect(() => {
    setActiveArea(deriveArea(pathname));
  }, [pathname]);

  // Track which engine sections are open
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    () => {
      const initial: Record<string, boolean> = {};
      engineSections.forEach((section) => {
        initial[section.label] = section.defaultOpen ?? false;
      });
      return initial;
    }
  );

  const toggleSection = (label: string) => {
    setOpenSections((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  // ── User profile (role, name, email) ──
  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.user?.role) setUserRole(d.user.role);
        if (d.user?.name) setUserName(d.user.name);
        if (d.user?.email) setUserEmail(d.user.email);
      })
      .catch(() => {});
  }, []);

  // EngineGPT visibility (used by EnginePanel for the quick-launch link)
  const showEngineGpt = wsCtx?.selectedWorkspace?.accessEngineGpt ?? true;

  // ── Inbox count ──
  const fetchInboxCount = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox?type=conversations&limit=50");
      if (!res.ok) return;
      const data = await res.json();
      const conversations =
        data.conversations || data.comments || data.reviews || data.data || [];
      const unread = Array.isArray(conversations)
        ? conversations.filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // ── Route matching ──
  const checkActive = (href: string) => {
    const [basePath, queryString] = href.split("?");

    if (queryString) {
      if (pathname !== basePath) return false;
      const hrefParams = new URLSearchParams(queryString);
      let allMatch = true;
      hrefParams.forEach((value, key) => {
        if (searchParams.get(key) !== value) allMatch = false;
      });
      return allMatch;
    }

    if (pathname === basePath) {
      return searchParams.toString() === "";
    }

    // Also match sub-pages (e.g. /settings/customers/123 matches /settings/customers)
    if (pathname.startsWith(basePath + "/")) return true;

    return false;
  };

  return (
    <aside className="h-screen sticky top-0 flex w-[260px]">
      {/* ═══════ Icon Rail ═══════ */}
      <div className="hidden lg:flex flex-col items-center w-12 bg-[#2e3440] py-3 shrink-0">
        {/* Logo */}
        <a href={getSubdomainUrl("engine", "/dashboard")} onClick={onClose} className="mb-4">
          <div className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
            <img
              src="/assets/logo_engine_icon.svg"
              alt="Home"
              width={24}
              height={24}
              className="h-6 w-6 brightness-0 invert"
            />
          </div>
        </a>

        {/* Area icons */}
        <SectionRailDesktop currentArea={activeArea} onLocalSwitch={setActiveArea} />

        <div className="flex-1" />

        {/* User avatar at bottom of rail */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-white/10 transition-colors">
              <Avatar className="h-7 w-7">
                <AvatarImage src="" />
                <AvatarFallback className="bg-blue-500/30 text-blue-200 text-[10px] font-semibold">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" className="w-56 ml-1">
            <div className="px-3 py-2">
              <p className="text-sm font-medium">{userName || "User"}</p>
              <p className="text-xs text-muted-foreground">{userEmail || ""}</p>
            </div>
            {showAdmin && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Administration</p>
                </div>
                {adminItems.map((item) => (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link href={item.href} className="gap-2">
                      {item.icon && <item.icon className="h-4 w-4" />}
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
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
              onClick={() => setClientContextOpen(true)}
              className="gap-2"
            >
              <Brain className="h-4 w-4" />
              Client Context
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

        <ClientContextDialog
          open={clientContextOpen}
          onClose={() => setClientContextOpen(false)}
        />
      </div>

      {/* ═══════ Sidebar Panel ═══════ */}
      <div className="flex-1 flex flex-col bg-[#3b4252] text-white overflow-hidden">
        {/* ── Mobile area switcher (visible only on mobile) ── */}
        <SectionRailMobile currentArea={activeArea} onLocalSwitch={setActiveArea} />

        {/* ── Panel content based on area ── */}
        {(activeArea === "engine" || activeArea === "admin") && (
          <EnginePanel
            wsCtx={wsCtx}
            sections={engineSections}
            openSections={openSections}
            toggleSection={toggleSection}
            checkActive={checkActive}
            inboxCount={inboxCount}
            onClose={onClose}
            pathname={pathname}
            showEngineGpt={showEngineGpt}
          />
        )}

        {activeArea === "operations" && (
          <OperationsPanel
            items={operationsItems}
            checkActive={checkActive}
            onClose={onClose}
          />
        )}

        {activeArea === "rfp-tool" && (
          <RfpToolPanel
            items={rfpToolItems}
            checkActive={checkActive}
            onClose={onClose}
          />
        )}

        {/* User profile — mobile only (desktop uses rail avatar) */}
        <div className="lg:hidden border-t border-white/10 px-3 py-3 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-white/10 transition-colors text-left">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src="" />
                  <AvatarFallback className="bg-blue-500/30 text-blue-200 text-xs font-semibold">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate text-white">
                    {userName || "User"}
                  </p>
                  <p className="text-[10px] text-white/50 truncate">
                    {userEmail || ""}
                  </p>
                </div>
                <ChevronsUpDown className="h-3 w-3 text-white/40 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-56 mb-1">
              {showAdmin && (
                <>
                  <div className="px-2 py-1.5">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Administration</p>
                  </div>
                  {adminItems.map((item) => (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link href={item.href} className="gap-2" onClick={onClose}>
                        {item.icon && <item.icon className="h-4 w-4" />}
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {!showAdmin && (
                <DropdownMenuItem asChild>
                  <Link href="/settings/workspace" className="gap-2">
                    <Settings className="h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setClientContextOpen(true)}
                className="gap-2"
              >
                <Brain className="h-4 w-4" />
                Client Context
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
      </div>
    </aside>
  );
}

// ────────────────────────────────────────────────
// Engine Panel
// ────────────────────────────────────────────────
function EnginePanel({
  wsCtx,
  sections,
  openSections,
  toggleSection,
  checkActive,
  inboxCount,
  onClose,
  pathname,
  showEngineGpt,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wsCtx: any;
  sections: NavSection[];
  openSections: Record<string, boolean>;
  toggleSection: (label: string) => void;
  checkActive: (href: string) => boolean;
  inboxCount: number;
  onClose?: () => void;
  pathname: string;
  showEngineGpt: boolean;
}) {
  return (
    <>
      {/* Workspace Switcher */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        {wsCtx && wsCtx.workspaces.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-white/10 transition-colors text-left">
                <div className="h-7 w-7 rounded-md shrink-0 flex items-center justify-center lg:hidden">
                  <img
                    src="/assets/logo_engine_icon.svg"
                    alt=""
                    width={28}
                    height={28}
                    className="h-7 w-7 brightness-0 invert"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold tracking-tight truncate text-white">
                    {wsCtx.selectedWorkspace?.name || "Workspace"}
                  </p>
                  <p className="text-[10px] text-white/40 capitalize">
                    {wsCtx.selectedWorkspace?.plan || "free"} plan
                  </p>
                </div>
                <ChevronsUpDown className="h-3 w-3 text-white/40 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="bottom" className="w-56">
              {wsCtx.workspaces.map((ws: { id: string; name: string; plan: string; role: string }) => (
                <DropdownMenuItem
                  key={ws.id}
                  onClick={() => wsCtx.setSelectedWorkspace(ws.id)}
                  className="gap-2"
                >
                  <img
                    src="/assets/logo_engine_icon.svg"
                    alt=""
                    width={20}
                    height={20}
                    className="h-5 w-5 shrink-0 dark:brightness-0 dark:invert"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ws.name}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">
                      {ws.plan} &middot; {ws.role}
                    </p>
                  </div>
                  {wsCtx.selectedWorkspace?.id === ws.id && (
                    <Check className="h-4 w-4 text-blue-500 shrink-0" />
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2">
                <Plus className="h-4 w-4" />
                Create Workspace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex items-center gap-2.5 px-2 py-1">
            <div className="h-7 w-7 rounded-md shrink-0 flex items-center justify-center lg:hidden">
              <img
                src="/assets/logo_engine_icon.svg"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 brightness-0 invert"
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold tracking-tight truncate text-white">
                {wsCtx?.selectedWorkspace?.name || "The Content Engine"}
              </p>
              <p className="text-[10px] text-white/40 capitalize">
                {wsCtx?.selectedWorkspace?.plan || "free"} plan
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Add New Idea CTA */}
      <div className="px-3 pb-3">
        <Link
          href="/ideas/new"
          onClick={onClose}
          className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-[#023250] hover:bg-[#034170] transition-colors text-white text-[13px] font-semibold"
        >
          <Plus className="h-4 w-4" />
          Add New Idea
        </Link>
      </div>

      {/* Home link */}
      <div className="px-3 pb-1">
        <Link
          href="/dashboard"
          onClick={onClose}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
            pathname === "/dashboard"
              ? "bg-white/15 text-white"
              : "text-white/70 hover:bg-white/10 hover:text-white"
          )}
        >
          <Home className={cn("h-[16px] w-[16px]", pathname === "/dashboard" && "text-blue-400")} />
          Home
        </Link>
      </div>

      {/* EngineAI link */}
      {showEngineGpt && (
        <div className="px-3 pb-1">
          <a
            href={getSubdomainUrl("ai")}
            onClick={onClose}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
              "text-white/70 hover:bg-white/10 hover:text-white"
            )}
          >
            <Sparkles className="h-[16px] w-[16px] text-violet-400" />
            EngineAI
          </a>
        </div>
      )}

      {/* Navigation sections */}
      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-3 pb-4 mt-1">
        <div className="space-y-0.5">
          {sections.map((section) => {
            const Icon = section.icon;
            const isOpen = openSections[section.label];
            const hasActiveChild = section.items.some((item) =>
              checkActive(item.href)
            );

            return (
              <div key={section.label}>
                <button
                  onClick={() => toggleSection(section.label)}
                  className={cn(
                    "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold transition-colors",
                    hasActiveChild
                      ? "text-white"
                      : "text-white/80 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Icon className={cn(
                    "h-[16px] w-[16px] shrink-0",
                    hasActiveChild && (
                      section.label === "Ideas" ? "text-amber-400" :
                      section.label === "Content Items" ? "text-blue-400" :
                      section.label === "Social Media" ? "text-violet-400" :
                      section.label === "Project Plans" ? "text-emerald-400" :
                      "text-white"
                    )
                  )} />
                  <span className="flex-1 text-left truncate">
                    {section.label}
                  </span>
                  {isOpen ? (
                    <ChevronUp className="h-3.5 w-3.5 shrink-0 text-white/50" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-white/50" />
                  )}
                </button>

                {isOpen && (
                  <div className="ml-2.5 mt-0.5 space-y-0.5">
                    {section.items.map((item) => {
                      const active = checkActive(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={onClose}
                          className={cn(
                            "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors",
                            active
                              ? "bg-white/15 text-white font-medium"
                              : "text-white/60 hover:bg-white/10 hover:text-white/90"
                          )}
                        >
                          <ChevronRight className="h-3 w-3 shrink-0" />
                          <span className="truncate">{item.label}</span>
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
    </>
  );
}

// ────────────────────────────────────────────────
// Operations Panel
// ────────────────────────────────────────────────
function OperationsPanel({
  items,
  checkActive,
  onClose,
}: {
  items: NavSubItem[];
  checkActive: (href: string) => boolean;
  onClose?: () => void;
}) {
  return (
    <>
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="flex items-center gap-2.5 px-2 py-1">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold tracking-tight truncate text-white">
              Operations
            </p>
            <p className="text-[10px] text-white/40">
              Management &amp; Oversight
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-3 pb-4">
        <div className="space-y-0.5">
          {items.map((item) => {
            const active = checkActive(item.href);
            const childActive = item.children?.some((c) => checkActive(c.href)) ?? false;
            const showChildren = active || childActive;
            return (
              <div key={item.href}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-white/15 text-white"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <ChevronRight className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    (active || childActive)
                      ? (item.label === "Content" ? "text-blue-400" :
                         item.label === "Contracts" ? "text-emerald-400" :
                         item.label === "Production" ? "text-orange-400" :
                         item.label === "Duty Editor" ? "text-violet-400" :
                         "text-white/40")
                      : "text-white/40"
                  )} />
                  <span className="truncate">{item.label}</span>
                </Link>
                {item.children && showChildren && (
                  <div className="ml-5 mt-0.5 space-y-0.5">
                    {item.children.map((child, idx) => {
                      const cActive = checkActive(child.href);
                      return (
                        <Link
                          key={`${child.href}-${idx}`}
                          href={child.href}
                          onClick={onClose}
                          className={cn(
                            "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                            cActive
                              ? "bg-white/15 text-white"
                              : "text-white/50 hover:bg-white/10 hover:text-white/80"
                          )}
                        >
                          <span className="h-1 w-1 rounded-full bg-white/30 shrink-0" />
                          <span className="truncate">{child.label}</span>
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
    </>
  );
}

// ────────────────────────────────────────────────
// RFP Tool Panel
// ────────────────────────────────────────────────
function RfpToolPanel({
  items,
  checkActive,
  onClose,
}: {
  items: NavSubItem[];
  checkActive: (href: string) => boolean;
  onClose?: () => void;
}) {
  return (
    <>
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="flex items-center gap-2.5 px-2 py-1">
          <FileSearch className="h-4 w-4 text-cyan-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold tracking-tight truncate text-white">
              RFP Tool
            </p>
            <p className="text-[10px] text-white/40">
              Find &amp; Respond to RFPs
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-3 pb-4">
        <div className="space-y-0.5">
          {items.map((item) => {
            const active = checkActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                  active
                    ? "bg-white/15 text-white"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                )}
              >
                {Icon && <Icon className="h-4 w-4 shrink-0 text-white/50" />}
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

