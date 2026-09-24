/**
 * Heading-hierarchy validation for a draft.
 *
 * Ported from authorityon-platform/packages/core/src/audit/heading-hierarchy.ts
 * (pure, zero-dependency — copied rather than imported; see the porting note in
 * docs/content-optimizer-spec.md §4). One draft-stage change, described below.
 *
 * Flags: missing/multiple H1, level skips (H1 -> H3), and H6 overuse.
 */

export interface HeadingIssue {
  type: "multiple_h1" | "level_skip" | "missing_h1" | "h6_overuse";
  detail: string;
}

export interface HeadingHierarchyResult {
  score: number; // 0-15
  issues: HeadingIssue[];
  h1Count: number;
  totalHeadings: number;
}

/**
 * @param headings   Headings found in the draft BODY, in document order.
 * @param hasTitle   Whether the draft carries a separate title field.
 *
 * THE DRAFT-STAGE CHANGE: the original ran on crawled pages, where the H1 lives
 * in the body. In this studio the writer types the headline into a `title`
 * field and the body starts at H2 — which is correct authoring, but scored as
 * "No H1 found" by a verbatim port. That one wrong flag would fire on virtually
 * every well-formed draft, which is how a rubric loses a writer's trust in the
 * first thirty seconds. When `hasTitle` is true the title counts as the H1, and
 * a body H1 on top of it is then the real defect (two competing headlines).
 */
export function validateHeadingHierarchy(
  headings: { level: number; text: string }[],
  hasTitle: boolean = false
): HeadingHierarchyResult {
  const issues: HeadingIssue[] = [];
  const bodyH1s = headings.filter((h) => h.level === 1);
  const effectiveH1Count = bodyH1s.length + (hasTitle ? 1 : 0);

  if (effectiveH1Count === 0) {
    issues.push({ type: "missing_h1", detail: "No H1 or title — nothing states what the piece is about" });
  } else if (effectiveH1Count > 1) {
    issues.push({
      type: "multiple_h1",
      detail: hasTitle && bodyH1s.length > 0
        ? `Body H1 competes with the title (${effectiveH1Count} top-level headings)`
        : `${effectiveH1Count} H1s detected (expected 1)`,
    });
  }

  // Level-skip detection walking document order. A jump of more than one level
  // downward breaks the outline an engine uses to chunk the page; going back up
  // is normal nesting and fine.
  //
  // Seeded from the title when there is one: a draft whose body opens at H3
  // under a title has skipped H2, and starting `prev` at 0 would miss it.
  let prev = hasTitle ? 1 : 0;
  for (const h of headings) {
    if (prev > 0 && h.level > prev + 1) {
      issues.push({
        type: "level_skip",
        detail: `H${prev} to H${h.level} jump near "${h.text.slice(0, 60)}"`,
      });
    }
    prev = h.level;
  }

  // Excessive H6 signals headings used for styling rather than structure.
  const h6Count = headings.filter((h) => h.level === 6).length;
  if (h6Count > 5) {
    issues.push({
      type: "h6_overuse",
      detail: `${h6Count} H6s — usually a sign of headings used for styling`,
    });
  }

  const score = Math.max(0, 15 - issues.length * 3);

  return { score, issues, h1Count: effectiveH1Count, totalHeadings: headings.length };
}
