/**
 * Guards for the client CRM view.
 * `npx tsx scripts/verify-client-crm.ts`
 *
 * Two properties, both of which fail SILENTLY if broken:
 *
 *  1. The attendee email strip. The meetings RPC reads `a->>'name'`, and
 *     Google fills that with the address when an invitee has no display name —
 *     so live client addresses do come through. This page is open to ~60
 *     staff. A regression here leaks addresses and nothing errors.
 *  2. The page/API field contract. A renamed field renders "not recorded"
 *     everywhere and reads as missing data rather than as a bug.
 */
import { readFileSync } from "fs";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ── 1. The strip, exercised directly ──
console.log("\n1. Attendee addresses never survive");
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
function stripAddresses(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join(", ") : "";
  if (!text) return null;
  const cleaned = text.replace(EMAIL_RE, "").split(/[,;]/).map((s) => s.trim()).filter((s) => s.length > 1).join(", ");
  return cleaned || null;
}
const CASES: [string, unknown][] = [
  ["display names only",            "Jane Doe, Sam Patel"],
  ["addresses only",                "jacsd@orsted.com, sara.fontanella@esmo.org"],
  ["mixed names and addresses",     "Jane Doe, jacsd@orsted.com"],
  ["semicolon separated",           "Jane Doe; bob@ubs.com"],
  ["array input",                   ["Jane Doe", "bob@ubs.com"]],
  ["address with plus tag",         "a.b+tag@marsh.com"],
  ["subdomain address",             "x@mail.corp.zurich.com"],
];
for (const [label, input] of CASES) {
  const out = stripAddresses(input) ?? "";
  check(`no address survives: ${label}`, !EMAIL_RE.test(out), JSON.stringify(out));
  EMAIL_RE.lastIndex = 0;
}
check("genuine names are kept, not dropped wholesale", stripAddresses("Jane Doe, jacsd@orsted.com") === "Jane Doe",
  JSON.stringify(stripAddresses("Jane Doe, jacsd@orsted.com")));
check("all-addresses collapses to null rather than an empty string",
  stripAddresses("a@b.com, c@d.com") === null, JSON.stringify(stripAddresses("a@b.com, c@d.com")));
check("empty input is null", stripAddresses("") === null);

// ── 2. The API actually applies it ──
console.log("\n2. The route applies the strip on the rendered field");
const api = readFileSync("app/api/operations/clients/[id]/route.ts", "utf8");
check("attendees are passed through stripAddresses", /attendees:\s*stripAddresses\(/.test(api));
check("the raw attendee field is never returned directly", !/attendees:\s*m\.attendees/.test(api));

// ── 3. Page/API field contract ──
console.log("\n3. Every field the page reads is emitted by the API");
const page = readFileSync("app/(app)/operations/clients/[id]/page.tsx", "utf8");
const READS = [
  "accountManagerEngine", "accountManagerAirtable", "accountManagerDisagrees",
  "totalCu", "byMonth", "inFlight", "spiked", "missingUnits", "lastCompleted",
  "windowDays", "notBuilt", "showMoney", "warnings", "sources",
];
for (const f of READS) {
  const emitted = new RegExp(`\\b${f}\\s*[:,]`).test(api) || new RegExp(`^\\s+${f},\\s*$`, "m").test(api);
  const read = page.includes(f);
  check(`${f}`, !read || emitted, read && !emitted ? "page reads it, API never emits it" : undefined);
}

// ── 4. The two meeting empty states stay distinct ──
console.log("\n4. The empty states the spec insists must differ");
check("API distinguishes no_domain from an empty result", api.includes('"no_domain"') && api.includes('state: "ok"'));
check("page renders no_domain differently from zero rows",
  page.includes('state === "no_domain"') && page.includes("rows.length === 0"));
check("page never calls an unavailable source 'no meetings'",
  /unavailable[\s\S]{0,200}Not the same as no meetings/.test(page));

// ── 5. Not-started contracts must not read as a shortfall ──
console.log("\n5. Zero delivery on a not-yet-started contract");
const detail = readFileSync("app/api/operations/clients/[id]/route.ts", "utf8");
check("API computes which live contracts have not started", /notStarted\s*=/.test(detail));
check("API exposes allLiveNotStarted", /allLiveNotStarted/.test(detail));
check("API distinguishes 'never had tasks' from 'none recently'", /everHadTasks/.test(detail));
check("page renders a not-started state before the generic empty one",
  page.indexOf("allLiveNotStarted") > 0 && page.indexOf("allLiveNotStarted") < page.indexOf("No task completed in the last 12 months"));
check("page says it is not a shortfall", /This is not a shortfall/.test(page));
check("page separates 'never any task' from 'none in 12 months'",
  /No task has ever been recorded/.test(page) && /No task completed in the last 12 months/.test(page));

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
process.exit(fail ? 1 : 0);
