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

console.log("\n3. Backfills evidence what they create");
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
