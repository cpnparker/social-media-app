"use client";

/**
 * Confirmation card for an NL-scheduled prompt proposal (Phase 2).
 * Rendered from a [SCHEDULED_PROPOSAL]{json}[/SCHEDULED_PROPOSAL] marker the
 * create_scheduled_task tool embeds in the assistant message. Design rule:
 * the card echoes SERVER-computed run times — nothing here does time math.
 * Confirming POSTs /api/ai/scheduled with the proposalId; the server dedupes
 * on it, so a stale card (reload, second device) can't create a duplicate.
 */

import { useEffect, useState } from "react";
import { CalendarClock, Check, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface ScheduledProposal {
  /** "update" = refine THIS thread's standing task (targetId); default = create. */
  mode?: "create" | "update";
  proposalId: string;
  targetId?: string;
  /** Fingerprint of the standing prompt the update was built against —
   *  the server rejects the PATCH if the task changed since. */
  baseFp?: string;
  title: string;
  oldTitle?: string;
  prompt: string;
  oldPrompt?: string;
  promptChanged?: boolean;
  typeTask?: string;
  typeSchedule: string;
  configSchedule: any;
  scheduleChanged?: boolean;
  clientId?: number | null;
  emailEnabled?: boolean;
  scheduleLabel: string;
  nextRuns: string[];
}

/** Which proposalIds are already-confirmed tasks — fetched once per workspace
 *  per page load, shared across every card, invalidated on confirm. */
const confirmedIdsCache = new Map<string, Promise<Set<string>>>();

function fetchConfirmedIds(workspaceId: string): Promise<Set<string>> {
  let cached = confirmedIdsCache.get(workspaceId);
  if (!cached) {
    cached = fetch(`/api/ai/scheduled?workspaceId=${workspaceId}`)
      .then((r) => (r.ok ? r.json() : { tasks: [] }))
      .then((d) => new Set<string>(
        (d.tasks || [])
          .map((t: any) => t.config_context?.proposalId)
          .filter((id: any): id is string => typeof id === "string")
      ))
      .catch(() => new Set<string>());
    confirmedIdsCache.set(workspaceId, cached);
  }
  return cached;
}

function markConfirmed(workspaceId: string, proposalId: string) {
  const cached = confirmedIdsCache.get(workspaceId);
  if (cached) void cached.then((s) => s.add(proposalId));
}

function fmtRun(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Europe/Zurich",
      weekday: "short", day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export default function ScheduledProposalCard({
  proposal, workspaceId,
}: {
  proposal: ScheduledProposal;
  workspaceId?: string | null;
}) {
  const [state, setState] = useState<"idle" | "saving" | "created">("idle");
  const [nextRun, setNextRun] = useState<string | null>(null);
  const isUpdate = proposal.mode === "update" && !!proposal.targetId;
  const isMonitor = proposal.typeTask === "monitor";

  // Restore "already confirmed" state across reloads/devices (create mode only —
  // updates are idempotent, re-confirming just re-applies the same values).
  useEffect(() => {
    if (isUpdate || !workspaceId || !proposal.proposalId) return;
    let cancelled = false;
    void fetchConfirmedIds(workspaceId).then((ids) => {
      if (!cancelled && ids.has(proposal.proposalId)) setState("created");
    });
    return () => { cancelled = true; };
  }, [workspaceId, proposal.proposalId, isUpdate]);

  const confirm = async () => {
    if (!workspaceId) { toast.error("Workspace not loaded yet — try again in a moment"); return; }
    setState("saving");
    try {
      if (isUpdate) {
        const body: Record<string, any> = {};
        if (proposal.baseFp) body.baseFp = proposal.baseFp;
        if (proposal.promptChanged) body.prompt = proposal.prompt;
        if (proposal.oldTitle) body.title = proposal.title;
        if (proposal.scheduleChanged) { body.typeSchedule = proposal.typeSchedule; body.configSchedule = proposal.configSchedule; }
        if (typeof proposal.emailEnabled === "boolean") body.emailEnabled = proposal.emailEnabled;
        const res = await fetch(`/api/ai/scheduled/${proposal.targetId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Could not update");
        setNextRun(d.task?.date_next_run || null);
        setState("created");
        toast.success("Standing prompt updated — future runs use the new version");
        return;
      }
      const res = await fetch("/api/ai/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          title: proposal.title,
          prompt: proposal.prompt,
          typeSchedule: proposal.typeSchedule,
          configSchedule: proposal.configSchedule,
          typeTask: proposal.typeTask,
          clientId: proposal.clientId ?? undefined,
          emailEnabled: proposal.emailEnabled,
          proposalId: proposal.proposalId,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not schedule");
      markConfirmed(workspaceId, proposal.proposalId);
      setNextRun(d.nextRun || null);
      setState("created");
      if (!d.alreadyExisted) toast.success(`Scheduled — next run ${fmtRun(d.nextRun)}`);
    } catch (e: any) {
      toast.error(e.message);
      setState("idle");
    }
  };

  const [next1, next2] = proposal.nextRuns || [];

  return (
    <div className={cn(
      "mt-3 max-w-md rounded-xl border p-3 transition-colors",
      state === "created" ? "border-emerald-500/30 bg-emerald-500/[0.04]" : "bg-muted/30"
    )}>
      <div className="flex items-start gap-2.5">
        <div className={cn(
          "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
          state === "created" ? "bg-emerald-500/15" : "bg-primary/10"
        )}>
          {state === "created"
            ? <Check className="h-4 w-4 text-emerald-500" />
            : <CalendarClock className="h-4 w-4 text-primary" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">
            {isUpdate && <span className="text-muted-foreground font-normal">Update: </span>}
            {proposal.title}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>{proposal.scheduleLabel}</span>
            {isMonitor && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-px rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400">
                monitor — notifies only on change
              </span>
            )}
            {proposal.emailEnabled && (
              <span className="inline-flex items-center gap-0.5"><Mail className="h-3 w-3" /> email</span>
            )}
          </p>
          {next1 && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Next{isMonitor ? " check" : ""}: {fmtRun(next1)}{next2 ? ` · then ${fmtRun(next2)}` : ""}
            </p>
          )}
          <p className="text-xs text-muted-foreground/80 mt-1.5 line-clamp-2">{proposal.prompt}</p>
          {isUpdate && proposal.promptChanged && proposal.oldPrompt && (
            <p className="text-[11px] text-muted-foreground/60 mt-1 line-clamp-1">
              was: <span className="line-through decoration-muted-foreground/40">{proposal.oldPrompt}</span>
            </p>
          )}
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        {state === "created" ? (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            {isUpdate ? "Updated" : "Scheduled"}{nextRun ? ` — next run ${fmtRun(nextRun)}` : ""} · manage in Scheduled prompts
          </span>
        ) : (
          <>
            <button
              onClick={confirm}
              disabled={state === "saving"}
              className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60 flex items-center gap-1.5"
            >
              {state === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isUpdate ? "Confirm update" : "Confirm schedule"}
            </button>
            <span className="text-[11px] text-muted-foreground">
              {isUpdate ? "Applies only after you confirm" : "Runs only after you confirm"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
