/**
 * Assertions for the forecast row matcher — `npx tsx`.
 *
 * These exist because of one wrong answer. Asked whether the Gavi IFFIm
 * contract was in the 2026 forecast, EngineAI searched "Gavi Ifim" — what
 * speech-to-text makes of the name — against a row labelled "Gavi IFFIM",
 * matched nothing, and said the contract was not there. It was: 49,672 CHF
 * across September to December, on the "Monthly revenue" sheet.
 *
 * The first case below is that exact pair. No network, no credentials.
 */
import { labelMatches } from "../lib/finance/forecast";

let passed = 0;
const failures: string[] = [];
const eq = (actual: unknown, expected: unknown, label: string) => {
  if (Object.is(actual, expected)) passed++;
  else failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

/** Same normalisation the serializer applies before matching. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* ── the failure that shipped ── */
eq(
  labelMatches(norm("Gavi IFFIM"), [norm("Gavi Ifim")]),
  true,
  "'Gavi Ifim' finds the live 'Gavi IFFIM' row — the answer that was reported missing"
);
eq(
  labelMatches(norm("GAVI IFFIm (WON)"), [norm("Gavi Ifim")]),
  true,
  "and finds the superseded zeroed row, so both can be compared"
);
eq(
  "gavi iffim".includes("gavi ifim"),
  false,
  "whole-string containment genuinely fails here — the two spellings are one letter apart"
);

/* ── ordinary matching still works ── */
eq(labelMatches(norm("Gavi IFFIM"), [norm("gavi")]), true, "single word");
eq(labelMatches(norm("WBCSD"), [norm("wbcsd")]), true, "exact label");
eq(labelMatches(norm("Net profit"), [norm("net profit")]), true, "multi-word exact");
eq(labelMatches(norm("Gross margin %"), [norm("gross margin")]), true, "punctuation normalised away");
eq(labelMatches(norm("Marsh"), [norm("marsh"), norm("varo")]), true, "any of several terms");

/* ── it must still NARROW; over-matching everything would be its own failure ── */
eq(labelMatches(norm("Marsh"), [norm("Gavi Ifim")]), false, "an unrelated client is not dragged in");
eq(labelMatches(norm("IPU 2026"), [norm("gavi")]), false, "no false positive on a different row");
eq(labelMatches(norm("VARO"), [norm("net profit")]), false, "a client row does not match a metric term");

/* ── the length rule applies to words SPLIT OUT of a multi-word term ──
   A deliberate short search still works — that is the original containment
   behaviour and a caller asking for "if" means it. What the rule prevents is a
   multi-word term decomposing into noise: "gavi if" must not match every row
   containing "if" merely because one of its words is short. */
eq(labelMatches(norm("Marsh"), [norm("a r")]), false, "a term of only short words matches nothing");
eq(labelMatches(norm("Gavi IFFIM"), [norm("if")]), true, "a deliberate short search still matches directly");
eq(
  labelMatches(norm("Different row"), [norm("gavi if")]),
  false,
  "but the short word inside a multi-word term is NOT used on its own"
);
eq(labelMatches(norm("Gavi IFFIM"), [norm("iffim")]), true, "a three-plus fragment matches");

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("Forecast row matcher verified.\n");
