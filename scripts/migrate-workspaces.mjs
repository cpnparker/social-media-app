/**
 * Migrate workspace data from Neon → Supabase intelligence schema.
 *
 * PREREQUISITE: Run scripts/create-workspace-tables.sql in Supabase SQL Editor first!
 *
 * Usage:
 *   node scripts/migrate-workspaces.mjs
 *
 * This migrates:
 *   Neon workspaces         → intelligence.workspaces
 *   Neon workspace_members  → intelligence.workspace_members (with UUID→integer user ID mapping)
 *
 * User IDs are mapped by matching email addresses between Neon users (UUID)
 * and Supabase users (integer id_user).
 */

import { config } from "dotenv";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const { Pool } = pg;

const neonPool = new Pool({ connectionString: process.env.DATABASE_URL });

// Intelligence schema client (where workspace tables live)
const intelligenceDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { db: { schema: "intelligence" } }
);

// Public schema client (for user lookup)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function queryNeon(sql) {
  const { rows } = await neonPool.query(sql);
  return rows;
}

async function main() {
  console.log("=== Workspace Migration: Neon → Supabase Intelligence Schema ===\n");

  // Test connections
  try {
    await queryNeon("SELECT 1 as ok");
    console.log("Neon connection: OK");
  } catch (e) {
    console.error("Neon connection FAILED:", e.message);
    process.exit(1);
  }

  try {
    const { data, error } = await intelligenceDb.from("workspaces").select("id").limit(1);
    if (error) throw error;
    console.log("Supabase intelligence.workspaces table: OK");
  } catch (e) {
    console.error("Supabase intelligence.workspaces table NOT FOUND:", e.message);
    console.error("\nPlease run scripts/create-workspace-tables.sql in the Supabase SQL Editor first!");
    process.exit(1);
  }

  // ── Step 1: Migrate workspaces ──
  console.log("\n1. Migrating workspaces...");
  const neonWorkspaces = await queryNeon("SELECT * FROM workspaces ORDER BY created_at");
  console.log(`   Found ${neonWorkspaces.length} workspaces in Neon`);

  for (const ws of neonWorkspaces) {
    const row = {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      plan: ws.plan || "free",
      late_api_key: ws.late_api_key || null,
      created_at: ws.created_at,
      updated_at: ws.updated_at,
    };

    const { error } = await intelligenceDb.from("workspaces").upsert(row);
    if (error) {
      console.error(`   ERROR inserting workspace "${ws.name}":`, error.message);
    } else {
      console.log(`   ✓ Workspace "${ws.name}" (${ws.id})`);
    }
  }

  // ── Step 2: Build user ID mapping (Neon UUID → Supabase integer) ──
  console.log("\n2. Building user ID mapping...");
  const neonUsers = await queryNeon("SELECT id, email FROM users");
  console.log(`   Found ${neonUsers.length} users in Neon`);

  // Fetch all Supabase users (from public schema)
  const { data: supabaseUsers, error: usersErr } = await supabase
    .from("users")
    .select("id_user, email_user");
  if (usersErr) {
    console.error("   ERROR fetching Supabase users:", usersErr.message);
    process.exit(1);
  }
  console.log(`   Found ${supabaseUsers.length} users in Supabase`);

  // Map Neon UUID → Supabase integer by email
  const neonEmailMap = new Map(neonUsers.map((u) => [u.id, u.email?.toLowerCase()]));
  const supabaseEmailMap = new Map(supabaseUsers.map((u) => [u.email_user?.toLowerCase(), u.id_user]));

  const userIdMap = new Map(); // Neon UUID → Supabase integer
  let mapped = 0;
  let unmapped = 0;
  for (const [neonId, email] of neonEmailMap) {
    const supabaseId = supabaseEmailMap.get(email);
    if (supabaseId) {
      userIdMap.set(neonId, supabaseId);
      mapped++;
    } else {
      console.log(`   ⚠ No Supabase match for Neon user ${neonId} (${email})`);
      unmapped++;
    }
  }
  console.log(`   Mapped: ${mapped}, Unmapped: ${unmapped}`);

  // ── Step 3: Migrate workspace_members ──
  console.log("\n3. Migrating workspace_members...");
  const neonMembers = await queryNeon("SELECT * FROM workspace_members ORDER BY invited_at");
  console.log(`   Found ${neonMembers.length} workspace members in Neon`);

  let membersMigrated = 0;
  let membersSkipped = 0;
  for (const m of neonMembers) {
    const supabaseUserId = userIdMap.get(m.user_id);
    if (!supabaseUserId) {
      const email = neonEmailMap.get(m.user_id) || "unknown";
      console.log(`   ⚠ Skipping member ${m.user_id} (${email}) — no Supabase match`);
      membersSkipped++;
      continue;
    }

    const row = {
      workspace_id: m.workspace_id,
      user_id: supabaseUserId,
      role: m.role || "viewer",
      invited_at: m.invited_at,
      joined_at: m.joined_at || null,
    };

    const { error } = await intelligenceDb.from("workspace_members").upsert(row, {
      onConflict: "workspace_id,user_id",
    });
    if (error) {
      console.error(`   ERROR inserting member (ws=${m.workspace_id}, user=${supabaseUserId}):`, error.message);
    } else {
      const email = neonEmailMap.get(m.user_id) || "unknown";
      console.log(`   ✓ ${email} → workspace ${m.workspace_id} (role: ${m.role})`);
      membersMigrated++;
    }
  }

  // ── Summary ──
  console.log("\n=== Migration Summary ===");
  console.log(`Workspaces: ${neonWorkspaces.length} migrated`);
  console.log(`Members:    ${membersMigrated} migrated, ${membersSkipped} skipped`);

  // Verify
  console.log("\nVerification (Supabase intelligence counts):");
  const { count: wsCount } = await intelligenceDb.from("workspaces").select("*", { count: "exact", head: true });
  const { count: wmCount } = await intelligenceDb.from("workspace_members").select("*", { count: "exact", head: true });
  console.log(`  workspaces: ${wsCount}`);
  console.log(`  workspace_members: ${wmCount}`);

  await neonPool.end();
}

main().catch((e) => {
  console.error("Migration failed:", e);
  neonPool.end();
  process.exit(1);
});
