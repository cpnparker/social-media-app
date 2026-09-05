"use client";

/**
 * The Optimiser's verdict, in the conversation.
 *
 * Sized against what the reply can carry, not against what the rail shows: a
 * number, one sentence saying what it means, and the three fixes worth the
 * most. The rail lists all thirty-four criteria because that is a rail's job —
 * fifteen rows in a chat bubble would be a worse copy of a panel two clicks
 * away, which is why this caps at three and SAYS how many it left out.
 *
 * The honesty rules travel with the number. "5 of 6 pillars scored" sits beside
 * the score here for the same reason it does in the panel: Relevance is the
 * heaviest pillar and it is skipped whenever nobody has set a target query,
 * which is most pieces that arrive in a chat.
 */

import { Gauge, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ContentScoreData {
  ok: true;
  overall: number;
  retrievability: number;
  citability: number;
  verdict: string;
  pillarsScored: number;
  pillarsTotal: number;
  partial: boolean;
  moves: { key: string; name: string; detail: string; points: number }[];
  moreCount: number;
  morePoints: number;
  wordCount: number;
  short: boolean;
}

export default function ContentScoreCard({
  data,
  onOpen,
  opening,
}: {
  data: ContentScoreData;
  /** Mints a piece from this text and opens it in the Optimiser. Only on click —
   *  scoring in chat leaves nothing in the sidebar until someone wants it there. */
  onOpen?: () => void;
  opening?: boolean;
}) {
  const tone =
    data.overall >= 70 ? "text-emerald-600 dark:text-emerald-400"
    : data.overall >= 45 ? "text-amber-600 dark:text-amber-400"
    : "text-red-600 dark:text-red-400";

  return (
    <div className="rounded-xl border overflow-hidden max-w-[42rem] bg-background">
      <div className="flex items-center gap-3 px-3.5 py-2.5 border-b bg-muted/40">
        <span className={cn("text-[26px] font-semibold leading-none tabular-nums", tone)}>
          {data.overall}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[12.5px] font-semibold leading-tight">{data.verdict}</span>
          <span className="block text-[11px] text-muted-foreground leading-tight mt-0.5">
            {data.partial
              ? `${data.pillarsScored} of ${data.pillarsTotal} pillars scored — no target query set`
              : `all ${data.pillarsTotal} pillars scored`}
            {data.short && ` · ${data.wordCount} words, short for this rubric`}
          </span>
        </span>
        {onOpen && (
          <button
            onClick={onOpen}
            disabled={opening}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary bg-primary/10 hover:bg-primary/15 disabled:opacity-60 rounded-md px-2 py-1 shrink-0 transition-colors"
          >
            {opening ? "Opening…" : "Open in Optimiser"}
            {!opening && <ArrowUpRight className="h-3 w-3" />}
          </button>
        )}
      </div>

      <div className="px-3.5 py-2.5 flex flex-col gap-2">
        <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Gauge className="h-3 w-3" /> Worth doing first
        </p>
        {data.moves.map((m) => (
          <div key={m.key} className="flex items-start gap-2.5">
            <span className="flex-1 min-w-0">
              <span className="block text-[12.5px] font-medium leading-snug">{m.name}</span>
              {m.detail && (
                <span className="block text-[11.5px] text-muted-foreground leading-snug">{m.detail}</span>
              )}
            </span>
            <span className="text-[11px] font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5 shrink-0 tabular-nums">
              +{m.points}
            </span>
          </div>
        ))}
      </div>

      {/* A list that silently stopped at three would read as three problems. */}
      {data.moreCount > 0 && (
        <p className="px-3.5 py-2 border-t text-[11.5px] text-muted-foreground bg-muted/20">
          {data.moreCount} more open, worth {data.morePoints} points together — with the marks on the
          text itself, in the Optimiser.
        </p>
      )}
    </div>
  );
}
