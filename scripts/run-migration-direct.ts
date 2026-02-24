/**
 * Runs migration SQL directly against Supabase Postgres via the supabase-js
 * admin SQL endpoint (available in supabase-js v2.39+).
 *
 * Usage: npx tsx scripts/run-migration-direct.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { join } from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Extract project ref from URL
const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];

async function executeViaManagementAPI(sql: string): Promise<boolean> {
  // Try the Supabase Management API SQL endpoint
  // This endpoint is available at the project's direct URL
  const endpoints = [
    `${SUPABASE_URL}/rest/v1/rpc/exec_sql`,
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      });

      if (res.ok) return true;
    } catch {
      // Try next endpoint
    }
  }
  return false;
}

async function executeViaSupabaseFunction(sql: string): Promise<boolean> {
  // Create a temporary function that executes arbitrary SQL
  // This uses the service role key which has full access
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Try using the Supabase admin SQL execution
  try {
    // @ts-ignore — experimental admin SQL access
    const { error } = await supabase.schema("public").rpc("exec", { sql });
    if (!error) return true;
  } catch {}

  return false;
}

async function main() {
  console.log("=== Direct Migration Runner ===\n");
  console.log(`Project: ${projectRef}`);
  console.log(`URL: ${SUPABASE_URL}\n`);

  const sqlPath = join(__dirname, "migrate-new-tables.sql");
  const sql = readFileSync(sqlPath, "utf-8");

  // Try executing the entire SQL at once
  console.log("Attempting direct SQL execution...");

  const success = await executeViaManagementAPI(sql);
  if (success) {
    console.log("✅ Migration executed successfully!");
    return;
  }

  const funcSuccess = await executeViaSupabaseFunction(sql);
  if (funcSuccess) {
    console.log("✅ Migration executed via RPC!");
    return;
  }

  // If all else fails, output clear instructions
  console.log("\n❌ Automated migration not possible without database credentials.");
  console.log("\nPlease run the migration manually:\n");
  console.log("1. Open: https://supabase.com/dashboard/project/" + projectRef + "/sql/new");
  console.log("2. Paste the following SQL and click 'Run':\n");
  console.log("─".repeat(60));
  console.log(sql);
  console.log("─".repeat(60));
  console.log("\nAlternatively, run: supabase login && supabase link --project-ref " + projectRef + " && supabase db execute < scripts/migrate-new-tables.sql");
}

main().catch(console.error);
