/**
 * Clients, contracts and engagements — from Engine's own records.
 *
 * The graph had people and organisations and no commercial spine at all. It
 * could say "Carol Piot works at gavi.org" and nothing about whether Gavi is a
 * client, what we are contracted to do, or whether that work is live. Chris
 * asked for people, contracts, clients, projects "and the relationship between
 * everything"; this is the half that was missing.
 *
 * NOTHING HERE IS INFERRED. Every fact comes from app_clients and
 * app_contracts, which a person maintains in Engine's own UI and which the
 * whole workspace can already see. So these observations are workspace-visible
 * by right rather than by argument, and a client resolves for a colleague in a
 * team thread — which is where colleagues ask about clients.
 *
 * TWO GAPS IT CLOSES:
 *
 * 1. Only 6 of 176 organisations were linked to a client, because an org was
 *    only created when someone from its domain attended a meeting AND that
 *    domain had been confirmed. A client nobody happened to meet, or whose
 *    domain was never confirmed, was invisible. Engine knows every client;
 *    those become org nodes directly, keyed on id_client.
 *
 * 2. The engagement node type existed in the schema and had zero rows. A
 *    contract is where a pitch ends up, and without it the graph cannot answer
 *    "what are we actually doing for them".
 *
 *   npx tsx scripts/backfill-engagements.ts --dry-run
 *   npx tsx scripts/backfill-engagements.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry-run");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.log("\n  Missing Supabase credentials.\n"); process.exit(2); }
const intel = createClient(url!, key!, { db: { schema: "intelligence" } });
const pub = createClient(url!, key!);

/** Today in the workspace's own zone. A contract that ends today is live today,
 *  and deciding that in UTC gets it wrong for two hours every evening. */
const todayLocal = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" });

/**
 * Where a contract sits, from its own dates.
 *
 * Deliberately derived rather than stored: a stage column would be a second
 * copy of what the dates already say, and it would drift the moment someone
 * edits a date in Engine and nothing re-runs here.
 */
function stageOf(c: { date_start?: string | null; date_end?: string | null; flag_active?: number | null }): string {
  const today = todayLocal();
  const start = (c.date_start || "").slice(0, 10);
  const end = (c.date_end || "").slice(0, 10);
  if (end && end < today) return "closed";
  if (start && start > today) return "won";      // agreed, not yet begun
  if (c.flag_active === 0) return "closed";
  return "live";
}

/** Find-or-create, never upsert: the unique indexes on entity_node are PARTIAL
 *  and PostgREST cannot express a partial predicate in onConflict (42P10). */
async function ensureNode(
  match: Record<string, unknown>,
  payload: Record<string, unknown>
): Promise<string | null> {
  let q = intel.from("entity_node").select("id_node").neq("type_status", "merged");
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v as any);
  const { data: found, error: findErr } = await q.maybeSingle();
  if (findErr) { console.log(`  lookup failed: ${findErr.message}`); return null; }
  if (found) return (found as any).id_node;
  const { data: made, error: insErr } = await intel.from("entity_node").insert(payload).select("id_node").maybeSingle();
  if (insErr) { console.log(`  insert failed: ${insErr.message}`); return null; }
  return made ? (made as any).id_node : null;
}

async function observe(opts: { id_node?: string; id_edge?: string; source: string }) {
  const { data: seen, error: seenErr } = await intel.from("entity_observation")
    .select("id_observation")
    .eq("type_source", "engine_record").eq("id_source_system", opts.source)
    .limit(1);
  // Checked: an unchecked lookup returns null on failure, which reads as "not
  // seen", which duplicates. That exact bug has already been paid for here.
  if (seenErr) { console.log(`  observation lookup failed: ${seenErr.message}`); return; }
  if (seen && seen.length) return;
  await intel.from("entity_observation").insert({
    id_node: opts.id_node || null, id_edge: opts.id_edge || null,
    type_source: "engine_record", id_source_system: opts.source,
    date_observed: new Date().toISOString(),
    // Engine's client and contract records are already visible to the whole
    // workspace in Engine's own UI. Mirroring that here adds no exposure.
    type_visibility: "workspace", id_owner: null,
  });
}

async function main() {
  const { data: ws } = await intel.from("workspaces").select("id").limit(1).maybeSingle();
  const workspaceId = (ws as any)?.id;
  if (!workspaceId) { console.log("  No workspace."); process.exit(2); }
  console.log(`\n${DRY ? "DRY RUN — nothing written" : "WRITING"}\n`);

  const { data: clients, error: cErr } = await pub.from("app_clients").select("id_client, name_client");
  if (cErr) { console.log(`  clients query failed: ${cErr.message}`); process.exit(2); }
  const { data: contracts, error: kErr } = await pub.from("app_contracts")
    .select("id_contract, name_contract, id_client, date_start, date_end, flag_active, units_contract, units_total_completed");
  if (kErr) { console.log(`  contracts query failed: ${kErr.message}`); process.exit(2); }

  const { data: domains } = await intel.from("client_email_domains").select("id_client, domain").eq("flag_confirmed", 1);
  const domainFor = new Map<number, string>();
  for (const d of (domains || []) as any[]) if (!domainFor.has(d.id_client)) domainFor.set(d.id_client, String(d.domain).toLowerCase());

  const stages: Record<string, number> = {};
  for (const k of (contracts || []) as any[]) { const s = stageOf(k); stages[s] = (stages[s] || 0) + 1; }

  console.log(`  clients in Engine:   ${(clients || []).length}`);
  console.log(`  contracts in Engine: ${(contracts || []).length}`);
  console.log(`  stages: ${Object.entries(stages).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}`);
  console.log(`  clients with a confirmed email domain: ${domainFor.size}`);

  if (DRY) {
    const { count: orgsLinked } = await intel.from("entity_node")
      .select("*", { count: "exact", head: true }).eq("type_node", "org").not("id_client", "is", null);
    console.log(`\n  org nodes currently linked to a client: ${orgsLinked}`);
    console.log(`  would create or link: ${(clients || []).length} client orgs, ${(contracts || []).length} engagements`);
    console.log(`\n  Nothing written. Re-run without --dry-run.\n`);
    return;
  }

  // ── client orgs ────────────────────────────────────────────────────────
  // Keyed on id_client, NOT on domain: a client with no confirmed domain must
  // still exist, and matching on a null domain would collide every one of them
  // into a single row.
  const orgByClient = new Map<number, string>();
  let orgsMade = 0;
  for (const c of (clients || []) as any[]) {
    const domain = domainFor.get(c.id_client) || null;
    let id = await ensureNode({ id_workspace: workspaceId, type_node: "org", id_client: c.id_client }, {
      id_workspace: workspaceId, type_node: "org", name_display: c.name_client || `Client ${c.id_client}`,
      id_client: c.id_client, domain_primary: domain,
      // Engine says this is a customer. That is a record, not an inference.
      type_relationship: "client", type_status: "confirmed",
    });
    // A domain-derived org may already exist for the same company; adopt it
    // rather than creating a second node for one organisation.
    if (!id && domain) {
      id = await ensureNode({ id_workspace: workspaceId, type_node: "org", domain_primary: domain }, {
        id_workspace: workspaceId, type_node: "org", name_display: c.name_client, domain_primary: domain,
        id_client: c.id_client, type_relationship: "client", type_status: "confirmed",
      });
    }
    if (!id) continue;
    orgByClient.set(c.id_client, id);
    orgsMade++;
    if (c.name_client) {
      await intel.from("entity_alias").upsert({
        id_node: id, alias_text: c.name_client, type_alias: "display_name",
        type_source: "engine_record", flag_confirmed: 1,
      }, { onConflict: "id_node,alias_text,type_alias" });
    }
    await observe({ id_node: id, source: `client:${c.id_client}` });
  }
  console.log(`  client orgs ensured: ${orgsMade}`);

  // ── engagements ────────────────────────────────────────────────────────
  let made = 0, linked = 0;
  for (const k of (contracts || []) as any[]) {
    const stage = stageOf(k);
    const id = await ensureNode({ id_workspace: workspaceId, type_node: "engagement", id_contract: k.id_contract }, {
      id_workspace: workspaceId, type_node: "engagement",
      name_display: k.name_contract || `Contract ${k.id_contract}`,
      id_engagement_client: k.id_client, id_contract: k.id_contract,
      type_stage: stage, date_stage_changed: (k.date_end || k.date_start || "").slice(0, 10) || null,
      type_status: "confirmed",
    });
    if (!id) continue;
    made++;
    if (k.name_contract) {
      await intel.from("entity_alias").upsert({
        id_node: id, alias_text: k.name_contract, type_alias: "display_name",
        type_source: "engine_record", flag_confirmed: 1,
      }, { onConflict: "id_node,alias_text,type_alias" });
    }
    await observe({ id_node: id, source: `contract:${k.id_contract}` });

    const orgId = orgByClient.get(k.id_client);
    if (!orgId) continue;
    const { data: existing } = await intel.from("entity_edge").select("id_edge")
      .eq("id_source", id).eq("id_target", orgId).eq("type_edge", "engagement_for")
      .is("date_invalidated", null).maybeSingle();
    let edgeId = (existing as any)?.id_edge;
    if (!edgeId) {
      const { data: e } = await intel.from("entity_edge").insert({
        id_source: id, id_target: orgId, type_edge: "engagement_for",
        flag_confirmed: 1, count_evidence: 1,
      }).select("id_edge").maybeSingle();
      edgeId = (e as any)?.id_edge;
    }
    // An edge with no observation is invisible — the mistake that made all 433
    // works_at edges unreachable until it was found.
    if (edgeId) { await observe({ id_edge: edgeId, source: `contract:${k.id_contract}` }); linked++; }
  }
  console.log(`  engagements ensured: ${made}, linked to a client org: ${linked}\n`);
}

main().catch((e) => { console.log(`\n  ERROR: ${e?.message || e}\n`); process.exit(2); });
