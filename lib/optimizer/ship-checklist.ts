/**
 * The twelve checks a writer runs before an article ships.
 *
 * From the AMRIZE Editorial Optimisation method, August 2026. The rubric
 * already computes most of them — this does NOT re-judge anything. Every row
 * resolves to a check that already ran, cites which one, and where nothing can
 * answer it the row says so rather than disappearing.
 *
 * ── WHY IT IS NOT A SCORE, AND NOT A FRACTION ───────────────────────────────
 *
 * No composite, no "9 of 12". The page audit refuses a composite by design and
 * the source method never totals its own checklist; a fraction here would be
 * the same overclaim in a new costume, because the rows are not commensurable —
 * a missing FAQ block and a missing byline are not two of the same unit.
 *
 * ── WHY IT ADDS NO RUBRIC CRITERION ─────────────────────────────────────────
 *
 * A thirty-fifth criterion re-denominates every pillar, bumps RUBRIC_VERSION
 * and invalidates every stored assessment. The boundary this file keeps is:
 * the rubric SCORES, the checklist CHECKS, and an item may be checked without
 * ever being scored. Three rows here have no rubric criterion behind them at
 * all, and they are the point of the exercise.
 *
 * ── THE FIVE STATES ─────────────────────────────────────────────────────────
 *
 * done / attention / missing are verdicts. `not-checked` is the honest one: it
 * means nothing in this tool looked, and it names what would be needed. `yours`
 * is a human judgement no measurement can settle. Neither is a pass, and
 * neither is silently omitted — that distinction is the whole reason this
 * surface exists rather than a longer suggestions list.
 */
import type { DraftScores } from "./types";

export type ShipState = "done" | "attention" | "missing" | "not-checked" | "yours";

export interface ShipRow {
  n: number;
  check: string;
  state: ShipState;
  /** What was found. Evidence, not advice. */
  detail: string;
  /** Which check answered this, so a row and its source can never disagree. */
  from: "draft" | "live page" | "assessment" | "you";
  /** The criterion or audit id behind it, where there is one. */
  via?: string;
}

const SOURCE = "AMRIZE Editorial Optimisation for AI Search, 20 August 2026";
export const SHIP_CHECKLIST_SOURCE = SOURCE;

function criterion(scores: DraftScores | null, key: string) {
  if (!scores) return null;
  for (let i = 0; i < scores.pillars.length; i++) {
    const cs = scores.pillars[i].criteria;
    for (let c = 0; c < cs.length; c++) if (cs[c].key === key) return cs[c];
  }
  return null;
}

/** A criterion's verdict as a checklist state. Full marks is done; a skipped
 *  criterion is NOT-CHECKED, never a pass — the distinction the whole file
 *  exists to preserve. */
function fromCriterion(scores: DraftScores | null, key: string, n: number, check: string): ShipRow {
  const c: any = criterion(scores, key);
  if (!scores) {
    return { n, check, state: "not-checked", detail: "No draft has been scored yet.", from: "draft", via: key };
  }
  if (!c) {
    return { n, check, state: "not-checked", detail: `Nothing in this tool measures ${key}.`, from: "draft", via: key };
  }
  const label = String(c.name || "").replace(/^[^—]*—\s*/, "");
  if (c.skipped) {
    // The REASON, not the criterion's name. A skipped row that shows its own
    // title reads as a verdict — "Fact-bearing sentences name the brand" beside
    // a not-checked marker says the opposite of what happened, which is that
    // nothing was compared because no brand is configured.
    return {
      n, check, state: "not-checked",
      detail: c.skipReason ? `Not checked — ${String(c.skipReason).replace(/^./, (m: string) => m.toLowerCase())}.` : "Not checked.",
      from: "draft", via: key,
    };
  }
  const full = c.earned >= c.maxPoints;
  const none = c.earned === 0;
  return {
    n, check,
    state: full ? "done" : none ? "missing" : "attention",
    detail: label,
    from: "draft",
    via: key,
  };
}

/**
 * Is there a dedicated FAQ block?
 *
 * Checklist item 10, and the one this tool could not answer at all. NOT a
 * rubric criterion: `question-headings` already scores question-shaped headings
 * throughout the piece, and an FAQ block is a different thing — a cluster of
 * short question-and-answer pairs at the END, which is what FAQPage schema
 * marks up and what an answer engine lifts whole.
 *
 * Detected two ways, and it says which. An explicit label is certain. A run of
 * three or more question headings in the last third, each answered briefly, is
 * a strong inference and is reported as one — because an article that simply
 * ends on question sections is not the same as an article with an FAQ, and
 * claiming otherwise would be the confident-and-wrong failure this codebase
 * keeps paying for.
 */
export function detectFaqBlock(headings: { text: string; index: number }[], totalHeadings: number, hasLabel: boolean):
  { present: boolean; certain: boolean; count: number } {
  if (hasLabel) return { present: true, certain: true, count: 0 };
  if (totalHeadings === 0) return { present: false, certain: true, count: 0 };
  const lastThird = Math.floor(totalHeadings * (2 / 3));
  let run = 0;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].index < lastThird) continue;
    if (/\?\s*$/.test(headings[i].text.trim())) run++;
  }
  return { present: run >= 3, certain: false, count: run };
}

export interface ShipInput {
  scores: DraftScores | null;
  /** The draft's plain text, for the checks with no criterion behind them. */
  text: string;
  headings: { text: string; level: number }[];
  /** The working title. A draft has no title TAG — that is a CMS field. */
  title: string;
  /** True only for a session imported from a URL, where a live page exists. */
  hasLivePage: boolean;
  /**
   * What the page audit found, when it has been run.
   *
   * Three rows here cannot be answered from a draft at all. Without this they
   * said "not checked" even on a piece where the audit panel was holding the
   * answer — a row claiming not to have looked, beside a panel that had.
   */
  auditChecks?: { id: string; status: string; detail: string }[] | null;
}

/** One audit check by id, or null when the audit has not been run. */
function auditCheck(checks: ShipInput["auditChecks"], id: string) {
  if (!checks) return null;
  for (let i = 0; i < checks.length; i++) if (checks[i].id === id) return checks[i];
  return null;
}

/** An audit status as a checklist state. `info` is NOT a pass — the audit uses
 *  it precisely for "we did not look", which is this file's whole subject. */
function stateFromAudit(status: string): ShipState {
  return status === "pass" ? "done" : status === "warn" ? "attention" : status === "fail" ? "missing" : "not-checked";
}

export function buildShipChecklist(input: ShipInput): ShipRow[] {
  const rows: ShipRow[] = [];
  const { scores, text, title } = input;

  // 1. Title tag. The draft's title is a WORKING title, not the tag a CMS will
  //    publish — so this reports what can be said about it and names what
  //    cannot. Length and brand are checkable; whether it carries the buyer's
  //    phrase needs the target queries, which title-query-alignment scores.
  const titleLen = title.trim().length;
  const brandInTitle = /amrize/i.test(title);
  rows.push({
    n: 1, check: "Title tag",
    state: !title.trim() ? "missing" : titleLen > 60 || !brandInTitle ? "attention" : "done",
    detail: !title.trim()
      ? "No title yet."
      : `"${title.trim().slice(0, 70)}" — ${titleLen} characters${titleLen > 60 ? ", over the 60 limit" : ""}${brandInTitle ? "" : ", and no brand name in it"}. This is the working title; the published title tag is a CMS field this tool cannot see.`,
    from: "draft",
  });

  // 2. Meta description. There is no field for one, anywhere in this product.
  //    Reported as NOT CHECKED with the reason, not omitted — an absent row
  //    reads as a pass on a checklist.
  const metaCheck = auditCheck(input.auditChecks, "meta-description");
  rows.push({
    n: 2, check: "Meta description",
    state: metaCheck ? stateFromAudit(metaCheck.status) : "not-checked",
    detail: metaCheck
      ? metaCheck.detail
      : input.hasLivePage
        ? "Not checked yet — run Page audit and this reads the answer from the live page."
        : "Not checked — a draft has no meta description; it is a CMS field. Import the published URL to check it.",
    from: metaCheck ? "live page" : input.hasLivePage ? "live page" : "draft",
    via: metaCheck ? "meta-description" : undefined,
  });

  rows.push(fromCriterion(scores, "tldr-block", 3, "TL;DR block"));
  rows.push(fromCriterion(scores, "question-headings", 4, "Question headings"));
  rows.push(fromCriterion(scores, "heading-answer-adjacency", 5, "Answer-first paragraphs"));
  // 6. THE MOST IMPORTANT ROW ON THE LIST, per the method it comes from — and
  //    the one most likely to report nothing. anonymous-first-person-facts
  //    needs a brand to compare against, so on a piece with no client attached
  //    it skips, and the single most valuable recommendation in the source
  //    document rendered as "not checked" with no signal at all.
  //
  //    Counting first-person is deterministic and needs no brand. So when the
  //    criterion cannot run, the row still reports WHAT IT CAN SEE — how often
  //    the piece says "we" — and names the one action that would let the check
  //    run properly. A row that cannot score is not a row that must stay silent.
  const anonRow = fromCriterion(scores, "anonymous-first-person-facts", 6, 'Entity in the sentence, not "we"');
  if (anonRow.state === "not-checked") {
    const firstPerson = (text.match(/\b(we|our|us)\b/gi) || []).length;
    anonRow.detail = firstPerson > 0
      ? `Not checked — no client is attached, so there is no brand name to compare against. This piece says "we", "our" or "us" ${firstPerson} time${firstPerson === 1 ? "" : "s"}: every one of those inside a sentence carrying a fact is a fact that travels without the brand. Attach a client to check it properly.`
      : "Not checked — no client is attached, so there is no brand name to compare against.";
    if (firstPerson >= 10) anonRow.state = "attention";
  }
  rows.push(anonRow);
  rows.push(fromCriterion(scores, "stat-source-adjacency", 7, "Verifiable specifics"));
  rows.push(fromCriterion(scores, "attributed-quotes", 8, "Named experts beside every quote"));

  // 9. Byline AND dates — two criteria, one checklist row. The weaker of the
  //    two decides, because the row is only satisfied when both are.
  const byline: any = criterion(scores, "byline-present");
  const dateline: any = criterion(scores, "dateline-recency");
  const bothFull = byline && dateline && byline.earned >= byline.maxPoints && dateline.earned >= dateline.maxPoints;
  const neither = byline && dateline && byline.earned === 0 && dateline.earned === 0;
  rows.push({
    n: 9, check: "Byline and dates",
    state: !scores ? "not-checked" : bothFull ? "done" : neither ? "missing" : "attention",
    detail: !scores
      ? "No draft has been scored yet."
      : `${byline ? String(byline.name).replace(/^[^—]*—\s*/, "") : "byline not measured"}; ${dateline ? String(dateline.name).replace(/^[^—]*—\s*/, "") : "dateline not measured"}`,
    from: "draft", via: "byline-present + dateline-recency",
  });

  // 10. FAQ block. No criterion behind it — this is one of the three rows that
  //     are the reason the file exists.
  const heads = input.headings.map((h, i) => ({ text: h.text, index: i }));
  const hasLabel = /\bFAQ\b|frequently asked|common questions/i.test(text);
  const faq = detectFaqBlock(heads, heads.length, hasLabel);
  rows.push({
    n: 10, check: "FAQ block",
    state: faq.present ? (faq.certain ? "done" : "attention") : "missing",
    detail: faq.present
      ? faq.certain
        ? "An FAQ section is named in the piece."
        : `${faq.count} question headings cluster at the end, which reads like an FAQ but is not labelled as one. An answer engine lifts a labelled block more reliably.`
      : "No FAQ block. Four to six real buyer questions with 40-60 word answers, marked up as FAQPage, is the single most portable block on a page.",
    from: "draft",
  });

  // 11. Internal links. parse.ts discards every link before the rubric runs, so
  //     nothing in the DRAFT can answer this. On a live page the audit does.
  const linkCheck = auditCheck(input.auditChecks, "internal-link-density");
  rows.push({
    n: 11, check: "Internal links",
    state: linkCheck ? stateFromAudit(linkCheck.status) : "not-checked",
    detail: linkCheck
      ? linkCheck.detail
      : input.hasLivePage
        ? "Not checked yet — run Page audit and this reads the answer from the live page."
        : "Not checked — links are stripped from the draft before it is scored. Import the published URL to count them.",
    from: linkCheck ? "live page" : input.hasLivePage ? "live page" : "draft",
    via: linkCheck ? "internal-link-density" : undefined,
  });

  // 12. Schema. Genuinely unanswerable from a draft, and says so.
  const schemaCheck = auditCheck(input.auditChecks, "schema-present");
  rows.push({
    n: 12, check: "Schema",
    state: schemaCheck ? stateFromAudit(schemaCheck.status) : "not-checked",
    detail: schemaCheck
      ? schemaCheck.detail
      : input.hasLivePage
        ? "Not checked yet — run Page audit and this reads the answer from the live page."
        : "Not checked — schema lives in the published page, not in the text. Import the URL to audit it.",
    from: schemaCheck ? "live page" : input.hasLivePage ? "live page" : "draft",
    via: schemaCheck ? "schema-present" : undefined,
  });

  return rows;
}

/** Counts by state. FOUR numbers, never a fraction — see the header. */
export function shipCounts(rows: ShipRow[]): { done: number; attention: number; missing: number; open: number } {
  let done = 0, attention = 0, missing = 0, open = 0;
  for (let i = 0; i < rows.length; i++) {
    const s = rows[i].state;
    if (s === "done") done++;
    else if (s === "attention") attention++;
    else if (s === "missing") missing++;
    else open++;
  }
  return { done, attention, missing, open };
}
