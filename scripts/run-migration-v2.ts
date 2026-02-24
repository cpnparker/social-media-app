/**
 * Runs the migration SQL against Supabase using the pg/query HTTP endpoint.
 * Usage: npx tsx scripts/run-migration-v2.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { join } from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function executeSQL(sql: string): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "x-connection-encrypted": "true",
    },
    body: JSON.stringify({ query: sql }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function main() {
  console.log("=== Supabase Migration Runner v2 ===\n");

  const sqlPath = join(__dirname, "migrate-new-tables.sql");
  const sql = readFileSync(sqlPath, "utf-8");

  // Remove comments and split into individual statements
  const cleaned = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  // Split by double newline + statement boundary to get logical groups
  const statements = cleaned
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(`Found ${statements.length} statements\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i] + ";";
    const preview = stmt.substring(0, 70).replace(/\n/g, " ");
    process.stdout.write(`[${i + 1}/${statements.length}] ${preview}...`);

    try {
      await executeSQL(stmt);
      console.log(" ✓");
      success++;
    } catch (err: any) {
      console.log(` ✗ (${err.message.substring(0, 60)})`);
      failed++;
    }
  }

  console.log(`\n--- Done ---`);
  console.log(`Success: ${success}, Failed: ${failed}`);

  if (failed > 0) {
    console.log("\nSome statements failed. This might be OK if:");
    console.log("  - Tables already exist (IF NOT EXISTS)");
    console.log("  - Or try running the SQL manually in Supabase SQL Editor");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
