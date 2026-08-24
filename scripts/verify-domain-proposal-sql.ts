/**
 * The generated SQL must be valid against the table it targets.
 *
 * A multi-row INSERT fails WHOLE on a CHECK violation. The first version of the
 * proposer emitted type_source 'website' — a value invented for readability
 * that client_email_domains does not allow — so a carefully-reviewed 28-row
 * bulk write would have inserted nothing at all and reported an error that
 * looked like a connection problem.
 *
 * That is the fourth wrong-value-fails-the-statement incident in this project
 * today. The others were found by their effects; this one is checked.
 */
import { readFileSync } from "fs";

const proposer = readFileSync("scripts/propose-client-domains-from-website.ts", "utf8");
const migration = readFileSync("scripts/add-client-email-domains.sql", "utf8");
let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

console.log("\n1. Every literal the proposer emits is allowed by the CHECK");
const allowed = (/type_source\s+text\s+NOT NULL DEFAULT '[a-z_]+'\s*\n?\s*CHECK \(type_source IN \(([^)]*)\)\)/.exec(migration)?.[1] || "")
  .match(/'([a-z_]+)'/g)?.map((s) => s.replace(/'/g, "")) || [];
allowed.length
  ? pass(`table allows: ${allowed.join(", ")}`)
  : fail("could not read the allowed type_source values from the migration");

// Every quoted value the proposer places in the type_source column position.
const emitted = Array.from(proposer.matchAll(/\$\{r\.domain\}',\s*'([a-z_]+)'/g)).map((m) => m[1]);
emitted.length ? pass(`proposer emits: ${Array.from(new Set(emitted)).join(", ")}`) : fail("found no emitted type_source value to check");
for (const v of Array.from(new Set(emitted))) {
  allowed.indexOf(v) >= 0
    ? pass(`"${v}" is accepted by the table`)
    : fail(`"${v}" is NOT in the CHECK — the whole INSERT would fail with 23514`);
}

console.log("\n2. No domain is emitted for more than one client");
/const canonical/.test(proposer) && /rows\.sort\(\(a, b\) => a\.id - b\.id\)/.test(proposer)
  ? pass("shared domains collapse to one canonical client")
  : fail("a domain could be emitted twice — the join deletes any domain claimed by two clients");

console.log("\n3. Confirmed rows are only ever emitted for corroborated candidates");
/flag_confirmed = 1/.test(proposer) && /websiteOnly[\s\S]{0,400}UNCONFIRMED/.test(proposer)
  ? pass("website-only candidates are left unconfirmed")
  : fail("uncorroborated candidates may be emitted as confirmed");

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
