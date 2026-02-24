/**
 * Runs the migration SQL against Supabase using the Management API.
 * Uses the service role key to authenticate.
 *
 * Usage: npx tsx scripts/run-migration.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { join } from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function runSQL(sql: string): Promise<void> {
  // Use the Supabase SQL execution endpoint
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    // Fallback: try executing via pg/query endpoint
    throw new Error(`REST RPC failed: ${res.status}`);
  }
}

// Split SQL into individual statements and execute them one at a time
async function runStatements(sql: string): Promise<void> {
  // Split by semicolons, filter empty
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  console.log(`Found ${statements.length} SQL statements to execute\n`);

  // Use the createClient approach with raw SQL via rpc
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    db: { schema: "public" },
  });

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.substring(0, 80).replace(/\n/g, " ");
    process.stdout.write(`[${i + 1}/${statements.length}] ${preview}...`);

    try {
      // Try using the Supabase SQL endpoint
      const { error } = await supabase.rpc("exec_sql" as any, {
        query: stmt + ";",
      });

      if (error) {
        // If exec_sql doesn't exist, fall back to checking if it's a CREATE TABLE
        // and use the table existence check approach
        throw error;
      }
      console.log(" ✓");
    } catch {
      // Log but continue — some statements may fail if tables already exist
      // (IF NOT EXISTS handles this gracefully at the DB level)
      console.log(` ⚠ (may need manual execution)`);
    }
  }
}

async function main() {
  console.log("=== Supabase Migration Runner ===\n");
  console.log(`Target: ${SUPABASE_URL}\n`);

  const sqlPath = join(__dirname, "migrate-new-tables.sql");
  const sql = readFileSync(sqlPath, "utf-8");

  try {
    await runStatements(sql);
    console.log("\n⚠️  If statements showed warnings, run the SQL manually:");
    console.log("   1. Open Supabase Dashboard → SQL Editor");
    console.log("   2. Paste contents of scripts/migrate-new-tables.sql");
    console.log("   3. Click 'Run'\n");
  } catch (err: any) {
    console.error("\nMigration failed:", err.message);
    console.log("\n📋 Please run the migration manually:");
    console.log("   1. Open Supabase Dashboard → SQL Editor");
    console.log("   2. Paste contents of scripts/migrate-new-tables.sql");
    console.log("   3. Click 'Run'");
    process.exit(1);
  }
}

main();
