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

/**
 * Is this contract name distinctive enough to be a searchable alias?
 *
 * Contract names are often generic — "Retainer", "Content", "Phase 2". Making
 * every one an alias means the word "retainer" in an ordinary sentence
 * resolves to a finished 2024 engagement, and 212 of 237 contracts here are
 * closed, so most of that noise would be about work that ended.
 *
 * A multi-word name is almost always specific to the client ("Amrize content
 * retainer"). A single common word almost never is. Engagements remain
 * reachable through their client either way — the alias is a convenience, not
 * the route.
 */
const GENERIC_CONTRACT_WORDS = new Set([
  "retainer","content","social","contract","agreement","project","phase",
  "support","services","package","plan","pilot","trial","extension","renewal",
  "annual","monthly","quarterly","misc","other","general","standard",
]);
function aliasableContractName(name: string | null | undefined): string | null {
  const t = (name || "").trim();
  if (t.length < 4) return null;
  const words = t.split(/\s+/);
  if (words.length === 1 && GENERIC_CONTRACT_WORDS.has(t.toLowerCase())) return null;
  return t;
}

/**
 * Is there already an organisation node that looks like this client?
 *
 * THE SPLIT THIS PREVENTS. Orgs arrive from two directions: from calendar
 * attendees, keyed on domain, and from Engine's client list, keyed on
 * id_client. They only merge when the client's email domain is confirmed — and
 * only 5 of 92 clients have one. Without this check the other 87 each get a
 * SECOND node: the Engine one carrying contracts and no people, the calendar
 * one carrying people and no contracts. One company, two rows, and every
 * question about it answered from whichever half the resolver reached first.
 *
 * It returns a CANDIDATE, never a merge. Name matching is exactly the thing
 * this codebase already learned not to trust automatically — "zurich" matches
 * Zurich Instruments, ETH Zurich and Zurich Insurance, and the top inferred
 * domain for two of them belonged to the third. So a match becomes a proposal
 * a person accepts, and a non-match costs nothing.
 */
async function findOrgByName(workspaceId: string, name: string): Promise<{ id: string; domain: string | null } | null> {
  const { data, error } = await intel
    .from("entity_alias")
    .select("id_node, entity_node!inner(id_node, id_workspace, type_node, id_client, domain_primary, type_status)")
    .ilike("alias_text", name)
    .limit(5);
  if (error) return null;
  for (const r of (data || []) as any[]) {
    const n = r.entity_node;
    if (!n || n.id_workspace !== workspaceId || n.type_node !== "org") continue;
    if (n.type_status === "merged" || n.type_status === "rejected") continue;
    if (n.id_client) continue;               // already a client org; not a duplicate
    return { id: n.id_node, domain: n.domain_primary || null };
  }
  return null;
}

/** Find-or-create, never upsert: the unique indexes on entity_node are PARTIAL
 *  and PostgREST cannot express a partial predicate in onConflict (42P10). */
async function ensureNode(
  match: Record<string, unknown>,
  payload: Record<string, unknown>
): Promise<string | null> {
  // NOT maybeSingle(). It raises PGRST116 — "multiple (or no) rows returned" —
  // the moment two rows match, and two rows matching is exactly the state this
  // function exists to find and heal. The lookup that hunts for duplicates was
  // the one thing that broke on them.
  //
  // Oldest first, so a re-run keeps choosing the same node instead of
  // alternating between twins and doubling the edges hanging off each.
  let q = intel.from("entity_node").select("id_node").neq("type_status", "merged");
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v as any);
  const { data: found, error: findErr } = await q.order("date_created", { ascending: true }).limit(1);
  if (findErr) { console.log(`  lookup failed: ${findErr.message}`); return null; }
  if (found && found.length) return (found as any[])[0].id_node;
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
    const named = (contracts || []).filter((k: any) => aliasableContractName(k.name_contract)).length;
    console.log(`  would create or link: ${(clients || []).length} client orgs, ${(contracts || []).length} engagements`);
    console.log(`  of those, ${named} contract names are distinctive enough to be searchable`);
    console.log(`  (${(contracts || []).length - named} generic names skipped — they would match ordinary words)`);
    const undomained = (clients || []).filter((c: any) => !domainFor.get(c.id_client)).length;
    if (undomained) {
      console.log(`\n  WARNING: ${undomained} of ${(clients || []).length} clients have no confirmed email domain.`);
      console.log(`  Each may create a SECOND org node beside one already built from calendar`);
      console.log(`  attendees — the same company split in two, contracts on one and people on`);
      console.log(`  the other. Merge proposals are written where a name matches, but confirming`);
      console.log(`  domains first (npx tsx scripts/propose-client-domains.ts) avoids the split.`);
    }
    console.log(`\n  Nothing written. Re-run without --dry-run.\n`);
    return;
  }

  // ── client orgs ────────────────────────────────────────────────────────
  // Keyed on id_client, NOT on domain: a client with no confirmed domain must
  // still exist, and matching on a null domain would collide every one of them
  // into a single row.
  const orgByClient = new Map<number, string>();
  let orgsMade = 0, duplicates = 0;
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

    // No confirmed domain means this client org could not adopt an existing
    // domain-derived node, so there may now be two rows for one organisation.
    // Propose the merge rather than performing it: a wrong split is recoverable
    // and a wrong merge is not.
    if (!domain && c.name_client) {
      const twin = await findOrgByName(workspaceId, c.name_client);
      if (twin && twin.id !== id) {
        // Don't re-propose the same merge on a second run.
        const { data: already } = await intel.from("entity_proposal")
          .select("id_proposal").eq("type_action", "merge").eq("type_status", "pending")
          .eq("id_workspace", workspaceId).contains("data_payload", { keep: id, merge: twin.id }).limit(1);
        if (already && already.length) continue;
        await intel.from("entity_proposal").insert({
          id_workspace: workspaceId, type_action: "merge",
          data_payload: { keep: id, merge: twin.id, reason: "same organisation from Engine and from calendar" },
          data_evidence: { client_name: c.name_client, other_domain: twin.domain, surfaced: true },
          type_status: "pending",
        });
        duplicates++;
      }
    }
    if (c.name_client) {
      await intel.from("entity_alias").upsert({
        id_node: id, alias_text: c.name_client, type_alias: "display_name",
        type_source: "engine_record", flag_confirmed: 1,
      }, { onConflict: "id_node,alias_text,type_alias" });
    }
    await observe({ id_node: id, source: `client:${c.id_client}` });
  }
  console.log(`  client orgs ensured: ${orgsMade}`);
  if (duplicates) {
    console.log(`  ${duplicates} possible duplicate org(s) — merge proposals written for review.`);
    console.log(`  Confirming these clients' email domains first would have avoided them entirely.`);
  }

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
    const aliasName = aliasableContractName(k.name_contract);
    if (aliasName) {
      await intel.from("entity_alias").upsert({
        id_node: id, alias_text: aliasName, type_alias: "display_name",
        type_source: "engine_record", flag_confirmed: 1,
      }, { onConflict: "id_node,alias_text,type_alias" });
    }
    await observe({ id_node: id, source: `contract:${k.id_contract}` });

    const orgId = orgByClient.get(k.id_client);
    if (!orgId) continue;
    // Same reason: a duplicate edge from an earlier run would make maybeSingle
    // throw rather than let this reuse one.
    const { data: existing } = await intel.from("entity_edge").select("id_edge")
      .eq("id_source", id).eq("id_target", orgId).eq("type_edge", "engagement_for")
      .is("date_invalidated", null).limit(1);
    let edgeId = (existing as any[])?.[0]?.id_edge;
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
