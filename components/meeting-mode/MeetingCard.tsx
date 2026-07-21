"use client";

/**
 * EngineAI Live — card renderer.
 *
 * The natural-language INSIGHT is the hero: a card is "a sharp colleague leaning
 * over and pointing at the number", so the insight sentence leads, the raw data
 * supports it, and the receipt (provenance) sits quietly underneath. A kind-
 * coloured left accent makes the type scannable at a glance; cards animate in so
 * a freshly-surfaced insight catches the eye without a jarring pop.
 *
 * Variants: "full" (default — Now zone / drawer, with pin/dismiss/feedback) and
 * "rail" (compact, for the always-on client context strip).
 */

import { useEffect, useState } from "react";
import { Pin, X, ThumbsUp, ThumbsDown, FileText, TrendingUp, CalendarClock, Layers, ListChecks, Brain, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LiveCard } from "@/lib/meeting/trigger-engine";

const KIND_ICON: Record<string, typeof FileText> = {
  deck_contract: TrendingUp,
  commercial_context: TrendingUp,
  scope_guard: Layers,
  deck_pipeline: Layers,
  deck_last_meeting: CalendarClock,
  commitment_memory: CalendarClock,
  content_receipts: FileText,
  units_summary: TrendingUp,
  open_tasks: ListChecks,
  memory_context: Brain,
  world_context: Globe,
};

// Left-accent colour by kind — makes the card type readable in a glance.
const KIND_ACCENT: Record<string, string> = {
  deck_contract: "border-l-emerald-500",
  commercial_context: "border-l-emerald-500",
  scope_guard: "border-l-amber-500",
  deck_pipeline: "border-l-sky-500",
  deck_last_meeting: "border-l-violet-500",
  commitment_memory: "border-l-violet-500",
  content_receipts: "border-l-indigo-500",
  units_summary: "border-l-emerald-500",
  open_tasks: "border-l-teal-500",
  memory_context: "border-l-pink-500",
  world_context: "border-l-indigo-500",
};
const accentOf = (kind: string) => KIND_ACCENT[kind] || "border-l-muted-foreground/30";

function fmtNum(n: any): string {
  const v = Number(n);
  if (!isFinite(v)) return String(n ?? "—");
  return v % 1 === 0 ? v.toLocaleString() : v.toFixed(1);
}

export function CardContent({ kind, body }: { kind: string; body: any }) {
  // Contract / commercial / scope-guard — all render the contract numbers
  if (kind === "deck_contract" || kind === "commercial_context" || kind === "scope_guard") {
    if (body?.none) {
      return <div className="text-[13px] text-muted-foreground">No active contracts on file for {body.clientName || "this client"}.</div>;
    }
    // Workspace-wide scope: render the aggregate summary — never a single
    // arbitrary contract row (the list is oldest-first).
    if (body?.workspace) {
      const s = body.summary || {};
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px]">
          {s.contracts != null && <span><span className="text-muted-foreground">Contracts</span> {fmtNum(s.contracts)}</span>}
          {s.total_cu != null && <span><span className="text-muted-foreground">Total</span> {fmtNum(s.total_cu)} CU</span>}
          {s.remaining_cu != null && <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtNum(s.remaining_cu)} CU left</span>}
          {s.ending_within_30_days > 0 && <span className="text-amber-600 dark:text-amber-400">{fmtNum(s.ending_within_30_days)} ending ≤30d</span>}
        </div>
      );
    }
    const c = body?.contracts?.[0] || body?.summary || {};
    const s = body?.summary || {};
    return (
      <div className="space-y-1 text-sm">
        {c.name_contract && <div className="font-medium">{c.name_contract}</div>}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px]">
          {c.cu_total != null && <span><span className="text-muted-foreground">Total</span> {fmtNum(c.cu_total)}</span>}
          {c.cu_used != null && <span><span className="text-muted-foreground">Used</span> {fmtNum(c.cu_used)}</span>}
          {c.cu_remaining != null && <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtNum(c.cu_remaining)} left</span>}
          {c.utilization_pct != null && <span><span className="text-muted-foreground">Util</span> {fmtNum(c.utilization_pct)}%</span>}
          {c.days_remaining != null && <span><span className="text-muted-foreground">Renews in</span> {fmtNum(c.days_remaining)}d</span>}
        </div>
        {s.ending_within_30_days > 0 && (
          <div className="text-[12px] text-amber-600 dark:text-amber-400">{s.ending_within_30_days} contract(s) ending within 30 days</div>
        )}
      </div>
    );
  }

  if (kind === "open_tasks") {
    const tasks = body?.tasks || [];
    return (
      <ul className="space-y-1 text-[13px]">
        {tasks.slice(0, 5).map((t: any, i: number) => (
          <li key={i} className="leading-snug">
            <span className="font-medium">{t.title}</span>
            <span className="text-muted-foreground">
              {t.deadline ? ` · due ${t.deadline}` : ""}{t.from_meeting ? ` · ${String(t.from_meeting).slice(0, 40)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (kind === "world_context") {
    const facts: string[] = body?.facts || [];
    return (
      <ul className="space-y-1 text-[13px]">
        {facts.slice(0, 4).map((f, i) => (
          <li key={i} className="leading-snug">{f}</li>
        ))}
        {body?.as_of && (
          <li className="text-muted-foreground/70 text-[11px]">Checked live · {body.as_of}</li>
        )}
      </ul>
    );
  }

  if (kind === "memory_context") {
    const notes = body?.notes || [];
    return (
      <ul className="space-y-1 text-[13px]">
        {notes.slice(0, 4).map((n: any, i: number) => (
          <li key={i} className="leading-snug">
            {n.content}
            {(n.category || n.date) && (
              <span className="text-muted-foreground/70 text-[11px]"> · {[n.category, n.date].filter(Boolean).join(" · ")}</span>
            )}
          </li>
        ))}
      </ul>
    );
  }

  if (kind === "units_summary") {
    const s = body?.summary || {};
    const rows = body?.by_client || [];
    return (
      <div className="space-y-1 text-[13px]">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {s.total_cu != null && (
            <span><span className="text-muted-foreground">Total</span> <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtNum(s.total_cu)} CU</span></span>
          )}
          {s.period_start && <span className="text-muted-foreground">since {s.period_start}</span>}
        </div>
        {rows.slice(0, 3).map((r: any, i: number) => (
          <div key={i} className="text-muted-foreground leading-snug">
            {r.client_name || "Unknown"} · {fmtNum(r.content_units)} CU · {fmtNum(r.task_count)} task{r.task_count === 1 ? "" : "s"}
          </div>
        ))}
      </div>
    );
  }

  if (kind === "deck_pipeline") {
    const s = body?.summary || {};
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px]">
        {s.total_items != null && <span><span className="text-muted-foreground">Items</span> {fmtNum(s.total_items)}</span>}
        {s.commissioned?.count != null && <span><span className="text-muted-foreground">In production</span> {fmtNum(s.commissioned.count)}</span>}
        {s.completed?.count != null && <span><span className="text-muted-foreground">Completed</span> {fmtNum(s.completed.count)}</span>}
      </div>
    );
  }

  if (kind === "deck_last_meeting" || kind === "commitment_memory") {
    const meetings = body?.meetings || [];
    return (
      <div className="space-y-1.5 text-[13px]">
        {meetings.slice(0, 2).map((m: any, i: number) => (
          <div key={i}>
            <div className="font-medium">{m.title} <span className="text-muted-foreground font-normal">· {m.date}</span></div>
            {m.next_steps && <div className="text-muted-foreground leading-snug">Next: {m.next_steps.slice(0, 200)}</div>}
          </div>
        ))}
      </div>
    );
  }

  if (kind === "content_receipts") {
    const examples = body?.examples || [];
    return (
      <ul className="space-y-1 text-[13px]">
        {examples.map((e: any, i: number) => (
          <li key={i} className="leading-snug">
            <span className="font-medium">{e.name}</span>
            <span className="text-muted-foreground"> · {e.type}{e.client ? ` · ${e.client}` : ""}{e.date ? ` · ${e.date}` : ""}</span>
          </li>
        ))}
      </ul>
    );
  }

  return <div className="text-[13px] text-muted-foreground">{JSON.stringify(body).slice(0, 200)}</div>;
}

function receiptLabel(receipt: any): string {
  if (!receipt) return "";
  if (receipt.meeting_title) return `${receipt.meeting_title}${receipt.meeting_date ? ` · ${receipt.meeting_date}` : ""}`;
  return receipt.label || receipt.record_type || "";
}

/** Fade/slide-in on mount so a freshly-surfaced card draws the eye gently. */
function useEnter() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return shown;
}

export function MeetingCard({
  card, variant = "full", onPin, onDismiss, onFeedback, feedback,
}: {
  card: LiveCard;
  variant?: "full" | "rail";
  onPin?: () => void;
  onDismiss?: () => void;
  onFeedback?: (v: number) => void;
  feedback?: number | null;
}) {
  const Icon = KIND_ICON[card.kind] || FileText;
  const accent = accentOf(card.kind);
  const shown = useEnter();
  const enter = shown ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1";

  // ── Rail variant — compact, glanceable, always-on client context ──
  if (variant === "rail") {
    return (
      <div className={cn(
        "rounded-lg border border-l-[3px] bg-card/60 px-2 py-1.5 transition-all duration-300",
        accent, enter,
      )}>
        <div className="flex items-center gap-1.5">
          <Icon className="h-3 w-3 shrink-0 text-muted-foreground/70" />
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80 truncate">{card.title}</span>
          {onPin && (
            <button onClick={onPin} title="Pin" className="ml-auto text-muted-foreground/40 hover:text-primary shrink-0">
              <Pin className="h-3 w-3" />
            </button>
          )}
        </div>
        {card.insight
          ? <div className="mt-0.5 text-[12px] leading-snug text-foreground/90">{card.insight}</div>
          : <div className="mt-0.5"><CardContent kind={card.kind} body={card.body} /></div>}
      </div>
    );
  }

  // ── Full variant — Now zone / drawer ──
  return (
    <div className={cn(
      "rounded-xl border border-l-[3px] bg-card/70 p-2.5 shadow-sm transition-all duration-300",
      accent, enter,
      card.state === "pinned" && "ring-1 ring-primary/30 bg-primary/[0.04]",
    )}>
      <div className="flex items-start gap-2">
        <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80 truncate">{card.title}</span>
            {card.source === "manual" && (
              <span className="text-[9px] font-medium px-1 rounded bg-muted text-muted-foreground/70 shrink-0">looked up</span>
            )}
          </div>
          {/* Insight is the hero — the natural, conversation-aware observation */}
          {card.insight && (
            <div className="mt-0.5 text-sm font-medium leading-snug text-foreground">{card.insight}</div>
          )}
          {/* Supporting data */}
          <div className={cn(card.insight ? "mt-1.5 text-muted-foreground" : "mt-0.5")}>
            <CardContent kind={card.kind} body={card.body} />
          </div>
          {receiptLabel(card.receipt) && (
            <div className="mt-1.5 text-[11px] text-muted-foreground/60 truncate">↳ {receiptLabel(card.receipt)}</div>
          )}
        </div>
        <div className="flex flex-col items-center gap-1.5 shrink-0">
          {onPin && (
            <button onClick={onPin} title={card.state === "pinned" ? "Unpin" : "Pin"} className="text-muted-foreground/50 hover:text-primary">
              <Pin className={cn("h-3.5 w-3.5", card.state === "pinned" && "fill-current text-primary")} />
            </button>
          )}
          {onDismiss && (
            <button onClick={onDismiss} title="Dismiss" className="text-muted-foreground/50 hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {onFeedback && (
        <div className="flex items-center gap-2 mt-1.5 pl-6">
          <button onClick={() => onFeedback(1)} className={cn("text-muted-foreground/40 hover:text-emerald-500", feedback === 1 && "text-emerald-500")}>
            <ThumbsUp className="h-3 w-3" />
          </button>
          <button onClick={() => onFeedback(-1)} className={cn("text-muted-foreground/40 hover:text-red-500", feedback === -1 && "text-red-500")}>
            <ThumbsDown className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
