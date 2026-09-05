/**
 * Review what the reflection pass proposed, and decide.
 *
 * Every derived role lands in intelligence.entity_proposal as `pending` and
 * nothing reaches the graph until a person says so. This is that person's
 * tool. Without it the proposals are invisible and the reflection pass is a
 * write-only feature.
 *
 * IT SHOWS THE EVIDENCE, NOT JUST THE CLAIM. "Head of procurement" with one
 * supporting meeting and the same claim with four are different things, and a
 * queue that hides the difference trains people to bulk-accept — which is the
 * failure mode that makes a review step worse than no review step.
 *
 *   npx tsx scripts/review-entity-proposals.ts               # pending, best-evidenced first
 *   npx tsx scripts/review-entity-proposals.ts --all
 *   npx tsx scripts/review-entity-proposals.ts --confirm=<id>
 *   npx tsx scripts/review-entity-proposals.ts --reject=<id>
 *   npx tsx scripts/review-entity-proposals.ts --confirm-all-surfaced   # asks first
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const arg = (n: string) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1] || "";
const has = (n: string) => process.argv.indexOf(`--${n}`) >= 0;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.log("\n  Missing Supabase credentials.\n"); process.exit(2); }
const intel = createClient(url!, key!, { db: { schema: "intelligence" } });

/**
 * Apply a confirmed proposal to the graph.
 *
 * The ONLY path by which a derived fact becomes a rendered one. It writes
 * role_text and sets flag_confirmed = 1, which is what resolve.ts requires
 * before it will show a role at all — an unconfirmed role is stored and
 * invisible, deliberately.
 */
async function applySetSlot(payload: any): Promise<string | null> {
  if (!payload?.id_edge || payload.field !== "role_text" || typeof payload.value !== "string") {
    return "payload is not a role_text set_slot";
  }
  const { error } = await intel.from("entity_edge")
    .update({ role_text: payload.value, flag_confirmed: 1 })
    .eq("id_edge", payload.id_edge);
  return error ? error.message : null;
}


/**
 * Perform a merge: fold the loser into the keeper.
 *
 * RETARGETED, NEVER DELETED. Aliases, observations and edges are all moved
 * across before the loser is marked merged and pointed at its survivor, because
 * an episode or an observation holding a dangling id_node is worse than a
 * redundant row. entity_node has id_merged_into for exactly this, and the
 * resolver already skips anything marked merged.
 *
 * Order matters: move the evidence first, mark the node last. Interrupted
 * halfway, that leaves a node whose facts have already moved and which is still
 * live — visible and empty. The reverse order would leave facts pointing at a
 * node nothing renders, which is the invisible-fact failure this project has
 * produced three times.
 */
async function applyMerge(payload: any): Promise<string | null> {
  const keep = payload?.keep, loser = payload?.merge;
  if (!keep || !loser || keep === loser) return "merge payload is missing a side";

  const { data: both, error: readErr } = await intel.from("entity_node")
    .select("id_node, type_node, id_client, domain_primary").in("id_node", [keep, loser]);
  if (readErr) return readErr.message;
  if (!both || both.length !== 2) return "one of the two nodes no longer exists";
  const k = (both as any[]).find((n) => n.id_node === keep);
  const l = (both as any[]).find((n) => n.id_node === loser);
  if (k.type_node !== l.type_node) return `refusing to merge a ${l.type_node} into a ${k.type_node}`;
  if (l.id_client && l.id_client !== k.id_client) return "the losing node belongs to a different client";

  // Aliases: onConflict rather than a plain update, since the keeper may
  // already hold the same alias text.
  const { data: aliases } = await intel.from("entity_alias").select("*").eq("id_node", loser);
  for (const a of (aliases || []) as any[]) {
    await intel.from("entity_alias").upsert({
      id_node: keep, alias_text: a.alias_text, type_alias: a.type_alias,
      type_source: a.type_source, count_evidence: a.count_evidence,
      flag_confirmed: a.flag_confirmed, date_last_seen: a.date_last_seen,
    }, { onConflict: "id_node,alias_text,type_alias" });
  }
  await intel.from("entity_alias").delete().eq("id_node", loser);

  await intel.from("entity_observation").update({ id_node: keep }).eq("id_node", loser);
  await intel.from("entity_edge").update({ id_source: keep }).eq("id_source", loser);
  await intel.from("entity_edge").update({ id_target: keep }).eq("id_target", loser);

  // The keeper inherits a domain if it had none — that is usually the whole
  // point, since the Engine-derived org knows the client and the calendar one
  // knows the domain.
  if (!k.domain_primary && l.domain_primary) {
    await intel.from("entity_node").update({ domain_primary: l.domain_primary }).eq("id_node", keep);
  }

  const { error: markErr } = await intel.from("entity_node")
    .update({ type_status: "merged", id_merged_into: keep, date_updated: new Date().toISOString() })
    .eq("id_node", loser);
  return markErr ? markErr.message : null;
}

async function decide(id: string, accept: boolean) {
  const { data: p, error } = await intel.from("entity_proposal")
    .select("id_proposal, type_action, data_payload, type_status").eq("id_proposal", id).maybeSingle();
  if (error || !p) { console.log(`\n  No proposal ${id}\n`); process.exit(1); }
  const row = p as any;
  if (row.type_status !== "pending") { console.log(`\n  Already ${row.type_status}.\n`); process.exit(1); }
  if (accept) {
    const err = row.type_action === "set_slot" ? await applySetSlot(row.data_payload)
      : row.type_action === "merge" ? await applyMerge(row.data_payload)
      : `${row.type_action} proposals cannot be applied yet`;
    if (err) { console.log(`\n  Could not apply: ${err}\n`); process.exit(1); }
  }
  // type_status only. My first version also set `date_decided`, which does not
  // exist on this table — PostgREST answers an unknown column with 42703 and
  // fails the WHOLE statement, so the edge would have been updated while the
  // proposal stayed `pending` for ever. Checked rather than assumed, because
  // an unchecked write that reports success is the single most repeated defect
  // in this codebase.
  const { error: markErr } = await intel.from("entity_proposal")
    .update({ type_status: accept ? "confirmed" : "rejected" })
    .eq("id_proposal", id);
  if (markErr) {
    console.log(`\n  The graph was ${accept ? "updated" : "left alone"}, but the proposal could not be marked: ${markErr.message}`);
    console.log(`  Re-running --confirm on it would apply the same role again, which is harmless, but fix this first.\n`);
    process.exit(1);
  }
  console.log(`\n  ${accept ? "Confirmed and applied" : "Rejected"}: ${id}\n`);
}

async function main() {
  if (arg("confirm")) return decide(arg("confirm"), true);
  if (arg("reject")) return decide(arg("reject"), false);

  const q = intel.from("entity_proposal")
    .select("id_proposal, type_action, data_payload, data_evidence, type_status, date_created")
    .order("date_created", { ascending: false }).limit(400);
  const { data, error } = await (has("all") ? q : q.eq("type_status", "pending"));
  if (error) { console.log(`\n  Query failed: ${error.message}\n`); process.exit(2); }
  const rows = (data || []) as any[];
  if (!rows.length) { console.log("\n  Nothing to review.\n"); return; }

  // Names, so a row reads as a person rather than a uuid.
  // Every node a proposal refers to, whatever shape its payload takes. The
  // first version read only data_payload.id_node, which is a set_slot field, so
  // every merge proposal rendered as "(unknown)" with a role of "undefined" —
  // ten unreadable rows offering to change something they could not name.
  const nodeIds = Array.from(new Set(rows.flatMap((r) => [
    r.data_payload?.id_node, r.data_payload?.keep, r.data_payload?.merge,
  ]).filter(Boolean)));
  const names = new Map<string, string>();
  for (let i = 0; i < nodeIds.length; i += 200) {
    const { data: ns } = await intel.from("entity_node")
      .select("id_node, name_display, email_primary").in("id_node", nodeIds.slice(i, i + 200));
    for (const n of (ns || []) as any[]) names.set(n.id_node, `${n.name_display}${n.email_primary ? ` <${n.email_primary}>` : ""}`);
  }

  // Best-evidenced first: the ones worth a human's attention are the ones
  // several independent meetings agree on.
  rows.sort((a, b) => (b.data_evidence?.distinct_series || 0) - (a.data_evidence?.distinct_series || 0));

  const merges = rows.filter((r) => r.type_action === "merge").length;
  const slots = rows.filter((r) => r.type_action === "set_slot");
  const surfaced = slots.filter((r) => r.data_evidence?.surfaced).length;
  console.log(`\n  ${rows.length} proposal(s): ${merges} merge, ${slots.length} role (${surfaced} meeting the two-series bar)\n`);
  for (const r of rows) {
    const ev = r.data_evidence || {};
    const p = r.data_payload || {};
    const state = r.type_status !== "pending" ? `  [${r.type_status}]` : "";

    if (r.type_action === "merge") {
      // No evidence bar on a merge. "Two independent series agree" is a
      // statement about role claims and means nothing here — printing it beside
      // a merge asserts a confidence that was never measured.
      console.log(`   MERGE  ${names.get(p.keep) || p.keep}${state}`);
      console.log(`     absorb: ${names.get(p.merge) || p.merge}`);
      console.log(`     why   : ${p.reason || "two nodes appear to be one organisation"}${ev.other_domain ? ` (other node has domain ${ev.other_domain})` : ""}`);
    } else if (r.type_action === "set_slot") {
      const bar = ev.surfaced ? "**" : "  ";
      console.log(`${bar} ${names.get(p.id_node) || p.id_node || "(unknown)"}${state}`);
      console.log(`     "${p.value}"   ${ev.distinct_series || 0} distinct series, ${(ev.events || []).length} meeting(s)`);
    } else {
      // Named rather than mangled. An unhandled action should say so.
      console.log(`   ${String(r.type_action).toUpperCase()}  (this tool cannot display or apply this kind yet)${state}`);
      console.log(`     payload: ${JSON.stringify(p).slice(0, 120)}`);
    }
    console.log(`     confirm: npx tsx scripts/review-entity-proposals.ts --confirm=${r.id_proposal}`);
  }
  console.log(`\n  ** = two or more independent series agree. One series is stored but weakly evidenced —`);
  console.log(`     meeting notes carry a measured factual error rate, so a single mention is a lead, not a fact.\n`);
}

main().catch((e) => { console.log(`\n  ERROR: ${e?.message || e}\n`); process.exit(2); });
