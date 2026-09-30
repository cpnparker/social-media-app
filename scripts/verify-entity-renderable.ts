/**
 * Every node type the schema allows must be renderable.
 *
 * This has now failed twice. All 433 works_at edges were unreachable because
 * nothing read entity_edge and nothing wrote edge observations. Then every
 * engagement node would have resolved to silence, because resolve.ts branched
 * on person and org and had no third case. Both were invisible in exactly the
 * same way: the graph held the fact, and no code path could turn it into a
 * sentence.
 *
 * A third time is not worth waiting for.
 */
import { readFileSync } from "fs";

const resolver = readFileSync("lib/entities/resolve.ts", "utf8");
const migration = readFileSync("scripts/add-entity-graph.sql", "utf8");
let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

console.log("\n1. Every node type in the CHECK constraint has a render branch");
const nodeTypes = (/type_node\s+text NOT NULL CHECK \(type_node IN \(([^)]*)\)/.exec(migration)?.[1] || "")
  .match(/'([a-z_]+)'/g)?.map((s) => s.replace(/'/g, "")) || [];
nodeTypes.length >= 3 ? pass(`schema allows: ${nodeTypes.join(", ")}`) : fail("could not read the node types from the migration");
for (const t of nodeTypes) {
  new RegExp(`node\\.type_node === "${t}"`).test(resolver)
    ? pass(`"${t}" has a branch in resolve.ts`)
    : fail(`"${t}" nodes would resolve to silence — no branch in resolve.ts`);
}

console.log("\n2. Edges are read, and their evidence is read with them");
/from\("entity_edge"\)/.test(resolver)
  ? pass("resolve.ts reads entity_edge")
  : fail("nothing reads entity_edge — every relationship is invisible");
/\.in\("id_edge"/.test(resolver)
  ? pass("edge observations are fetched, so an edge can be shown to a reader")
  : fail("edge observations are never read — edges cannot pass the visibility rule");

console.log("\n3. Every visibility class is reachable by SOME reader");
// The generalisation of a bug this system has now produced three times: a fact
// written to the graph that no reader can ever see. 433 works_at edges nothing
// read; engagement nodes with no render branch; and stated facts stored as
// personal_mailbox while the resolver refused every personal_mailbox row
// outright. Each was invisible in a different place, so each needed finding
// separately. This asserts the whole set at once.
const visClasses = (/type_visibility text NOT NULL CHECK \(type_visibility IN\s*\(([^)]*)\)/.exec(migration)?.[1] || "")
  .match(/'([a-z_]+)'/g)?.map((s) => s.replace(/'/g, "")) || [];
visClasses.length >= 4
  ? pass(`schema allows: ${visClasses.join(", ")}`)
  : fail("could not read the visibility classes from the migration");
for (const v of visClasses) {
  // Every class must appear in resolve.ts as something that can return TRUE,
  // not merely be mentioned. A `return false` branch is the bug, not the fix.
  const branch = new RegExp(`type_visibility === "${v}"[\\s\\S]{0,220}`).exec(resolver)?.[0] || "";
  if (!branch) { fail(`"${v}" is never tested in resolve.ts — anything stored with it is unreachable`); continue; }
  // The literal, anywhere in the branch head — NOT anchored to end-of-line.
  // The first version required `return false;` to be followed by a newline,
  // and the bug it was written for ended with a trailing comment, so it
  // reported the shipped defect as fine. Proven against the real line before
  // being trusted.
  /return\s+false\b/.test(branch.split("\n").slice(0, 3).join("\n"))
    ? fail(`"${v}" is tested and always refused — facts stored with it can never be seen`)
    : pass(`"${v}" can be visible to at least one reader`);
}

console.log("\n4. Every proposal action is displayable and applyable");
// The fourth writer/reader mismatch in this project. The reflection pass writes
// set_slot; the engagement backfill writes merge; the review tool understood
// only set_slot — so ten merge proposals rendered as "(unknown)" offering a
// role of "undefined", and marked ** because merge evidence happens to carry
// surfaced:true, asserting a confidence nobody measured.
const review = readFileSync("scripts/review-entity-proposals.ts", "utf8");
const actions = (/type_action\s+text NOT NULL CHECK \(type_action IN\s*\(([^)]*)\)/.exec(migration)?.[1] || "")
  .match(/'([a-z_]+)'/g)?.map((s) => s.replace(/'/g, "")) || [];
actions.length
  ? pass(`schema allows: ${actions.join(", ")}`)
  : fail("could not read the proposal actions from the migration");
// Which actions does anything actually WRITE? Only those must be handled.
const writers = [
  "scripts/reflect-entity-roles.ts", "scripts/backfill-engagements.ts",
  "scripts/backfill-entity-graph.ts", "lib/entities/record.ts",
].map((f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } }).join("\n");
for (const a of actions) {
  const written = new RegExp(`type_action: "${a}"`).test(writers);
  if (!written) { console.log(`  skip  "${a}" is never written by anything`); continue; }
  const displayed = new RegExp(`type_action === "${a}"`).test(review);
  displayed
    ? pass(`"${a}" is written and the review tool handles it`)
    : fail(`"${a}" is WRITTEN but the review tool cannot display or apply it`);
}
// And an unknown action must degrade to something legible rather than to
// "undefined", which is what made ten rows unreadable.
/cannot display or apply this kind yet/.test(review)
  ? pass("an unhandled action says so rather than printing undefined")
  : fail("an unhandled action would render as undefined");

console.log("\n5. Backfills evidence what they create");
for (const f of ["scripts/backfill-entity-graph.ts", "scripts/backfill-engagements.ts"]) {
  const src = readFileSync(f, "utf8");
  const makesEdges = /from\("entity_edge"\)[\s\S]{0,200}(insert|upsert)/.test(src);
  if (!makesEdges) { console.log(`  skip  ${f} creates no edges`); continue; }
  /id_edge/.test(src)
    ? pass(`${f} observes the edges it creates`)
    : fail(`${f} creates edges with no observation — they will be invisible`);
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
