/**
 * Models the DECIDED visibility rule against the live corpus.
 * `npx tsx scripts/model-meeting-visibility-rule.ts`
 *
 * The rule (docs/meetingbrain-meeting-visibility-spec.md, decided 17 Aug 2026):
 *   client attendee, any size            -> team   (client beats 1:1)
 *   internal 3+                          -> team
 *   internal 3+ AND personnel-flagged    -> private (personnel beats team)
 *   internal 1-2                         -> private
 *   vendor / other external              -> private
 *   no attendee data                     -> private
 *
 * Run this BEFORE pointing get_client_meetings at the rule. It is the only
 * thing that shows how much the company can suddenly read: 140 meetings are
 * shared today and the rule makes it ~1,257. That number should be a decision,
 * not a surprise.
 *
 * Collapses to ONE ENTRY PER CALENDAR EVENT, unioning attendees across
 * recorders — 20% of events have more than one, and judging each row
 * separately would classify the same meeting two different ways.
 *
 * PRIVACY: counts only. Never prints a title, summary, attendee or address.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { isPersonnelSensitive } from "../lib/ai/providers";
config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const mb = createClient(url, key, { db: { schema: "meetingbrain" } });
const pub = createClient(url, key);
const INTERNAL = "thecontentengine.com";
// NO free-mail carve-out, deliberately, and this cost a disagreement to
// learn. An earlier version treated a gmail/outlook attendee as "not really
// external", so an internal meeting with someone dialling in on a personal
// address stayed team-visible. The deployed SQL has no such exclusion, and it
// is right: a personal address on an otherwise-internal meeting is just as
// likely a candidate, a freelancer or a private contact. Wrongly private costs
// a colleague one request; wrongly team publishes an interview. 144 events
// turned on this.

async function main() {
  const { data: cl } = await pub.from("app_clients").select("link_website");
  const clientDomains = new Set<string>();
  for (const c of (cl || []) as any[]) {
    if (!c.link_website) continue;
    try { clientDomains.add(new globalThis.URL(String(c.link_website).startsWith("http") ? c.link_website : `https://${c.link_website}`).hostname.replace(/^www\./,"").toLowerCase()); } catch {}
  }
  clientDomains.delete(INTERNAL);

  let from = 0, rows: any[] = [];
  for (;;) {
    const { data } = await mb.from("processed_meeting")
      .select("calendar_event_id, attendees, meeting_title, summary, key_topics").range(from, from + 999);
    rows = rows.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  const ev = new Map<string, {em:Set<string>; sensitive:boolean}>();
  for (const r of rows) {
    if (!r.calendar_event_id) continue;
    const text = typeof r.attendees === "string" ? r.attendees : JSON.stringify(r.attendees ?? "");
    const em = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map((e: string) => e.toLowerCase());
    const e = ev.get(r.calendar_event_id) || {em:new Set<string>(), sensitive:false};
    for (const a of em) e.em.add(a);
    if (isPersonnelSensitive(r.meeting_title, r.summary, r.key_topics)) e.sensitive = true;
    ev.set(r.calendar_event_id, e);
  }

  let openClient=0, openTeam=0, heldPersonnel=0, privOneToOne=0, privNoData=0, privVendor=0;
  let sensitiveAnywhere=0;
  for (const e of Array.from(ev.values())) {
    if (e.sensitive) sensitiveAnywhere++;
    if (e.em.size === 0) { privNoData++; continue; }
    const doms = new Set(Array.from(e.em).map((a: string) => a.split("@")[1]));
    const hasClient = Array.from(doms).some(d => clientDomains.has(d));
    const otherExt = Array.from(doms).some(d => d !== INTERNAL && !clientDomains.has(d));
    if (hasClient) { openClient++; continue; }              // client wins, incl. 1:1
    if (otherExt) { privVendor++; continue; }
    if (e.em.size <= 2) { privOneToOne++; continue; }
    if (e.sensitive) { heldPersonnel++; continue; }         // internal 3+, personnel-flagged
    openTeam++;
  }
  const total = ev.size, open = openClient + openTeam;
  console.log(`distinct calendar events: ${total}\n`);
  console.log("DECIDED RULE:");
  console.log(`  OPEN  client (any size)        : ${openClient}`);
  console.log(`  OPEN  internal team 3+         : ${openTeam}`);
  console.log(`  held  internal 3+, personnel   : ${heldPersonnel}   ← the exception`);
  console.log(`  PRIV  internal 1:1 / solo      : ${privOneToOne}`);
  console.log(`  PRIV  vendor / other external  : ${privVendor}`);
  console.log(`  PRIV  no attendee data         : ${privNoData}`);
  console.log(`\n  TOTAL OPEN : ${open}  (${Math.round(open/total*100)}%)`);
  console.log(`  TOTAL PRIV : ${total-open}  (${Math.round((total-open)/total*100)}%)`);
  console.log(`\n  personnel screen trips on ${sensitiveAnywhere} events overall (${Math.round(sensitiveAnywhere/total*100)}% of corpus)`);
  console.log(`  of which it CHANGES the outcome for ${heldPersonnel} (the rest were private anyway)`);
}
main();
