/**
 * What "fix this" means for a given criterion.
 *
 * The two are genuinely different jobs and the existing /suggest route only
 * does one of them. "3 of 5 statistics have no source in the sentence" points
 * at five sentences that exist and need REVISING — that route rewrites a span
 * and has done since day one. "No byline", "no TL;DR block", "0 attributed
 * quotations" point at nothing at all: there is no span to rewrite, because the
 * thing is absent. Those need something ADDED.
 *
 * Sending an add-shaped criterion to a span-rewriter is how you get a model
 * asked to improve a passage that is not there, so the registry below is the
 * whole point of the file — and it is exhaustive over the criteria that can
 * appear in the "Not done" list, asserted by the check.
 */

export type FixKind = "revise" | "add" | "none";

/**
 * Criteria whose fix is NEW CONTENT. Everything not listed here either has
 * spans to revise or is not actionable by a model at all.
 */
const ADD: { [key: string]: { what: string; where: string } } = {
  "tldr-block": {
    what: "a TL;DR block of 3-5 bullets, each a complete self-contained sentence carrying a figure or the entity name",
    where: "directly under the opening paragraph",
  },
  "byline-present": {
    what: "a byline line naming the author and their role",
    where: "immediately under the title",
  },
  "credential-line": {
    what: "a one-line author credential — the qualification that makes them worth quoting on this subject",
    where: "beside or under the byline",
  },
  "dateline-recency": {
    what: 'a visible date line, in the form "Published 26 August 2026" and an "Updated" date if the piece has been revised',
    where: "under the byline",
  },
  "extractable-definition": {
    what: "one plain copular sentence defining the main entity — \"X is a [category] that…\" — that could be lifted and quoted with nothing around it",
    where: "in the opening, before any scene-setting",
  },
  "worked-example": {
    what: "a short named example — the customer or project, what was done, and the measurable result",
    where: "after the section it evidences",
  },
  "external-reference-links": {
    what: "a short list of the primary sources this piece draws on, each named",
    where: "inline where the claim is made, or as a sources block at the end",
  },
  "statistic-density": {
    what: "a note of WHICH claims in this piece most need a figure attached, and what kind of figure would settle each",
    where: "as guidance, not as invented numbers",
  },
};

/** Criteria with nothing a model should be asked to produce. */
const NOT_ACTIONABLE: { [key: string]: true } = {
  // Query coverage is a brief decision, not a writing one — the panel already
  // offers the target-query input for it.
  "title-query-alignment": true,
  "query-terms-in-headings": true,
  "query-terms-in-body": true,
};

export function fixKindFor(key: string, hasSpans: boolean): FixKind {
  if (NOT_ACTIONABLE[key]) return "none";
  if (ADD[key]) return "add";
  return hasSpans ? "revise" : "none";
}

/** The label a writer sees on the action. */
export function fixLabelFor(kind: FixKind): string {
  return kind === "add" ? "Draft it" : kind === "revise" ? "Show me" : "";
}

export function addSpecFor(key: string): { what: string; where: string } | null {
  return ADD[key] || null;
}

/**
 * The instruction for drafting a missing element.
 *
 * Two rules carry the weight. It must NOT invent a fact — the whole product
 * exists to stop unsourced claims reaching a client's page, and a model asked
 * for a byline will cheerfully produce a plausible name. And it returns the
 * block ONLY, because the writer applies it verbatim at one click; anything
 * conversational in the response ends up in the article.
 */
export function buildAddPrompt(spec: { what: string; where: string }, criterionName: string): string {
  return [
    "You are drafting one missing block for a piece of content, for a writer who will paste it straight in.",
    "",
    `WHAT IS MISSING: ${criterionName}.`,
    `WHAT TO WRITE: ${spec.what}.`,
    `WHERE IT GOES: ${spec.where}.`,
    "",
    "RULES",
    "Use ONLY facts already present in the draft below. Invent nothing — no figure, no source, no name, no date,",
    "no credential. Where the block needs something the draft does not contain, write the line with a bracketed",
    "gap saying exactly what is needed, like [NEEDS: author name] or [NEEDS: publication date]. A plausible",
    "invented byline is worse than a visible gap, because only one of them gets caught before it publishes.",
    "",
    "Return the block ONLY. No preamble, no explanation, no surrounding quotes. Markdown for structure is fine",
    "(bullets, a bold label). The writer pastes what you return, verbatim, so anything that is not the block",
    "ends up in their article.",
  ].join("\n");
}
