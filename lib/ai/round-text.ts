/**
 * What the user watched, and what the transcript keeps.
 *
 * THE INCIDENT, 2026-09-16 (thumbs-down #7). "Tell me about NatureFinance and
 * help me prepare for starting the contract", four minutes before the meeting
 * it was written for. Every tool round's streamed text is appended to one
 * `fullText` and that string is persisted as the answer, so the turn's three
 * false starts — 139, then 213, then 177 characters of "I'll pull X…", one per
 * round — were saved above 6,437 characters of actual briefing. The whole first
 * screen was the model describing what it was about to do. Measured over the
 * last 200 assistant messages: 55 of them (27.5%) open with a first-person plan
 * paragraph, 53% of tool-running turns against 6% of tool-free ones.
 *
 * A prompt rule alone has failed for this class twice, so the deterministic
 * half is here: TEXT WRITTEN IN A ROUND THAT ENDED IN TOOL CALLS, AND SHORTER
 * THAN WHAT FOLLOWS IT, DOES NOT REACH THE PERSISTED MESSAGE. That text is
 * pre-tool by construction — the model had not seen the result yet — so no
 * classifier is needed and none is wanted; a shape test for "plan-shaped
 * paragraphs" would only add a way to be wrong in both directions, which is the
 * documented personal-data-intent failure one level down. The length bound is
 * not a classifier either: see withoutRoundNarration for what it is for, and
 * for the six real shapes the unbounded rule ate.
 *
 * THE LIVE STREAM IS LEFT ALONE, deliberately. The user sees that text as it
 * happens, the tool-activity card is drawn from it, and pulling words back off
 * a screen someone is reading is a worse cure than the disease. So is the
 * model's own replay: `fullText` and every `fullText.slice(roundTextStart)` fed
 * back to the provider are untouched, and the deck-claim guard still reads
 * exactly what it read before.
 *
 * SPANS, NOT A SECOND ACCUMULATOR. Each chain records [start, end) for the
 * rounds that ended in tool calls and cuts them once, at its return. A parallel
 * `keptText` string would have to mirror roughly ten artefact appends per chain
 * — image markdown, deck links, download links, charts, the scheduled-proposal
 * marker — and the first one anybody forgot would lose an ARTEFACT rather than
 * a paragraph. A span closes before the executors run, so everything they
 * append is outside it by construction.
 */

/** Half-open [start, end) over the turn's accumulated text. */
export interface RoundSpan {
  start: number;
  end: number;
}

/**
 * The turn's text with the narration rounds cut out.
 *
 * Offsets are clamped rather than trusted: a chain that pushed a reversed or
 * out-of-range span should lose nothing rather than slice somewhere arbitrary,
 * because this runs at the moment the only copy of the answer is written down.
 *
 * THE BOUND, and it is the whole reason this is a function rather than a
 * `slice` in four places. "Text written before a tool call is pre-tool" is true
 * and says nothing about SIZE, and the first version of this filter cut every
 * such span whatever it held. Driven against the four chains it deleted real
 * answers, not plans: a 237-character briefing followed in the same round by a
 * lookup was reduced to the next round's "Done."; a text block emitted AFTER
 * the tool_use block in the same Anthropic message went with it; a numbered
 * list split across a round was saved starting at item 3. Worse, it was not
 * monotone — the identical turn with a SILENT last round kept every word of
 * that briefing through the backstop, so adding "Done." was what deleted the
 * answer.
 *
 * So a span is cut only when it is SMALLER THAN WHAT SURVIVES IT. The flagged
 * turn is untouched by that test — 139, 213 and 177 characters of plan above
 * 6,437 characters of briefing — and a round that did the work and then reached
 * for one more tool keeps it. No classifier and no shape test: the comparison
 * is on lengths, which the same input always answers the same way.
 *
 * `modelTextEnd` is where the model's own words stop and the deterministic
 * end-of-turn notices begin (the chains pass `spokenText.length`). It matters
 * because those notices are three or four hundred characters of OUR text: count
 * them as survivors and a turn whose answer was deleted looks as though plenty
 * survived, which is exactly the shape — an answer, then an over-budget lookup
 * — that the cut-short notice exists for. Omitted, the whole string counts,
 * which is the right reading for a caller that has no notices.
 *
 * THE BACKSTOP stays underneath it: when cutting would leave nothing at all,
 * the full text is returned unchanged. The bound reaches most of that case on
 * its own — a turn whose every word is inside a span has an empty survivor, and
 * no span with a word in it clears a bar of zero — but a span of pure
 * whitespace has no trimmed length and is cut however small the survivor, so
 * the backstop is still the only thing standing between a whitespace-only turn
 * and a blank row. Which is also the single mutation that reaches it: see
 * scripts/verify-tool-loop-guard.ts 9.
 */
export function withoutRoundNarration(
  full: string,
  spans: RoundSpan[] | null | undefined,
  modelTextEnd?: number
): string {
  const text = String(full || "");
  if (!spans || !spans.length || !text) return text;
  const limit = typeof modelTextEnd === "number" && isFinite(modelTextEnd)
    ? Math.max(0, Math.min(text.length, Math.floor(modelTextEnd)))
    : text.length;
  const cuts: RoundSpan[] = [];
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (!s) continue;
    const start = Math.max(0, Math.min(text.length, Math.floor(Number(s.start) || 0)));
    const end = Math.max(0, Math.min(text.length, Math.floor(Number(s.end) || 0)));
    if (end > start) cuts.push({ start, end });
  }
  if (!cuts.length) return text;
  cuts.sort((a, b) => a.start - b.start);
  // What the model would have left if EVERY span went. Measured once, against
  // the smallest possible survivor: dropping a span from the list only ever
  // makes the survivor longer, so a span that clears this bar clears it however
  // the others are resolved. One pass, no cascade, same answer every time.
  let survivor = "";
  let scan = 0;
  for (let i = 0; i < cuts.length; i++) {
    const c = cuts[i];
    if (c.start > scan) survivor += text.slice(scan, Math.min(c.start, limit));
    if (c.end > scan) scan = c.end;
    if (scan >= limit) break;
  }
  if (scan < limit) survivor += text.slice(scan, limit);
  const room = survivor.trim().length;
  let out = "";
  let at = 0;
  for (let i = 0; i < cuts.length; i++) {
    const c = cuts[i];
    // Overlapping spans are merged by walking forward only: a chain that
    // recorded the same round twice must not cut the text between them.
    if (c.start > at) out += text.slice(at, c.start);
    if (c.end <= at) continue;
    // THE BOUND. A span longer than everything that survives it is not a plan
    // paragraph, whatever it looks like; it is the answer, and the round simply
    // reached for one more tool afterwards. Whitespace-only spans have no
    // trimmed length and always go, which is how the round separator leaves
    // with the paragraph it separated.
    if (text.slice(c.start, c.end).trim().length > room) out += text.slice(Math.max(at, c.start), c.end);
    at = c.end;
  }
  out += text.slice(at);
  return out.trim() ? out : text;
}
