/**
 * Validate scripts/add-client-snapshot.sql against Neon, rolled back.
 * `npx tsx scripts/validate-client-snapshot-sql.ts`
 *
 * Checks the two properties that would otherwise be discovered in production:
 * that every numeric column is NULLABLE (null means "not recorded" and must
 * never collapse to 0), and that the one-row-per-client constraint actually
 * upserts rather than accumulating a new row every night.
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import { Client } from "pg";
config({ path: ".env.local" });

const CONN = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!CONN) { console.error("No database URL in .env.local"); process.exit(1); }

let pass = 0, fail = 0; const failures: string[] = [];
const check = (n: string, ok: boolean, d?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; failures.push(`${n}${d ? ` — ${d}` : ""}`); console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); }
};

async function main() {
  const c = new Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } });
  await c.connect();
  let open = false;
  try {
    await c.query("BEGIN"); open = true;
    await c.query("CREATE SCHEMA IF NOT EXISTS intelligence");

    console.log("\n1. The script executes");
    const sql = readFileSync("scripts/add-client-snapshot.sql", "utf8").split(/^SELECT\s*$/m)[0];
    try { await c.query(sql); check("add-client-snapshot.sql executes", true); }
    catch (e: any) { check("add-client-snapshot.sql executes", false, e.message); return; }

    console.log("\n2. Null means 'not recorded' — every numeric column allows it");
    const { rows: cols } = await c.query(`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_schema='intelligence' AND table_name='ai_client_summary_snapshot'
    `);
    const numeric = cols.filter((r: any) => ["numeric", "integer", "date"].includes(r.data_type)
      && !["id_client"].includes(r.column_name)
      && !r.column_name.startsWith("flag_"));
    const notNullable = numeric.filter((r: any) => r.is_nullable === "NO");
    check(`all ${numeric.length} measure columns are nullable`, notNullable.length === 0,
      notNullable.map((r: any) => r.column_name).join(", "));

    console.log("\n3. One row per client — a nightly run updates, never accumulates");
    await c.query(`INSERT INTO intelligence.ai_client_summary_snapshot (id_client, name_client, units_delivered_12m) VALUES (91,'Siemens',5)`);
    await c.query(`
      INSERT INTO intelligence.ai_client_summary_snapshot (id_client, name_client, units_delivered_12m)
      VALUES (91,'Siemens',9)
      ON CONFLICT (id_client) DO UPDATE SET units_delivered_12m = EXCLUDED.units_delivered_12m, date_refreshed = now()
    `);
    const { rows: after } = await c.query(`SELECT count(*)::int n, max(units_delivered_12m) v FROM intelligence.ai_client_summary_snapshot WHERE id_client=91`);
    check("second run updates rather than inserting", after[0].n === 1, `${after[0].n} rows`);
    check("the updated value wins", Number(after[0].v) === 9, String(after[0].v));

    console.log("\n4. A measure genuinely absent stays null, not zero");
    await c.query(`INSERT INTO intelligence.ai_client_summary_snapshot (id_client, name_client) VALUES (92,'Zurich Instruments')`);
    const { rows: z } = await c.query(`SELECT units_delivered_12m, count_meetings_90d FROM intelligence.ai_client_summary_snapshot WHERE id_client=92`);
    check("unset numeric columns read as null", z[0].units_delivered_12m === null && z[0].count_meetings_90d === null,
      JSON.stringify(z[0]));

    console.log("\n5. The run log exists");
    await c.query(`INSERT INTO intelligence.ai_client_summary_run (count_clients) VALUES (2)`);
    const { rows: r } = await c.query(`SELECT count(*)::int n FROM intelligence.ai_client_summary_run`);
    check("run rows can be written", r[0].n === 1);
  } finally {
    if (open) { await c.query("ROLLBACK"); console.log("\n  (rolled back — nothing persisted)"); }
    await c.end();
    console.log(`\n${pass} passed, ${fail} failed`);
    if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
    process.exit(fail ? 1 : 0);
  }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
