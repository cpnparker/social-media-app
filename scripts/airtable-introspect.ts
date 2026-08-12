/**
 * Phase 0 of the Airtable resourcing integration — run with `npx tsx`.
 *
 *   AIRTABLE_PAT=... AIRTABLE_RESOURCING_BASE=app... npx tsx scripts/airtable-introspect.ts
 *
 * Prints every table, field and type in the base, then answers the three
 * questions the plan says decide the whole shape of the reports:
 *
 *   1. Which table holds PEOPLE, and does it carry an EMAIL column? This is the
 *      one that can sink the design. Airtable identifies people by name, the
 *      Engine identifies them by id_user, and production has two distinct users
 *      called "Mike Parsons" and two called "Faher Elfayez". Joining on a
 *      display name would silently merge colleagues' capacity into one row.
 *   2. Which table holds monthly expectations, and at what GRAIN — per client,
 *      per person, per month?
 *   3. How does a row identify a CLIENT — a stable id, or a name we would have
 *      to match against app_clients?
 *
 * Read-only. It lists schema and counts rows; it writes nothing and prints no
 * cell values, so it is safe to run against the live base.
 */
import { getBaseSchema, listRecords, airtableConfigured, type AirtableTable } from "../lib/airtable/client";

const EMAIL_HINTS = ["email", "e-mail", "mail"];
const PERSON_HINTS = ["person", "people", "team", "staff", "member", "resource", "employee"];
const CLIENT_HINTS = ["client", "customer", "account", "company", "organisation", "organization"];
const MONTH_HINTS = ["month", "period", "forecast", "plan", "expectation", "target", "quota", "capacity"];

const has = (s: string, hints: string[]) => hints.some((h) => s.toLowerCase().includes(h));

function describe(t: AirtableTable): void {
  console.log(`\n  ${t.name}  (${t.fields.length} fields)`);
  for (const f of t.fields) {
    // linked-record fields are the ones that tell us how tables relate, so
    // surface their target rather than just the type name.
    const link = f.type === "multipleRecordLinks" ? ` → ${(f.options as any)?.linkedTableId || "?"}` : "";
    console.log(`      ${f.name.padEnd(34)} ${f.type}${link}`);
  }
  if (t.views?.length) {
    console.log(`      views: ${t.views.map((v) => v.name).join(", ")}`);
  }
}

async function main() {
  if (!airtableConfigured()) {
    console.error(
      "\nAIRTABLE_PAT and AIRTABLE_RESOURCING_BASE must both be set.\n" +
        "Run with them inline, or add them to the Engine Vercel project and pull.\n"
    );
    process.exit(1);
  }

  console.log("Reading base schema…");
  const { tables } = await getBaseSchema();
  console.log(`\n${tables.length} table(s) found.`);

  for (const t of tables) describe(t);

  /* ── The three questions ── */

  console.log("\n" + "─".repeat(72));
  console.log("PHASE 0 FINDINGS");
  console.log("─".repeat(72));

  // 1. People and the email column.
  const peopleTables = tables.filter((t) => has(t.name, PERSON_HINTS));
  console.log("\n1. PEOPLE");
  if (!peopleTables.length) {
    console.log("   No obvious people/team table by name — needs a human eye over the list above.");
  }
  for (const t of peopleTables) {
    const emailFields = t.fields.filter((f) => f.type === "email" || has(f.name, EMAIL_HINTS));
    console.log(`   ${t.name}: ${emailFields.length ? `email column present → ${emailFields.map((f) => f.name).join(", ")}` : "⚠ NO EMAIL COLUMN"}`);
    if (!emailFields.length) {
      console.log("      ⚠ This blocks a safe identity join. Matching on display names WILL merge");
      console.log("        colleagues — production has duplicate names. Adding an email column is");
      console.log("        the first fix, before any report is built on this table.");
    }
  }

  // 2. Monthly expectations and their grain.
  console.log("\n2. MONTHLY EXPECTATIONS / CAPACITY");
  const monthTables = tables.filter((t) => has(t.name, MONTH_HINTS) || t.fields.some((f) => has(f.name, MONTH_HINTS)));
  if (!monthTables.length) {
    console.log("   Nothing matched on name — the forward-looking numbers may live as fields on");
    console.log("   another table, or may not exist yet. This is the gap the integration exists to fill,");
    console.log("   so worth confirming before building the monthly_plan report.");
  }
  for (const t of monthTables) {
    const dateish = t.fields.filter((f) => ["date", "dateTime"].includes(f.type) || has(f.name, MONTH_HINTS));
    const links = t.fields.filter((f) => f.type === "multipleRecordLinks");
    console.log(`   ${t.name}`);
    console.log(`      period fields: ${dateish.map((f) => f.name).join(", ") || "(none)"}`);
    console.log(`      links to:      ${links.map((f) => f.name).join(", ") || "(none — grain may be flat)"}`);
  }

  // 3. Client identity.
  console.log("\n3. CLIENT IDENTITY");
  const clientTables = tables.filter((t) => has(t.name, CLIENT_HINTS));
  if (!clientTables.length) {
    console.log("   No obvious client table — clients may be a text field or a link elsewhere.");
  }
  for (const t of clientTables) {
    const idish = t.fields.filter((f) => /\bid\b|code|ref/i.test(f.name));
    console.log(`   ${t.name}: ${idish.length ? `possible stable id → ${idish.map((f) => f.name).join(", ")}` : "no id-like field — will have to match on normalised name against app_clients"}`);
  }

  /* ── Volume, to size the reports and confirm pagination behaviour ── */

  console.log("\n4. ROW COUNTS (also proves pagination + rate limiting work)");
  for (const t of tables) {
    try {
      // fields[] with a single field keeps the payload small; we only want counts.
      const first = t.fields[0]?.name;
      const res = await listRecords(t.name, first ? { fields: [first] } : {});
      console.log(`   ${t.name.padEnd(34)} ${String(res.count).padStart(5)}${res.truncated ? "  ⚠ TRUNCATED — more than the page ceiling" : ""}`);
    } catch (e: any) {
      console.log(`   ${t.name.padEnd(34)}    ?  (${String(e?.message || e).slice(0, 80)})`);
    }
  }

  console.log("\nDone. Everything in the plan downstream of this is provisional until these");
  console.log("findings are read — particularly the identity join in §6.\n");
}

main().catch((e) => {
  console.error("\nFailed:", e?.message || e, "\n");
  process.exit(1);
});
