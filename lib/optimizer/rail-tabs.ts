/**
 * Which tabs the studio's right-hand rail offers, per surface.
 *
 * ── WHY THIS IS A FUNCTION AND NOT TEN LINES IN THE PAGE ────────────────────
 *
 * Because it is the SEPARATION, and the separation needs to be testable by
 * being run rather than by being read.
 *
 * The Writer produces text; the Optimiser judges it. The two were one surface
 * until 2026-08-26, and what merged them was a scoring panel sitting over a
 * draft in progress — it turned writing into chasing a number before there was
 * anything to score. So "the Writer's rail has no Score tab" is a product
 * invariant, not a layout detail.
 *
 * It lived inline in page.tsx and was guarded by a regex that carved the
 * writer's branch out of the file's text. That check passed while blind: a
 * `t.push({key:"score"})` placed BEFORE the `if (surface === "writer")` gives
 * the Writer a Score tab and never enters the window the regex reads. The
 * re-merge the check existed to prevent could ship green.
 *
 * A pure function can be CALLED. `railTabsFor("writer", ...)` either contains
 * a score tab or it does not, and no arrangement of the source can hide that
 * from an assertion. This is the same lesson `verify-model-ids` records: query
 * the thing through the function the app calls, rather than grepping for a
 * line.
 */

export type RailTabKey = "score" | "issues" | "coverage" | "discuss" | "sources";
export type RailSurface = "writer" | "optimiser" | "content";

export interface RailTab {
  key: RailTabKey;
  label: string;
  count?: number;
}

/** Only the chrome flags this decision actually reads. */
export interface RailChrome {
  showScore: boolean;
  showCoverageTab: boolean;
}

export function railTabsFor(
  surface: RailSurface,
  chrome: RailChrome,
  activeIssues: number
): RailTab[] {
  const t: RailTab[] = [];

  if (surface === "writer") {
    t.push({ key: "discuss", label: "Discuss" });
    t.push({ key: "sources", label: "Background" });
    t.push({ key: "issues", label: "Suggestions", count: activeIssues });
    return t;
  }

  // A graded score over a document nobody is scoring is a number pretending to
  // mean something. Where there is no judge there is no tab, and the
  // deterministic marks still appear under Suggestions.
  if (chrome.showScore) t.push({ key: "score", label: "Score" });
  t.push({ key: "issues", label: "Suggestions", count: activeIssues });
  if (chrome.showCoverageTab) t.push({ key: "coverage", label: "Coverage" });
  return t;
}

/** The tab a surface opens on: the Writer on the conversation, the Optimiser
 *  on the number. Derived from the list so it can never name a tab the surface
 *  does not offer. */
export function defaultRailTab(
  surface: RailSurface,
  chrome: RailChrome
): RailTabKey {
  const tabs = railTabsFor(surface, chrome, 0);
  return tabs.length > 0 ? tabs[0].key : "issues";
}
