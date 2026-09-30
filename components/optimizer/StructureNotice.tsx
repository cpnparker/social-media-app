"use client";

/**
 * The studio's half of "say so where it cannot be missed": a notice ABOVE the
 * draft when the import recorded that it could not see the source's headings.
 *
 * Above the draft rather than in the score rail because the rail is hidden
 * below the lg breakpoint and is a tab the writer may not be on — and because
 * the offer below acts on the text, so it belongs next to the text.
 *
 * Two states, both from the one predicate (headingsUnseen) the engine uses:
 *
 *   - no headings yet: the explanation, always shown — it is why five
 *     criteria read "not scored" — plus the offered question lines;
 *   - headings marked since: the remaining offers, dismissible, and one
 *     sentence saying the heading criteria now score what has been marked.
 *     This state is reachable only because the record survives a marked
 *     heading: when it did not, a writer who marked one storytelling line
 *     was shown "0 of 1 headings are question-shaped" and no offers at all,
 *     with five question lines still sitting in the text as paragraphs.
 *
 * THE OFFER IS AN OFFER. Each line is shown on its own with its own button;
 * nothing is pre-selected and nothing is applied without a click. The rule
 * that finds them, and the evidence that it is the only rule precise enough
 * to show, are in lib/optimizer/import-structure.ts (likelyQuestionHeadings).
 */

import { useMemo, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import {
  headingsUnseen, likelyQuestionHeadings, sectionHeadingCountOf, structureUnseenAdvice,
  type HeadingOffer, type StructureUnseenReason,
} from "@/lib/optimizer/import-structure";

/** Past a handful the offer stops being a list anyone reads line by line —
 *  and reading each line is the whole safeguard. The count is still said. */
const MAX_SHOWN = 8;

export default function StructureNotice({
  reason,
  html,
  onMakeHeading,
}: {
  reason: StructureUnseenReason | null;
  html: string;
  /** Applies one offer; false when the line is no longer in the draft. */
  onMakeHeading: (offer: HeadingOffer) => boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  /** Section headings — the engine's count, so "blind" here is "skipped" there. */
  const headingCount = useMemo(() => sectionHeadingCountOf(html), [html]);
  /**
   * Lines just accepted, each with the body as it stood when the click landed.
   * The studio's body reaches this component on the editor's save debounce
   * (600ms), so without this an accepted line would stay on offer for a moment
   * — and a second click would report it "changed since it was offered",
   * which is true and useless. The hold lasts only until the body moves: after
   * that the line is either a heading (and no longer a candidate) or, undone,
   * a paragraph again, and offered again.
   */
  const [accepted, setAccepted] = useState<{ [text: string]: string }>({});
  const offers = useMemo(
    () => (reason ? likelyQuestionHeadings(html).filter((o) => accepted[o.text] !== html) : []),
    [reason, html, accepted]
  );
  const [stale, setStale] = useState<string | null>(null);

  if (!reason) return null;
  const blind = headingsUnseen(reason, headingCount);
  if (!blind && (dismissed || offers.length === 0)) return null;
  const advice = structureUnseenAdvice(reason);

  return (
    <div
      role={blind ? "alert" : undefined}
      data-structure-notice=""
      className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] px-3.5 py-3 flex items-start gap-2.5"
    >
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        {blind ? (
          <>
            <span className="text-[13.5px] font-semibold">{advice.title}</span>
            <p className="text-[13px] leading-relaxed">{advice.body}</p>
            <p className="text-[13px] leading-relaxed">{advice.remedy}</p>
          </>
        ) : (
          <>
            <span className="text-[13px] font-semibold">
              {offers.length === 1 ? "One more line reads" : `${offers.length} more lines read`} like a question heading
            </span>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              This came in without its headings. The heading criteria score the headings marked so far.
            </p>
          </>
        )}
        {offers.length > 0 && (
          <div className="flex flex-col gap-1 pt-1" data-heading-offers="">
            {blind && (
              <span className="text-[12.5px] text-muted-foreground">
                {offers.length === 1 ? "This line reads" : "These lines read"} like question headings. Make each one a heading only if it was one:
              </span>
            )}
            {offers.slice(0, MAX_SHOWN).map((o) => (
              <div key={o.text} className="flex items-start gap-2">
                <span className="flex-1 min-w-0 text-[12.5px] leading-snug">“{o.text}”</span>
                <button
                  type="button"
                  data-offer=""
                  onClick={() => {
                    if (onMakeHeading(o)) {
                      setAccepted((prev) => ({ ...prev, [o.text]: html }));
                      setStale(null);
                    } else {
                      setStale(o.text);
                    }
                  }}
                  className="shrink-0 text-[12px] font-medium text-primary hover:underline underline-offset-2"
                >
                  Make it a heading
                </button>
              </div>
            ))}
            {offers.length > MAX_SHOWN && (
              <span className="text-[12px] text-muted-foreground">
                and {offers.length - MAX_SHOWN} more — they appear here as these are dealt with.
              </span>
            )}
            {stale && (
              <span className="text-[12px] text-muted-foreground">
                “{stale}” has changed since it was offered, so nothing was done.
              </span>
            )}
          </div>
        )}
      </div>
      {!blind && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
