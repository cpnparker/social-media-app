"use client";

/**
 * EngineAI Live — card renderer. Renders every card kind (deck + live) with a
 * receipt line. Live cards get pin/dismiss/feedback affordances.
 */

import { Pin, X, ThumbsUp, ThumbsDown, FileText, TrendingUp, CalendarClock, Layers } from "lucide-react";
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
};

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

  if (kind === "deck_pipeline") {
    const s = body?.summary || {};
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px]">
        {s.total_items != null && <span><span className="text-muted-foreground">Items</span> {fmtNum(s.total_items)}</span>}
        {s.commissioned?.count != null && <span><span className="text-muted-foreground">Commissioned</span> {fmtNum(s.commissioned.count)}</span>}
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

export function MeetingCard({
  card, onPin, onDismiss, onFeedback, feedback,
}: {
  card: LiveCard;
  onPin?: () => void;
  onDismiss?: () => void;
  onFeedback?: (v: number) => void;
  feedback?: number | null;
}) {
  const Icon = KIND_ICON[card.kind] || FileText;
  return (
    <div className={cn(
      "rounded-xl border bg-card/70 p-2.5 shadow-sm",
      card.state === "pinned" && "border-primary/40 bg-primary/5"
    )}>
      <div className="flex items-start gap-2">
        <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold truncate">{card.title}</span>
          </div>
          <div className="mt-1"><CardContent kind={card.kind} body={card.body} /></div>
          {receiptLabel(card.receipt) && (
            <div className="mt-1 text-[11px] text-muted-foreground/70 truncate">↳ {receiptLabel(card.receipt)}</div>
          )}
        </div>
        <div className="flex flex-col items-center gap-1 shrink-0">
          {onPin && (
            <button onClick={onPin} title={card.state === "pinned" ? "Unpin" : "Pin"} className="text-muted-foreground/50 hover:text-foreground">
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
