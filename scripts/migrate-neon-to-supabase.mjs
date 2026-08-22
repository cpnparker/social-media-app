/**
 * Migrate EngineGPT data from Neon (old Drizzle schema) → Supabase intelligence schema.
 *
 * Usage:
 *   node scripts/migrate-neon-to-supabase.mjs
 *
 * Requires env vars in .env.local:
 *   DATABASE_URL                  – Neon pooled connection string
 *   NEXT_PUBLIC_SUPABASE_URL      – Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY     – Supabase service role key
 *
 * Mapping (7 tables):
 *   Neon ai_conversations        → intelligence.ai_conversations
 *   Neon ai_messages             → intelligence.ai_messages
 *   Neon ai_conversation_shares  → intelligence.ai_shares
 *   Neon ai_roles                → intelligence.ai_roles
 *   Neon ai_memories             → intelligence.ai_memories
 *   Neon ai_usage                → intelligence.ai_usage
 *   Neon user_access             → intelligence.users_access
 *   Neon workspaces (ai_* cols)  → intelligence.ai_settings
 */

import { config } from "dotenv";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const { Pool } = pg;

// ── Connections ──
const neonPool = new Pool({ connectionString: process.env.DATABASE_URL });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { db: { schema: "intelligence" } }
);

// ── Helpers ──
function boolToSmallint(val) {
  if (val === true || val === 1) return 1;
  if (val === false || val === 0) return 0;
  return val ? 1 : 0;
}

async function queryNeon(sql) {
  const { rows } = await neonPool.query(sql);
  return rows;
}

async function upsertBatch(table, rows, batchSize = 100) {
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows — skipped`);
    return 0;
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: undefined });
    if (error) {
      console.error(`  ${table} batch ${i}–${i + batch.length}: ERROR`, error.message);
      // Try one-by-one for this batch to see which row fails
      for (const row of batch) {
        const { error: singleErr } = await supabase.from(table).upsert(row);
        if (singleErr) {
          console.error(`    Row failed:`, JSON.stringify(row).slice(0, 200), singleErr.message);
        } else {
          inserted++;
        }
      }
    } else {
      inserted += batch.length;
    }
  }
  console.log(`  ${table}: ${inserted}/${rows.length} rows migrated`);
  return inserted;
}

// ── Migration Functions ──

async function migrateConversations() {
  const rows = await queryNeon("SELECT * FROM ai_conversations ORDER BY created_at");
  const mapped = rows.map((r) => ({
    id_conversation: r.id,
    id_workspace: r.workspace_id,
    user_created: r.created_by,
    name_conversation: r.title || "New Conversation",
    type_visibility: r.visibility || "private",
    id_content: r.content_object_id || null,
    id_client: r.customer_id || null,
    name_model: r.model || "claude-sonnet-4-20250514",
    flag_incognito: boolToSmallint(r.is_incognito),
    date_created: r.created_at,
    date_updated: r.updated_at,
  }));
  return upsertBatch("ai_conversations", mapped);
}

async function migrateMessages() {
  const rows = await queryNeon("SELECT * FROM ai_messages ORDER BY created_at");
  const mapped = rows.map((r) => {
    // Neon stored attachments as text (JSON string), Supabase expects jsonb
    let attachments = null;
    if (r.attachments) {
      try {
        attachments = typeof r.attachments === "string" ? JSON.parse(r.attachments) : r.attachments;
      } catch {
        attachments = null;
      }
    }
    return {
      id_message: r.id,
      id_conversation: r.conversation_id,
      role_message: r.role,
      document_message: r.content,
      attachments,
      name_model: r.model || null,
      user_created: r.created_by || null,
      date_created: r.created_at,
    };
  });
  return upsertBatch("ai_messages", mapped);
}

async function migrateShares() {
  const rows = await queryNeon("SELECT * FROM ai_conversation_shares ORDER BY created_at");
  const mapped = rows.map((r) => ({
    id_share: r.id,
    id_conversation: r.conversation_id,
    user_recipient: r.user_id,
    type_permission: r.permission || "view",
    user_shared: r.shared_by,
    date_created: r.created_at,
  }));
  return upsertBatch("ai_shares", mapped);
}

async function migrateRoles() {
  const rows = await queryNeon("SELECT * FROM ai_roles ORDER BY created_at");
  const mapped = rows.map((r) => ({
    id_role: r.id,
    id_workspace: r.workspace_id,
    name_role: r.name,
    information_description: r.description,
    information_instructions: r.instructions,
    name_icon: r.icon || "🤖",
    flag_default: boolToSmallint(r.is_default),
    flag_active: boolToSmallint(r.is_active),
    order_sort: r.sort_order || 0,
    date_created: r.created_at,
    date_updated: r.updated_at,
  }));
  return upsertBatch("ai_roles", mapped);
}

async function migrateMemories() {
  const rows = await queryNeon("SELECT * FROM ai_memories ORDER BY created_at");
  const mapped = rows.map((r) => ({
    id_memory: r.id,
    id_workspace: r.workspace_id,
    user_memory: r.user_id || null,
    type_scope: r.scope || "private",
    type_category: r.category || "fact",
    information_content: r.content,
    id_conversation_source: r.source_conversation_id || null,
    flag_active: boolToSmallint(r.is_active),
    date_created: r.created_at,
    date_updated: r.updated_at,
  }));
  return upsertBatch("ai_memories", mapped);
}

async function migrateUsage() {
  const rows = await queryNeon("SELECT * FROM ai_usage ORDER BY created_at");
  const mapped = rows.map((r) => ({
    id_usage: r.id,
    id_workspace: r.workspace_id,
    user_usage: r.user_id,
    name_model: r.model,
    type_source: r.source,
    units_input: r.input_tokens || 0,
    units_output: r.output_tokens || 0,
    units_cost_tenths: r.cost_tenths || 0,
    id_conversation: r.conversation_id || null,
    date_created: r.created_at,
  }));
  return upsertBatch("ai_usage", mapped);
}

async function migrateUserAccess() {
  const rows = await queryNeon("SELECT * FROM user_access ORDER BY updated_at");
  const mapped = rows.map((r) => ({
    id_access: r.id,
    id_workspace: r.workspace_id,
    user_target: r.user_id,
    flag_access_engine: boolToSmallint(r.access_engine),
    flag_access_enginegpt: boolToSmallint(r.access_enginegpt),
    flag_access_operations: boolToSmallint(r.access_operations),
    flag_access_admin: boolToSmallint(r.access_admin),
    date_updated: r.updated_at,
  }));
  return upsertBatch("users_access", mapped);
}

async function migrateSettings() {
  // AI settings were stored as columns on the workspaces table in Neon
  const rows = await queryNeon(`
    SELECT id, ai_model, ai_context_config, ai_cu_description,
           ai_max_tokens, ai_debug_mode, ai_format_descriptions,
           ai_type_instructions, created_at, updated_at
    FROM workspaces
  `);
  const mapped = rows
    .filter((r) => r.ai_model || r.ai_context_config || r.ai_cu_description) // Only migrate if settings exist
    .map((r) => ({
      id_workspace: r.id,
      name_model: r.ai_model || "claude-sonnet-4-20250514",
      config_context: r.ai_context_config || { contracts: true, contentPipeline: true, socialPresence: true },
      information_cu_description: r.ai_cu_description || null,
      units_max_tokens: r.ai_max_tokens || 4096,
      flag_debug: boolToSmallint(r.ai_debug_mode),
      information_format_descriptions: r.ai_format_descriptions || null,
      information_type_instructions: r.ai_type_instructions || null,
      date_created: r.created_at,
      date_updated: r.updated_at,
    }));
  return upsertBatch("ai_settings", mapped);
}

// ── Main ──
async function main() {
  console.log("=== Neon → Supabase Intelligence Schema Migration ===\n");

  // Test connections
  try {
    const neonTest = await queryNeon("SELECT 1 as ok");
    console.log("Neon connection: OK");
  } catch (e) {
    console.error("Neon connection FAILED:", e.message);
    process.exit(1);
  }

  try {
    const { data, error } = await supabase.from("ai_conversations").select("id_conversation", { count: "exact", head: true });
    if (error) throw error;
    console.log("Supabase intelligence schema connection: OK\n");
  } catch (e) {
    console.error("Supabase connection FAILED:", e.message);
    process.exit(1);
  }

  // Print source row counts
  console.log("Source (Neon) row counts:");
  for (const table of ["ai_conversations", "ai_messages", "ai_shares", "ai_roles", "ai_memories", "ai_usage", "user_access"]) {
    try {
      const [{ count }] = await queryNeon(`SELECT count(*) FROM ${table}`);
      console.log(`  ${table}: ${count}`);
    } catch (e) {
      console.log(`  ${table}: ERROR — ${e.message.slice(0, 60)}`);
    }
  }
  console.log();

  // Migrate in dependency order (conversations first, then messages/shares/etc.)
  console.log("Migrating...");

  // 1. Settings first (no deps)
  await migrateSettings();

  // 2. Conversations (no FK deps in intelligence schema — workspace FK is to public)
  await migrateConversations();

  // 3. Messages (depends on conversations)
  await migrateMessages();

  // 4. Shares (depends on conversations)
  await migrateShares();

  // 5. Roles (no deps)
  await migrateRoles();

  // 6. Memories (depends on conversations via id_conversation_source)
  await migrateMemories();

  // 7. Usage (depends on conversations via id_conversation)
  await migrateUsage();

  // 8. User access (no deps)
  await migrateUserAccess();

  console.log("\n=== Migration complete ===");

  // Verify destination counts
  console.log("\nDestination (Supabase intelligence) row counts:");
  for (const table of ["ai_settings", "ai_conversations", "ai_messages", "ai_shares", "ai_roles", "ai_memories", "ai_usage", "users_access"]) {
    const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
    if (error) {
      console.log(`  ${table}: ERROR — ${error.message}`);
    } else {
      console.log(`  ${table}: ${count}`);
    }
  }

  await neonPool.end();
}

main().catch((e) => {
  console.error("Migration failed:", e);
  neonPool.end();
  process.exit(1);
});
