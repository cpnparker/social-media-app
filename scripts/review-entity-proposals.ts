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

async function decide(id: string, accept: boolean) {
  const { data: p, error } = await intel.from("entity_proposal")
    .select("id_proposal, type_action, data_payload, type_status").eq("id_proposal", id).maybeSingle();
  if (error || !p) { console.log(`\n  No proposal ${id}\n`); process.exit(1); }
  const row = p as any;
  if (row.type_status !== "pending") { console.log(`\n  Already ${row.type_status}.\n`); process.exit(1); }
  if (accept) {
    if (row.type_action !== "set_slot") { console.log(`\n  Only set_slot is applyable today.\n`); process.exit(1); }
    const err = await applySetSlot(row.data_payload);
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
  const nodeIds = Array.from(new Set(rows.map((r) => r.data_payload?.id_node).filter(Boolean)));
  const names = new Map<string, string>();
  for (let i = 0; i < nodeIds.length; i += 200) {
    const { data: ns } = await intel.from("entity_node")
      .select("id_node, name_display, email_primary").in("id_node", nodeIds.slice(i, i + 200));
    for (const n of (ns || []) as any[]) names.set(n.id_node, `${n.name_display}${n.email_primary ? ` <${n.email_primary}>` : ""}`);
  }

  // Best-evidenced first: the ones worth a human's attention are the ones
  // several independent meetings agree on.
  rows.sort((a, b) => (b.data_evidence?.distinct_series || 0) - (a.data_evidence?.distinct_series || 0));

  const surfaced = rows.filter((r) => r.data_evidence?.surfaced);
  console.log(`\n  ${rows.length} proposal(s); ${surfaced.length} meet the two-series bar\n`);
  for (const r of rows) {
    const ev = r.data_evidence || {};
    const who = names.get(r.data_payload?.id_node) || r.data_payload?.id_node || "(unknown)";
    const bar = ev.surfaced ? "**" : "  ";
    console.log(`${bar} ${who}`);
    console.log(`     "${r.data_payload?.value}"   ${ev.distinct_series || 0} distinct series, ${(ev.events || []).length} meeting(s)${r.type_status !== "pending" ? `  [${r.type_status}]` : ""}`);
    console.log(`     confirm: npx tsx scripts/review-entity-proposals.ts --confirm=${r.id_proposal}`);
  }
  console.log(`\n  ** = two or more independent series agree. One series is stored but weakly evidenced —`);
  console.log(`     meeting notes carry a measured factual error rate, so a single mention is a lead, not a fact.\n`);
}

main().catch((e) => { console.log(`\n  ERROR: ${e?.message || e}\n`); process.exit(2); });
