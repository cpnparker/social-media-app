/**
 * Phase 0 of the Airtable resourcing integration — run with `npx tsx`.
 *
 *   AIRTABLE_PAT=... AIRTABLE_RESOURCING_BASE=app... npx tsx scripts/airtable-introspect.ts
 *
 * Prints the base's tables and fields, then the three findings that decide the
 * shape of every report downstream. The analysis itself lives in
 * lib/airtable/introspect.ts, shared with GET /api/airtable/status?schema=1 so
 * the CLI and the endpoint cannot drift.
 *
 * Note that AIRTABLE_PAT is stored Sensitive in Vercel and therefore cannot be
 * pulled to a developer machine — by design. Unless you have the token to hand,
 * the endpoint is the way to run this, because it runs where the credential is.
 *
 * Read-only. Lists schema and counts rows; writes nothing and prints no cell
 * values, so it is safe against the live base.
 */
import { airtableConfigured } from "../lib/airtable/client";
import { runPhase0 } from "../lib/airtable/introspect";

async function main() {
  if (!airtableConfigured()) {
    console.error(
      "\nAIRTABLE_PAT and AIRTABLE_RESOURCING_BASE must both be set.\n" +
        "They are Sensitive in Vercel and cannot be pulled — pass them inline, or use\n" +
        "GET /api/airtable/status?workspaceId=…&schema=1 as an admin instead.\n"
    );
    process.exit(1);
  }

  console.log("Reading base schema…");
  const f = await runPhase0({ withCounts: true });

  console.log(`\n${f.tables.length} table(s):`);
  for (const t of f.tables) {
    const count = t.countError ? `  (count failed: ${t.countError})` : t.rowCount !== undefined ? `  ${t.rowCount} rows${t.truncated ? " ⚠ TRUNCATED" : ""}` : "";
    console.log(`\n  ${t.name}${count}`);
    for (const field of t.fields) {
      console.log(`      ${field.name.padEnd(34)} ${field.type}${field.linkedTableId ? ` → ${field.linkedTableId}` : ""}`);
    }
    if (t.views.length) console.log(`      views: ${t.views.join(", ")}`);
  }

  console.log("\n" + "─".repeat(72));
  console.log("PHASE 0 FINDINGS");
  console.log("─".repeat(72));

  console.log("\n1. PEOPLE");
  if (!f.people.length) console.log("   (no table matched on name — identify by eye above)");
  for (const p of f.people) {
    console.log(`   ${p.table}: ${p.emailFields.length ? `email → ${p.emailFields.join(", ")}` : "⚠ NO EMAIL COLUMN"}`);
  }

  console.log("\n2. MONTHLY EXPECTATIONS / CAPACITY");
  if (!f.periodTables.length) console.log("   (nothing matched)");
  for (const p of f.periodTables) {
    console.log(`   ${p.table}`);
    console.log(`      period fields: ${p.periodFields.join(", ") || "(none)"}`);
    console.log(`      links to:      ${p.linkFields.join(", ") || "(none — grain may be flat)"}`);
  }

  console.log("\n3. CLIENT IDENTITY");
  if (!f.clientTables.length) console.log("   (no table matched on name)");
  for (const c of f.clientTables) {
    console.log(`   ${c.table}: ${c.idLikeFields.length ? `id-like → ${c.idLikeFields.join(", ")}` : "no id field — must match on normalised name"}`);
  }

  if (f.warnings.length) {
    console.log("\n" + "─".repeat(72));
    console.log("WARNINGS");
    console.log("─".repeat(72));
    for (const w of f.warnings) console.log(`\n  • ${w}`);
  }

  console.log("\nEverything downstream of this in the plan is provisional until these are read.\n");
}

main().catch((e) => {
  console.error("\nFailed:", e?.message || e, "\n");
  process.exit(1);
});
