/**
 * verify-expired-cus.ts — guards lib/expired-cus.ts and its call sites
 *
 * The predicate decides whether a content item is an expired-CU write-off and
 * is therefore hidden from the Commissioned/Delivered totals. Both directions
 * cost real money in reporting: a missed write-off inflates production figures
 * (July 2026 by 37%), and a wrongly-matched item silently under-reports
 * delivered work. So this asserts BOTH directions, and — because this repo has
 * already been burned by "a check asserting that code was WRITTEN rather than
 * USED" — it also asserts the predicate is actually wired into the pages and
 * the client export.
 *
 * Positive fixtures are every distinct write-off name in production. Negative
 * fixtures are of two kinds, labelled as such: real content names taken from
 * production, and deliberately synthetic expiry-worded items that do NOT exist
 * (no non-Service row in the table has "expir" in its name) and are there to
 * pin the type gate against a plausible future article.
 *
 * MUTATION LOG
 *  - drop the `Service` type gate  -> KILLED by the synthetic "Why your SSL
 *    certificate expired" (Article) and by the real "Retiring Units —
 *    Contract Expiration" being the only Service /retir/ row that is a
 *    write-off (the four LHH retirement Articles must stay visible)
 *  - match "expired" instead of "expir" -> KILLED by the three
 *    "Contract Expiry - …" names, which say Expiry and never Expired
 *  - drop "retir" from the pattern -> KILLED by "RETIRED CONTENT UNITS"
 *    (CPI, 29.68 CU) — the real miss this pattern was widened to catch
 *  - case-sensitive match -> KILLED by "IEEE expired CUs (2026)" and
 *    "RETIRED CONTENT UNITS" (both fail /Expired/). NOT killed by
 *    "Expired Units (Consolidation)", which an earlier version of this log
 *    wrongly credited — /Expired/ matches it fine.
 *  - prefix-match the type ("service".startsWith) -> KILLED by
 *    "Service Analytics Report", which carries real quarterly work
 *  - trim()-less type compare -> SURVIVES today: no production row has a
 *    padded type_content. Kept anyway because type strings are hand-entered
 *    upstream; this is a note about the check, not an omission.
 *
 * --self-test drives every assertion against deliberately broken copies of the
 * predicate and refuses to report a pass unless each one fires. Use it rather
 * than break-test-restore: this working tree is shared with other sessions and
 * also deploys, and a deliberate break has reached production from here once.
 *
 * Run: npx tsx scripts/verify-expired-cus.ts [--self-test]
 */
import { readFileSync } from "fs";
import { join } from "path";
import { isExpiredCUWriteOff } from "../lib/expired-cus";

type Predicate = (title: string | null | undefined, type: string | null | undefined) => boolean;

/** Every distinct write-off name in production (20 variants, 30 items). */
const WRITE_OFFS: string[] = [
  "Expired CUs",
  "Expired content units",
  "Expired CU",
  "Expired CU ",
  "Expired CUs 2025",
  "Expired CUs 2026",
  "Contract Expiry - Base contract",
  "Contract Expiry - CU",
  "Events Contract Expiry - CU",
  "Expired CUs (May 2025 - August 2025)",
  "Expired CUs (Marsh US & C - 2025)",
  "Expired CUs (Apr 2025 - Dec 2025 contract)",
  "Expired CUs for 2025 contract",
  "Expired units",
  "Expired Units (Consolidation)",
  "Expired Units (Trial)",
  "IEEE expired CUs (2026)",
  "Expired CUs summer '26",
  "WBCSD expired CUs (2026)",
  "RETIRED CONTENT UNITS",
  "Retiring Units — Contract Expiration",
];

/** Real `Service` content that is genuine work and must never be hidden. */
const REAL_SERVICE_WORK: string[] = [
  "Social Media Management 2026 (August)",
  "August consulting",
  "CFG strategy account management fee",
  "2025 Sprinklr dashboard analytics",
  "SBTs report - design work",
  "End of partnership templates: Design",
  "Fintech Fwd session blurb editing",
  "Digital infrastructure: thought leadership report [design]",
  "Website Copy: Themes Landing Page",
  "Edit: New Year Post",
];

/**
 * Real non-Service content whose names mention retirement — these exist in
 * production (Lee Hecht Harrison articles) and must stay visible.
 */
const REAL_NON_SERVICE_MATCHES: Array<[string, string]> = [
  ["White paper: inclusivity talent cycle in the age of postponed retirements", "Article"],
  ["1. Intro - the realities of postponing retirement", "Article"],
  ["2. Impact of postponed retirement on employment", "Article"],
];

/**
 * SYNTHETIC negatives — no such rows exist today. They pin the type gate
 * against plausible future content, using type strings that DO exist
 * (`Service Analytics Report` and `Service - Analytics Report` are the same
 * type entered two ways; both carry real quarterly work).
 */
const SYNTHETIC_EXPIRY_WORDED: Array<[string, string]> = [
  ["Why your SSL certificate expired", "Article"],
  ["Explainer: what happens when a patent expires", "Video"],
  ["Q3 expiry analytics", "Service Analytics Report"],
  ["Q4 expiry analytics", "Service - Analytics Report"],
  ["Poster: License expiry reminders", "Poster"],
];

/** Guard the check's own preconditions — an emptied array tests nothing. */
function assertPreconditions(): void {
  const problems: string[] = [];
  if (WRITE_OFFS.length < 21) problems.push(`WRITE_OFFS shrank to ${WRITE_OFFS.length} (expected >= 21)`);
  if (REAL_SERVICE_WORK.length < 10) problems.push(`REAL_SERVICE_WORK shrank to ${REAL_SERVICE_WORK.length}`);
  if (REAL_NON_SERVICE_MATCHES.length < 3) problems.push(`REAL_NON_SERVICE_MATCHES shrank to ${REAL_NON_SERVICE_MATCHES.length}`);
  if (SYNTHETIC_EXPIRY_WORDED.length < 5) problems.push(`SYNTHETIC_EXPIRY_WORDED shrank to ${SYNTHETIC_EXPIRY_WORDED.length}`);
  // The fixtures must actually exercise both halves of the pattern.
  let expirCount = 0;
  let retirCount = 0;
  for (let i = 0; i < WRITE_OFFS.length; i++) {
    if (/expir/i.test(WRITE_OFFS[i])) expirCount++;
    if (/retir/i.test(WRITE_OFFS[i])) retirCount++;
  }
  if (expirCount < 19) problems.push(`only ${expirCount} write-off fixtures exercise "expir"`);
  if (retirCount < 2) problems.push(`only ${retirCount} write-off fixtures exercise "retir"`);
  if (problems.length > 0) {
    console.error(`\n✗ PRECONDITIONS FAILED — this check would test nothing:\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
}

function check(predicate: Predicate): string[] {
  const failures: string[] = [];

  for (let i = 0; i < WRITE_OFFS.length; i++) {
    if (!predicate(WRITE_OFFS[i], "Service")) {
      failures.push(`write-off NOT detected: "${WRITE_OFFS[i]}"`);
    }
  }

  for (let i = 0; i < REAL_SERVICE_WORK.length; i++) {
    if (predicate(REAL_SERVICE_WORK[i], "Service")) {
      failures.push(`real work wrongly hidden: "${REAL_SERVICE_WORK[i]}"`);
    }
  }

  const negatives = REAL_NON_SERVICE_MATCHES.concat(SYNTHETIC_EXPIRY_WORDED);
  for (let i = 0; i < negatives.length; i++) {
    const title = negatives[i][0];
    const type = negatives[i][1];
    if (predicate(title, type)) {
      failures.push(`real ${type} wrongly hidden: "${title}"`);
    }
  }

  // Social promo rows carry a synthetic type and must never match.
  if (predicate("Expired CUs", "social promo")) {
    failures.push("social promo row matched the write-off predicate");
  }

  // Absent/garbage input must be inert, never throw.
  const empties: Array<[string | null | undefined, string | null | undefined]> = [
    [null, "Service"],
    [undefined, "Service"],
    ["", "Service"],
    ["Expired CUs", null],
    ["Expired CUs", undefined],
    ["Expired CUs", ""],
  ];
  for (let i = 0; i < empties.length; i++) {
    if (predicate(empties[i][0], empties[i][1])) {
      failures.push(`empty input matched: ${JSON.stringify(empties[i])}`);
    }
  }

  return failures;
}

/**
 * Assert the predicate is USED, not merely present. A previous incident in
 * this repo closed a live hole on the strength of a line EXISTING; here the
 * equivalent failure is a totals memo quietly reading the pre-filter list,
 * which leaves tsc, eslint and the fixture assertions all green.
 */
function checkWiring(): string[] {
  const failures: string[] = [];
  const root = join(__dirname, "..");

  const pages = [
    "app/(app)/operations/commissioned-cus/page.tsx",
    "app/(app)/operations/delivered/page.tsx",
  ];
  for (let i = 0; i < pages.length; i++) {
    const rel = pages[i];
    let src = "";
    try {
      src = readFileSync(join(root, rel), "utf8");
    } catch {
      failures.push(`${rel}: cannot read`);
      continue;
    }
    if (src.indexOf('from "@/lib/expired-cus"') === -1) {
      failures.push(`${rel}: does not import the predicate`);
    }
    if (src.indexOf("isExpiredCUWriteOff(t.contentTitle, t.contentType)") === -1) {
      failures.push(`${rel}: never applies isExpiredCUWriteOff to a task row`);
    }
    if (src.indexOf("const filteredBeforeExpiry") === -1) {
      failures.push(`${rel}: filteredBeforeExpiry is gone — the toggle cannot report what it hides`);
    }
    // The headline totals must read the WRITE-OFF-FILTERED list.
    const totalsAt = src.indexOf("const totals = useMemo(");
    if (totalsAt === -1) {
      failures.push(`${rel}: no totals memo found`);
    } else {
      const body = src.slice(totalsAt, totalsAt + 700);
      if (body.indexOf("filteredBeforeExpiry") !== -1) {
        failures.push(`${rel}: totals reads filteredBeforeExpiry — write-offs are back in the headline number`);
      }
      if (body.indexOf("of filtered") === -1 && body.indexOf("filtered.") === -1) {
        failures.push(`${rel}: totals does not read \`filtered\``);
      }
    }
  }

  // Adjacent invariant, guarded here because this is the only check that reads
  // these two page sources and because breaking it silently changes a reported
  // number: Delivered must ask the API for the COMPLETED basis. Without it the
  // page filters on creation date and merely keeps rows that are done, which
  // reports the commissioned figure under a "Delivered" heading (CGAP May 2026
  // showed 31.40 against a true 21.90).
  let deliveredSrc = "";
  try {
    deliveredSrc = readFileSync(join(root, "app/(app)/operations/delivered/page.tsx"), "utf8");
  } catch {
    /* already reported above */
  }
  if (deliveredSrc.length > 0 && deliveredSrc.indexOf('params.set("basis", "completed")') === -1) {
    failures.push("delivered/page.tsx: does not request basis=completed — it would report commissioned CUs as delivered");
  }

  // The client handover export must use the same definition as the pages.
  const exportRel = "lib/client-export.ts";
  let exportSrc = "";
  try {
    exportSrc = readFileSync(join(root, exportRel), "utf8");
  } catch {
    failures.push(`${exportRel}: cannot read`);
  }
  if (exportSrc.length > 0) {
    if (exportSrc.indexOf('from "@/lib/expired-cus"') === -1) {
      failures.push(`${exportRel}: does not import the predicate — the workbook would contradict the page it is launched from`);
    }
    if (exportSrc.indexOf("isExpiredCUWriteOff(") === -1) {
      failures.push(`${exportRel}: never applies the predicate`);
    }
  }

  return failures;
}

/** Deliberately broken predicates; each MUST be caught by check(). */
const MUTANTS: Array<[string, Predicate]> = [
  ["no type gate", (title) => !!title && /expir|retir/i.test(title)],
  [
    'matches "expired" not "expir"',
    (title, type) =>
      !!title && (type || "").trim().toLowerCase() === "service" && /expired|retir/i.test(title),
  ],
  [
    'drops "retir" from the pattern',
    (title, type) =>
      !!title && (type || "").trim().toLowerCase() === "service" && /expir/i.test(title),
  ],
  [
    "case-sensitive name match",
    (title, type) =>
      !!title && (type || "").trim().toLowerCase() === "service" && /Expir|Retir/.test(title),
  ],
  [
    "prefix-matches the type",
    (title, type) =>
      !!title &&
      (type || "").trim().toLowerCase().indexOf("service") === 0 &&
      /expir|retir/i.test(title),
  ],
  ["matches everything", () => true],
];

function main(): void {
  assertPreconditions();
  const selfTest = process.argv.indexOf("--self-test") !== -1;

  if (selfTest) {
    const inert: string[] = [];
    for (let i = 0; i < MUTANTS.length; i++) {
      const name = MUTANTS[i][0];
      const caught = check(MUTANTS[i][1]);
      if (caught.length === 0) {
        inert.push(name);
      } else {
        console.log(`  ✓ mutant killed (${name}) — first: ${caught[0]}`);
      }
    }
    if (inert.length > 0) {
      console.error(
        `\n✗ SELF-TEST FAILED — these mutants were not caught, so the fixtures prove nothing:\n  - ${inert.join(
          "\n  - "
        )}`
      );
      process.exit(1);
    }
    console.log(`\n✓ self-test passed: all ${MUTANTS.length} mutants killed`);
  }

  const failures = check(isExpiredCUWriteOff).concat(checkWiring());
  if (failures.length > 0) {
    console.error(`\n✗ verify-expired-cus FAILED (${failures.length}):\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }

  const negatives = REAL_SERVICE_WORK.length + REAL_NON_SERVICE_MATCHES.length + SYNTHETIC_EXPIRY_WORDED.length;
  console.log(
    `✓ verify-expired-cus passed: ${WRITE_OFFS.length} write-off name variants detected, ` +
      `${negatives} real/plausible items left visible, predicate wired into both pages and the client export`
  );
}

main();
