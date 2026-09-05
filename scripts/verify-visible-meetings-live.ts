/**
 * What the widening actually did, against live data.
 * `npx tsx scripts/verify-visible-meetings-live.ts`
 *
 * Run AFTER scripts/add-visible-meetings-rpc.sql. It compares the old
 * client-only function with the new visibility-rule one side by side, shows how
 * many meetings the personnel carve-out withholds, and checks the invariant
 * that matters most: no internal address or internal attendee name may appear
 * in a workspace-shared row. Widening WHICH meetings are shared must not
 * quietly widen WHAT is shared about them.
 *
 * Before the migration it prints "NOT DEPLOYED" and stops, which is also the
 * correct answer — EngineAI falls back to the client-only function until then.
 *
 * PRIVACY: counts and classifications only. No titles, summaries or names.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { isPersonnelSensitive } from "../lib/ai/providers";
config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const mb = createClient(url, key, { db: { schema: "meetingbrain" } });
const pub = createClient(url, key);
const INTERNAL = "thecontentengine.com";

async function main() {
  const { data: cl } = await pub.from("app_clients").select("link_website");
  const D = new Set<string>();
  for (const c of (cl || []) as any[]) { if (!c.link_website) continue;
    try { D.add(new globalThis.URL(String(c.link_website).startsWith("http") ? c.link_website : `https://${c.link_website}`).hostname.replace(/^www\./,"").toLowerCase()); } catch {} }
  D.delete(INTERNAL);
  const domains = Array.from(D);
  const since = new Date(); since.setDate(since.getDate() - 90);

  const { data: old } = await mb.rpc("get_client_meetings", {
    p_internal_domain: INTERNAL, p_client_domains: domains, p_since: since.toISOString(), p_limit: 100000 });
  const { data: neu, error } = await mb.rpc("get_visible_meetings", {
    p_internal_domain: INTERNAL, p_client_domains: domains, p_since: since.toISOString(), p_limit: 100000 });
  if (error) { console.log("get_visible_meetings NOT DEPLOYED:", error.message.slice(0,90)); return; }

  const N = (neu as any[]) || [];
  const kinds = new Map<string, number>();
  for (const r of N) kinds.set(r.visibility_reason, (kinds.get(r.visibility_reason) || 0) + 1);
  const withheld = N.filter((r) => !r.is_client_meeting && r.visibility_reason !== "override"
    && isPersonnelSensitive(r.meeting_title, r.summary, r.key_topics, r.next_steps));

  console.log(`window: last 90 days\n`);
  console.log(`get_client_meetings  : ${((old as any[]) || []).length}`);
  console.log(`get_visible_meetings : ${N.length}`);
  for (const [k, n] of Array.from(kinds.entries()).sort((a,b)=>b[1]-a[1])) console.log(`   ${k.padEnd(20)} ${n}`);
  console.log(`\npersonnel carve-out withholds : ${withheld.length}`);
  console.log(`reaches the model             : ${N.length - withheld.length}`);
  // The invariant that matters most.
  const leaked = N.filter((r) => (r.external_attendees || "").toLowerCase().includes(INTERNAL));
  console.log(`\nrows exposing an internal address : ${leaked.length}  ${leaked.length ? "*** LEAK ***" : "(none)"}`);
  const internalWithNames = N.filter((r) => r.visibility_reason === "internal_group" && r.external_attendees);
  console.log(`internal meetings carrying names  : ${internalWithNames.length}  ${internalWithNames.length ? "(expected 0 for purely internal)" : "(none)"}`);
}
main();
