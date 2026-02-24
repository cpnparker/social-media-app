/**
 * Checks which new tables exist in Supabase.
 * Usage: npx tsx scripts/check-tables.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const NEW_TABLES = [
  "workspaces",
  "workspace_members",
  "teams",
  "team_members",
  "team_accounts",
  "customer_accounts",
  "profile_links",
  "promo_drafts",
  "content_performance",
  "workspace_performance_model",
  "content_assets",
];

async function main() {
  console.log("Checking which new tables exist in Supabase...\n");

  const missing: string[] = [];
  const existing: string[] = [];

  for (const table of NEW_TABLES) {
    const { error } = await supabase.from(table).select("*").limit(0);
    if (error) {
      missing.push(table);
      console.log(`  ✗ ${table} — MISSING (${error.message})`);
    } else {
      existing.push(table);
      console.log(`  ✓ ${table} — exists`);
    }
  }

  // Check new columns on users table
  console.log("\nChecking new columns on users table...");
  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("hashed_password, provider, url_avatar")
    .limit(1);

  if (userErr) {
    console.log(`  ✗ users new columns — MISSING (${userErr.message})`);
    missing.push("users_columns");
  } else {
    console.log("  ✓ users new columns — exist");
    existing.push("users_columns");
  }

  console.log(`\n--- Summary ---`);
  console.log(`Existing: ${existing.length}/${NEW_TABLES.length + 1}`);
  console.log(`Missing: ${missing.length}`);

  if (missing.length > 0) {
    console.log(`\nMissing tables/columns: ${missing.join(", ")}`);
    console.log("\nRun the migration SQL in Supabase SQL Editor:");
    console.log("  scripts/migrate-new-tables.sql");
  } else {
    console.log("\n✅ All tables and columns exist! Ready to seed.");
  }
}

main().catch(console.error);
