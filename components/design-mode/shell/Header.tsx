"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Search, ChevronDown, History, Lock, Users, EyeOff, FileText, BadgeCheck, Calendar, Info, Share2, Library } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { DesignClient, DesignContent, DesignSession } from "@/lib/design/types";

interface DesignSessionSummary {
  id: string;
  name: string;
  visibility: "private" | "team";
  isIncognito: boolean;
  clientName?: string | null;
  updatedAt: string;
  myPermission: "owner" | "view" | "collaborate" | null;
  sharedWithMe?: boolean;
}

interface HeaderProps {
  session: DesignSession | null;
  content: DesignContent | null;
  client: DesignClient | null;
  shotsCount: number;
  totalDuration: number;
  sessions: DesignSessionSummary[] | null;
  onLoadSessions: () => void;
  onSwitchSession: (id: string) => void;
  onNewSession: (opts?: { isIncognito?: boolean }) => void;
  onChangeVisibility: (v: "private" | "team") => void;
  onPublish: () => void;
  onBack: () => void;
  onOpenPalette?: () => void;
  onOpenShare?: () => void;
  onOpenLibrary?: () => void;
}

export function Header({
  session,
  content,
  client,
  shotsCount,
  totalDuration,
  sessions,
  onLoadSessions,
  onSwitchSession,
  onNewSession,
  onChangeVisibility,
  onPublish,
  onBack,
  onOpenPalette,
  onOpenShare,
  onOpenLibrary,
}: HeaderProps) {
  const beats = useMemo(() => {
    if (!content?.brief) return 0;
    // Simple heuristic — count sentences in the brief (cap at 6 for display)
    return Math.min(content.brief.split(/[.!?]\s/).filter(Boolean).length, 6) || 4;
  }, [content?.brief]);

  const dueLabel = content?.dueDate
    ? new Date(content.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "—";

  const isOwner = session?.myPermission === "owner";

  return (
    <header
      className="flex flex-col border-b"
      style={{ borderColor: "hsl(var(--design-border))", background: "hsl(var(--design-bg-elev))" }}
    >
      {/* Row 1 — chrome */}
      <div className="flex items-center gap-3 px-5 py-2.5">
        <button
          onClick={onBack}
          className="rounded-full p-1.5 text-muted-foreground hover:bg-[hsl(var(--design-border))]/40 hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="flex items-baseline gap-2">
          <h1 className="editorial-display text-[22px] leading-none tracking-tight">Design</h1>
          <span className="section-label muted">Studio · v2</span>
        </div>

        {/* Scope summary — one consolidated pill that opens a context popover */}
        <ScopeSummary
          session={session}
          content={content}
          client={client}
          isOwner={isOwner}
          onChangeVisibility={onChangeVisibility}
        />

        <div className="flex-1" />

        <button
          onClick={onOpenPalette}
          className="hidden items-center gap-1.5 rounded-full border border-[hsl(var(--design-border))] bg-[hsl(var(--design-bg))] px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-[hsl(var(--design-accent))]/40 hover:text-foreground md:flex"
        >
          <Search className="h-3 w-3" />
          <span>Search shots, refs</span>
          <kbd className="ml-1 rounded bg-[hsl(var(--design-border))]/60 px-1 text-[10px]">⌘K</kbd>
        </button>

        <DropdownMenu onOpenChange={(open) => open && onLoadSessions()}>
          <DropdownMenuTrigger asChild>
            <button className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--design-border))] bg-[hsl(var(--design-bg-elev))] px-3 py-1.5 text-xs font-medium hover:border-[hsl(var(--design-accent))]/40 hover:bg-[hsl(var(--design-accent-soft))]/50">
              <History className="h-3.5 w-3.5" /> Sessions
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Design sessions
            </DropdownMenuLabel>
            <div className="max-h-96 overflow-y-auto">
              {sessions === null ? (
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">Loading…</DropdownMenuItem>
              ) : sessions.length === 0 ? (
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">No sessions yet.</DropdownMenuItem>
              ) : (
                sessions.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    onClick={() => onSwitchSession(s.id)}
                    className={cn("flex flex-col items-start gap-0.5 text-xs", s.id === session?.id && "bg-muted")}
                  >
                    <div className="flex w-full items-center gap-1.5">
                      {s.isIncognito ? <EyeOff className="h-2.5 w-2.5 text-amber-600" /> :
                        s.visibility === "team" ? <Users className="h-2.5 w-2.5 text-purple-600" /> :
                        <Lock className="h-2.5 w-2.5 text-zinc-500" />}
                      <span className="flex-1 truncate font-medium">{s.name}</span>
                      {s.sharedWithMe && <span className="text-[9px] text-muted-foreground">shared</span>}
                    </div>
                    <div className="flex w-full items-center gap-1 text-[10px] text-muted-foreground">
                      {s.clientName && <span>{s.clientName}</span>}
                      {s.clientName && s.updatedAt && <span>·</span>}
                      {s.updatedAt && <span>{new Date(s.updatedAt).toLocaleDateString()}</span>}
                    </div>
                  </DropdownMenuItem>
                ))
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--design-border))] bg-[hsl(var(--design-bg-elev))] px-3 py-1.5 text-xs font-medium hover:border-[hsl(var(--design-accent))]/40">
              New
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => onNewSession()} className="gap-2 text-xs">
              <Lock className="h-3 w-3" />
              <span className="flex-1">New session</span>
              <span className="text-[10px] text-muted-foreground">private</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onNewSession({ isIncognito: true })} className="gap-2 text-xs">
              <EyeOff className="h-3 w-3 text-amber-600" />
              <span className="flex-1">Incognito session</span>
              <span className="text-[10px] text-muted-foreground">no save</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Asset library */}
        {onOpenLibrary && (
          <button
            onClick={onOpenLibrary}
            className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--design-border))] bg-[hsl(var(--design-bg-elev))] px-3 py-1.5 text-xs font-medium hover:border-[hsl(var(--design-accent))]/40"
            title="Asset library"
          >
            <Library className="h-3.5 w-3.5" /> Library
          </button>
        )}

        {/* Share — owner-only on non-incognito sessions */}
        {onOpenShare && session?.myPermission === "owner" && !session?.isIncognito && (
          <button
            onClick={onOpenShare}
            className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--design-border))] bg-[hsl(var(--design-bg-elev))] px-3 py-1.5 text-xs font-medium hover:border-[hsl(var(--design-accent))]/40"
            title="Share session"
          >
            <Share2 className="h-3.5 w-3.5" /> Share
          </button>
        )}

        <button
          onClick={onPublish}
          disabled={!session || session.myPermission === "view"}
          className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--design-accent))] px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-40"
        >
          Publish to Engine
        </button>
      </div>

      {/* Row 2 — brief bar */}
      {content && (
        <div className="flex items-start gap-5 border-t px-5 py-2.5"
             style={{ borderColor: "hsl(var(--design-border))" }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="section-label">Brief</span>
              {content.pillar && <span className="text-[10px] text-muted-foreground">· {content.pillar}</span>}
            </div>
            <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-foreground">
              {content.brief || "No brief on this content item yet."}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-stretch gap-5 self-center">
            <Metric label="Beats" value={beats} />
            <Metric label="Shots" value={shotsCount} />
            <Metric label="Length" value={formatDuration(totalDuration)} />
            <Metric label="Due" value={dueLabel} />
          </div>
          {content.owner && (
            <div className="flex items-center gap-1 self-center pl-3 text-[11px] text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {content.owner}
            </div>
          )}
        </div>
      )}
    </header>
  );
}

/**
 * One-pill summary of the session scope (content + brand + visibility).
 * Clicking opens a popover with the detail + visibility toggle.
 */
function ScopeSummary({
  session, content, client, isOwner, onChangeVisibility,
}: {
  session: DesignSession | null;
  content: DesignContent | null;
  client: DesignClient | null;
  isOwner: boolean;
  onChangeVisibility: (v: "private" | "team") => void;
}) {
  if (!session) return null;
  const isIncognito = session.isIncognito;
  const isView = session.myPermission === "view";

  const parts: React.ReactNode[] = [];
  if (content) parts.push(<span key="c" className="truncate font-medium">{truncate(content.title || `Content #${content.id}`, 28)}</span>);
  if (client) parts.push(<span key="b" className="text-[hsl(var(--design-success))]">· {client.name}</span>);
  if (!content && !client) parts.push(<span key="e" className="text-muted-foreground">Untitled session</span>);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] hover:border-[hsl(var(--design-accent))]/40 hover:bg-[hsl(var(--design-accent-soft))]/30"
          style={{ borderColor: "hsl(var(--design-border))" }}
          title="Session context"
        >
          {content && <FileText className="h-3 w-3 text-[hsl(var(--design-accent))]" />}
          {!content && client && <BadgeCheck className="h-3 w-3 text-[hsl(var(--design-success))]" />}
          {!content && !client && <Info className="h-3 w-3 text-muted-foreground" />}
          <span className="flex items-center gap-1 max-w-[260px] truncate">{parts}</span>
          {isIncognito && <EyeOff className="h-3 w-3 text-[hsl(var(--design-warning))]" />}
          {!isIncognito && session.visibility === "team" && <Users className="h-3 w-3 text-purple-600" />}
          {!isIncognito && session.visibility === "private" && <Lock className="h-3 w-3 text-muted-foreground" />}
          <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="space-y-3">
          {content && (
            <div>
              <div className="section-label muted text-[9px]">Brief</div>
              <Link href={`/content/${content.id}`} className="mt-0.5 block truncate text-[12.5px] font-medium hover:underline">
                {content.title || `Content #${content.id}`}
              </Link>
              {content.type && <div className="text-[10.5px] text-muted-foreground">{content.type}</div>}
            </div>
          )}
          {client && (
            <div>
              <div className="section-label muted text-[9px]">Brand</div>
              <div className="mt-0.5 flex items-center gap-1 text-[12.5px]">
                <BadgeCheck className="h-3 w-3 text-[hsl(var(--design-success))]" />
                <span className="font-medium">{client.name}</span>
              </div>
              <div className="text-[10.5px] text-muted-foreground">Brand auto-injected into every shot</div>
            </div>
          )}
          <div>
            <div className="section-label muted text-[9px]">Visibility</div>
            {isIncognito ? (
              <div className="mt-1 flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11.5px] text-amber-800">
                <EyeOff className="h-3 w-3" />
                <span className="font-medium">Incognito</span>
                <span className="text-[10.5px]">· nothing saved</span>
              </div>
            ) : (
              <div className="mt-1 flex gap-1">
                <button
                  onClick={() => onChangeVisibility("private")}
                  disabled={!isOwner}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[11.5px] font-medium transition-colors",
                    session.visibility === "private" ? "border-[hsl(var(--design-accent))] bg-[hsl(var(--design-accent-soft))] text-[hsl(var(--design-accent))]" : "border-[hsl(var(--design-border))]",
                    !isOwner && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <Lock className="h-3 w-3" /> Private
                </button>
                <button
                  onClick={() => onChangeVisibility("team")}
                  disabled={!isOwner}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[11.5px] font-medium transition-colors",
                    session.visibility === "team" ? "border-purple-300 bg-purple-50 text-purple-800" : "border-[hsl(var(--design-border))]",
                    !isOwner && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <Users className="h-3 w-3" /> Team
                </button>
              </div>
            )}
            {isView && (
              <div className="mt-1.5 text-[10.5px] text-muted-foreground">You have view-only access.</div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-end">
      <span className="section-label muted text-[9px]">{label}</span>
      <span className="editorial-numeric text-[18px] leading-none">{value}</span>
    </div>
  );
}

function formatDuration(secs: number): string {
  if (!secs) return "0s";
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
