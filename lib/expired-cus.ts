// Expired-CU write-offs.
//
// When a contract ends with an unused balance, that balance is booked as a
// content item so the contract burns down to zero — e.g. "WBCSD expired CUs
// (2026)" (14.43 CU) or "Contract Expiry - CU" (5.85 CU). These are accounting
// adjustments, not produced work, so they inflate production reporting: July
// 2026 was 109.84 CU commissioned of which 40.74 (37%) was write-offs.
//
// There is NO structured marker for them in the source system. They are
// ordinary `Service`-type content whose only distinguishing feature is the
// name, and the naming is hand-typed and inconsistent — 20 distinct variants
// across 30 items ("Expired CUs", "Expired content units", "Expired units",
// "Contract Expiry - Base contract", "IEEE expired CUs (2026)",
// "Expired CUs summer '26", …).
//
// "retir" is in the pattern because of a real miss, not for symmetry: CPI's
// "RETIRED CONTENT UNITS" (29.68 CU, brief: "Content units not used and
// therefore retired at end of contract") is the second-largest write-off
// on record and matched nothing. Its sibling "Retiring Units — Contract
// Expiration" was caught only because someone happened to append the word
// Expiration. Over all 11,136 content names /retir/i returns just 6 rows —
// the two write-offs and four LHH articles about postponed *retirement*,
// which the type gate excludes — so it adds no false positives.
//
// The `Service` type gate is deliberate and matters more than it looks. The
// two failure modes are not symmetric: a missed write-off leaves an obviously
// large number on screen, while a wrongly-hidden real item silently
// under-reports delivered work. Every one of the 30 write-offs is typed
// exactly `Service`, and no non-Service content in the whole table has
// "expir" in its name, so requiring the type costs nothing today and stops a
// future article like "Why your SSL certificate expired" from vanishing out
// of the totals.
//
// The match on type is exact, not a prefix: `Service Analytics Report` (65
// rows) and `Service - Analytics Report` (7 rows — the same type, entered two
// ways) both carry real quarterly-analytics work and must stay visible.
//
// KNOWN GAP, deliberately not covered: contract-boundary ledger entries named
// "Contract adjustment", "Moving CUs from old contract", "RELOCATING contract
// spend" (~44 CU over ~64 items), and the 2022 Engine-V1 migration backfill
// ("Content units from V1", 859.50 CU). Those are a different category, and
// several relocate charges for work that WAS produced, so hiding them by
// pattern would silently under-report delivery. They need per-item review.
//
// The durable fix is a real marker (a dedicated content type, or a flag) set
// in the Engine app at write-off time; this predicate should be retired the
// day that exists. Guarded by scripts/verify-expired-cus.ts.

const EXPIRY_NAME = /expir|retir/i;
const WRITE_OFF_TYPE = "service";

export function isExpiredCUWriteOff(
  contentTitle: string | null | undefined,
  contentType: string | null | undefined
): boolean {
  if (!contentTitle) return false;
  if ((contentType || "").trim().toLowerCase() !== WRITE_OFF_TYPE) return false;
  return EXPIRY_NAME.test(contentTitle);
}
