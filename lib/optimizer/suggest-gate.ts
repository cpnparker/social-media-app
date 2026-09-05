/**
 * The suggestion gate — what stands between the judge and the writer.
 *
 * Two stages, and the free one does the safety-critical work.
 *
 * STAGE 1, the PRE-GATE: pure, instant, no network. It catches the classes of
 * bad suggestion that can be detected mechanically, and one of them is the
 * single most damaging thing this product could do:
 *
 *   A SUGGESTED REWRITE THAT INVENTS A STATISTIC.
 *
 * The rubric rewards statistics with sources. A judge that has internalised
 * that will, sooner or later, "improve" a sentence by adding a plausible
 * number — "authorisation rates improve by 4%" where the draft said "improve".
 * The writer clicks Apply, the fabricated figure is now in a client's
 * published content over their byline, and nothing anywhere flagged it. The
 * tool exists to stop clients publishing unsourced claims; shipping one
 * through the Apply button would be the deepest possible failure of purpose.
 * So: any digit in a suggested rewrite that is not already in the draft is
 * rejected outright, before any model is asked its opinion.
 *
 * STAGE 2, the CLASSIFIER: a cheap Haiku pass over what survives, batched,
 * catching what needs judgement — generic advice, advice that does not fit the
 * brand, near-duplicates of another finding. Ported in shape from AuthorityOn's
 * validator, which is the thing that killed generic advice there.
 *
 * FAIL-OPEN, VISIBLY. If the classifier errors, findings pass through — they
 * have already cleared the pre-gate, so the floor is high — but the assessment
 * is marked degraded and the panel SAYS the suggestions were not quality
 * checked. A silent degrade in a product that sells honesty-by-design is worse
 * than the thing it is hiding.
 */

import type { JudgeFinding } from "./judge";

export type GateVerdict = "APPROVED" | "REJECTED" | "DUPLICATE_OF";

export type GateReason =
  | "no_rewrite_offered"
  | "no_op_edit"
  | "fabricated_figure"
  | "fabricated_attribution"
  | "duplicate_span"
  | "already_passing"
  | "generic"
  | "wrong_scale";

export interface GateOutcome {
  index: number;
  verdict: GateVerdict;
  reason: GateReason | null;
  detail: string;
  duplicateOf: number | null;
  decidedBy: "pregate" | "classifier" | "fallback";
}

export interface PreGateInput {
  findings: JudgeFinding[];
  draftText: string;
  /** Criterion keys that already scored full marks — a finding against one of
   *  those is arguing with a check that passed. */
  passingCriteria: string[];
}

/** Attribution verbs a fabricated source would hide behind. */
const ATTRIBUTION_PATTERN = /\b(?:according to|per|source:|reports?|research(?:ers)?|study|survey|analysis) ([A-Z][A-Za-z&.'-]+(?:\s+[A-Z][A-Za-z&.'-]+){0,3})/g;

function digitsIn(s: string): string[] {
  const m = s.match(/\d[\d,.]*/g);
  if (!m) return [];
  const out: string[] = [];
  for (let i = 0; i < m.length; i++) {
    const cleaned = m[i].replace(/[,.]+$/, "");
    if (cleaned) out.push(cleaned);
  }
  return out;
}

/** Whitespace- and case-insensitive equality, for the no-op check. Case is
 *  NOT normalised: "The" → "the" at a sentence start is a real edit. */
function sameText(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
}

/**
 * The free pass. Pure — same findings in, same verdicts out, no network, no
 * clock, no randomness. Runs before any money is spent.
 */
export function preGate(input: PreGateInput): GateOutcome[] {
  const out: GateOutcome[] = [];
  const draft = input.draftText;
  const draftDigits: { [k: string]: boolean } = {};
  const dd = digitsIn(draft);
  for (let i = 0; i < dd.length; i++) draftDigits[dd[i]] = true;

  const seenSpans: { quote: string; index: number }[] = [];

  for (let i = 0; i < input.findings.length; i++) {
    const f = input.findings[i];
    const push = (verdict: GateVerdict, reason: GateReason | null, detail: string, dupOf?: number) => {
      out.push({ index: i, verdict, reason, detail, duplicateOf: dupOf == null ? null : dupOf, decidedBy: "pregate" });
    };

    // A finding against a criterion that already scored full marks is arguing
    // with a check that passed. Shown as a note, not as a fix to apply.
    if (input.passingCriteria.indexOf(f.criterion) >= 0) {
      push("REJECTED", "already_passing", `${f.criterion} already scores full marks`);
      continue;
    }

    // Same span, twice. Two highlights over one sentence means at least one
    // Apply would edit text the other finding described.
    let dup = -1;
    for (let s = 0; s < seenSpans.length; s++) {
      if (sameText(seenSpans[s].quote, f.quote)) { dup = seenSpans[s].index; break; }
    }
    if (dup >= 0) {
      push("DUPLICATE_OF", "duplicate_span", "another finding covers the same span", dup);
      continue;
    }
    seenSpans.push({ quote: f.quote, index: i });

    if (!f.suggestedEdit) {
      // Not a rejection: plenty of real findings have no clean single-span
      // rewrite ("this section depends on an earlier one"). It just cannot
      // offer an Apply button.
      push("APPROVED", "no_rewrite_offered", "explanation only, no Apply");
      continue;
    }

    if (sameText(f.suggestedEdit, f.quote)) {
      push("REJECTED", "no_op_edit", "the rewrite is identical to the text it replaces");
      continue;
    }

    // ── The one that matters ──
    const suggestionDigits = digitsIn(f.suggestedEdit);
    const invented: string[] = [];
    for (let d = 0; d < suggestionDigits.length; d++) {
      if (!draftDigits[suggestionDigits[d]]) invented.push(suggestionDigits[d]);
    }
    if (invented.length > 0) {
      push("REJECTED", "fabricated_figure",
        `the rewrite introduces ${invented.join(", ")}, which appears nowhere in the draft`);
      continue;
    }

    // A named source in the rewrite that is not in the draft is the same
    // failure wearing a different hat — a citation nobody can check.
    let fabricatedSource = "";
    const re = new RegExp(ATTRIBUTION_PATTERN.source, "g");
    let am: RegExpExecArray | null;
    while ((am = re.exec(f.suggestedEdit)) !== null) {
      const name = am[1];
      if (name && draft.indexOf(name) < 0) { fabricatedSource = name; break; }
    }
    if (fabricatedSource) {
      push("REJECTED", "fabricated_attribution",
        `the rewrite attributes to "${fabricatedSource}", which appears nowhere in the draft`);
      continue;
    }

    push("APPROVED", null, "");
  }

  return out;
}

// ── Stage 2: the classifier ──────────────────────────────────────────────

export const GATE_MODEL = "claude-haiku-4-5-20251001";

/**
 * Batched deliberately, and not primarily for cost (the saving is about two
 * cents against a session that costs 15-40). Duplicate detection is a
 * batch-native operation — a per-finding call either cannot see the batch or
 * must carry every other finding anyway — and severity is comparative: "is
 * this the most urgent thing here" has no meaning in isolation.
 */
export const GATE_BATCH_LIMIT = 15;

export function buildGatePrompt(
  findings: JudgeFinding[],
  context: { brandName?: string; format?: string }
): string {
  const lines: string[] = [];
  lines.push(
    `You are reviewing suggestions produced by a content-assessment tool before a writer sees them. Reject the ones not worth their attention.`
  );
  lines.push(
    `REJECT a suggestion when it is:
- generic advice that would apply to any draft ("add more detail", "improve clarity", "consider your audience")
- advice rather than an edit — it describes a change without saying what the text should say instead
- wrong for this piece's scale or kind (commissioning original research for a short explainer)
- a near-duplicate of another suggestion in this batch, saying the same thing about a different sentence

APPROVE anything specific and actionable, even if minor. When uncertain, APPROVE — a writer can dismiss a weak suggestion in a second, and a good suggestion silently withheld is invisible to them.`
  );
  if (context.brandName) lines.push(`The piece is about: ${context.brandName}.`);
  if (context.format) lines.push(`Format: ${context.format}.`);

  lines.push(`SUGGESTIONS:`);
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    lines.push(
      `[${i}] criterion=${f.criterion} severity=${f.severity}\n  about: "${f.quote.slice(0, 120)}"\n  says: ${f.explanation}\n  rewrite: ${f.suggestedEdit ? f.suggestedEdit.slice(0, 200) : "(none)"}`
    );
  }

  lines.push(
    `Return ONLY a JSON array, one object per suggestion, keyed by its index:
[{"index": 0, "verdict": "APPROVED"}, {"index": 1, "verdict": "REJECTED", "reason": "generic", "detail": "..."}]
Valid verdicts: APPROVED, REJECTED. Valid reasons: generic, wrong_scale, advice_not_edit, duplicate.
Every index must appear exactly once.`
  );
  return lines.join("\n\n");
}

/**
 * Parse the classifier's reply.
 *
 * Keyed by index, never by position: one malformed object costs one finding's
 * gating rather than the whole batch's. Anything missing, unknown or
 * out-of-range falls back to APPROVED with decidedBy "fallback", so a
 * classifier hiccup cannot silently empty the panel.
 */
export function parseGateResponse(raw: string, count: number): GateOutcome[] {
  const outcomes: GateOutcome[] = [];
  const byIndex: { [k: number]: GateOutcome } = {};

  let parsed: any = null;
  try {
    const t = (raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const first = t.indexOf("[");
    const last = t.lastIndexOf("]");
    if (first >= 0 && last > first) parsed = JSON.parse(t.slice(first, last + 1));
  } catch {
    parsed = null;
  }

  if (Array.isArray(parsed)) {
    for (let i = 0; i < parsed.length; i++) {
      const row = parsed[i] || {};
      const idx = typeof row.index === "number" ? row.index : -1;
      if (idx < 0 || idx >= count || byIndex[idx]) continue;
      const verdict: GateVerdict = row.verdict === "REJECTED" ? "REJECTED" : "APPROVED";
      byIndex[idx] = {
        index: idx, verdict,
        reason: verdict === "REJECTED" ? ((row.reason as GateReason) || "generic") : null,
        detail: typeof row.detail === "string" ? row.detail.slice(0, 200) : "",
        duplicateOf: null,
        decidedBy: "classifier",
      };
    }
  }

  for (let i = 0; i < count; i++) {
    outcomes.push(
      byIndex[i] || { index: i, verdict: "APPROVED", reason: null, detail: "", duplicateOf: null, decidedBy: "fallback" }
    );
  }
  return outcomes;
}

/**
 * A classifier that rejects nearly everything is far more likely broken than
 * correct, and the failure mode is an empty panel that reads as a clean draft.
 * Treated as a gate failure, not a result.
 */
export function gateLooksBroken(outcomes: GateOutcome[]): boolean {
  if (outcomes.length < 5) return false;
  let rejected = 0;
  for (let i = 0; i < outcomes.length; i++) if (outcomes[i].verdict === "REJECTED") rejected++;
  return rejected / outcomes.length >= 0.9;
}
