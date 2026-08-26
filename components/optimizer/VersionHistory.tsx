"use client";

/**
 * What this piece looked like before.
 *
 * Versions are cut where a writer would want to go back to: before a change
 * they did not type themselves, and before a restore. NOT on every autosave —
 * the editor saves on a 600ms debounce, so a row per save is thousands of
 * near-identical entries and a history nobody can read.
 *
 * The list shows time, length and the CHANGE in length, because that is the
 * question a writer actually has: what happened here, and how much of it. A
 * column of identical word counts would be a list of timestamps pretending to
 * be information.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { History, Loader2, RotateCcw, X } from "lucide-react";

interface Version {
  units_version: number;
  units_words: number;
  date_created: string;
}

interface Props {
  sessionId: string;
  workspaceId: string | null;
  /** Bumped when a version is cut, so an open list refreshes itself. */
  refreshKey: number;
  onRestore: (version: number) => void;
}

function when(iso: string): string {
  try {
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function VersionHistory({ sessionId, workspaceId, refreshKey, onRestore }: Props) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!sessionId || !workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/optimizer/sessions/${encodeURIComponent(sessionId)}/versions?workspaceId=${encodeURIComponent(workspaceId)}`
      );
      const d = await res.json();
      if (res.ok) setVersions(d.versions || []);
    } catch {
      /* an unreachable history is an empty one, not an error state */
    } finally {
      setLoading(false);
    }
  }, [sessionId, workspaceId]);

  // Only while open, and again whenever a version is cut beneath it.
  useEffect(() => {
    if (open) load();
  }, [open, refreshKey, load]);

  if (!sessionId) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Version history"
        className={cn(
          "inline-flex items-center gap-1.5 shrink-0 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
          open ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-muted/60 text-muted-foreground hover:text-foreground"
        )}
      >
        <History className="h-3 w-3" />
        History
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-40 w-[300px] rounded-xl border bg-popover shadow-lg">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-[12.5px] font-semibold">Version history</span>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="max-h-[340px] overflow-y-auto p-1.5">
            {loading && versions.length === 0 && (
              <p className="px-2 py-3 text-[12px] text-muted-foreground inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading
              </p>
            )}

            {!loading && versions.length <= 1 && (
              // Says WHEN versions get cut, rather than "no history" — which
              // reads as a broken feature when it is an accurate description of
              // a piece nothing has been applied to yet.
              <p className="px-2 py-3 text-[12px] text-muted-foreground leading-relaxed">
                Nothing to go back to yet. A version is kept each time you apply a change from the
                conversation, or restore an earlier one — not on every keystroke.
              </p>
            )}

            {versions.map((v, i) => {
              const previous = versions[i + 1];
              const delta = previous ? v.units_words - previous.units_words : 0;
              const current = i === 0;
              return (
                <div
                  key={v.units_version}
                  className={cn(
                    "group flex items-center gap-2 rounded-lg px-2 py-1.5",
                    current ? "bg-muted/60" : "hover:bg-muted/50"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium leading-snug">
                      {current ? "Current" : `Version ${v.units_version}`}
                      <span className="ml-1.5 font-normal text-muted-foreground">{when(v.date_created)}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                      {v.units_words.toLocaleString()} words
                      {previous && delta !== 0 && (
                        <span className={cn("ml-1.5", delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                          {delta > 0 ? "+" : ""}
                          {delta.toLocaleString()}
                        </span>
                      )}
                    </p>
                  </div>
                  {!current && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px] opacity-0 group-hover:opacity-100 focus:opacity-100"
                      disabled={busy !== null}
                      onClick={async () => {
                        setBusy(v.units_version);
                        await onRestore(v.units_version);
                        setBusy(null);
                        setOpen(false);
                      }}
                    >
                      {busy === v.units_version ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Restore
                        </>
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {versions.length > 1 && (
            <p className="px-3 py-2 border-t text-[10.5px] text-muted-foreground leading-relaxed">
              Restoring keeps what you have now as a version too, so you can come back.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
