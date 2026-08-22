/**
 * Verify meetingbrain.get_meeting_visibility after the migration.
 * `npx tsx scripts/verify-meeting-visibility.ts`
 *
 * Three questions, in order of how badly a wrong answer would hurt:
 *
 *  1. Does the deployed function agree with the model that justified it?
 *     scripts/model-meeting-visibility-rule.ts computed the rule in TypeScript
 *     and its numbers are what the decision was made on. If the SQL disagrees,
 *     one of them is wrong and the spec is describing neither. This is the
 *     check that matters: a per-event diff, not a total, because two different
 *     classifications can sum to the same count.
 *
 *  2. Can the public anon key read or write the override table? That table
 *     decides who may see a meeting; if a browser can write it, anyone can
 *     share anyone's 1:1.
 *
 *  3. Does the function leak meeting content? It exists to classify, and it
 *     should be impossible to get a title or a transcript out of it.
 *
 * The anon probes here are meaningful by construction: the override table has
 * NO foreign key, so a rejected insert cannot be blamed on a constraint the
 * way the episodes probe could. The probe row also uses a key nothing else
 * holds, so the primary key cannot produce a false pass either.
 *
 * PRIVACY: counts, ids and classifications only. No titles, summaries,
 * attendees or addresses are printed.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { isPersonnelSensitive } from "../lib/ai/providers";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const mb = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "meetingbrain" } });
const mbAnon = ANON_KEY ? createClient(SUPABASE_URL, ANON_KEY, { db: { schema: "meetingbrain" } }) : null;
const pub = createClient(SUPABASE_URL, SERVICE_KEY);

const INTERNAL_DOMAIN = "thecontentengine.com";
// See the note in model-meeting-visibility-rule.ts: no free-mail carve-out.
// The deployed SQL treats any non-internal, non-client domain as external, and
// that is the fail-safe reading.
const PROBE_KEY = "__rls-probe-never-a-real-event__";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function clientDomains(): Promise<string[]> {
  const { data } = await pub.from("app_clients").select("link_website");
  const out = new Set<string>();
  for (const c of data || []) {
    const w = (c as any).link_website;
    if (!w) continue;
    try {
      out.add(new globalThis.URL(String(w).startsWith("http") ? w : `https://${w}`).hostname.replace(/^www\./, "").toLowerCase());
    } catch { /* a malformed website is not a domain */ }
  }
  // The caller's own domain IS registered as a client website (id_client 2).
  // Leaving it in classifies every internal meeting as client work.
  out.delete(INTERNAL_DOMAIN);
  if (!out.size) throw new Error("No client domains resolved — refusing to verify, every number would be wrong.");
  return Array.from(out);
}

async function main() {
  const domains = await clientDomains();
  const domainSet = new Set(domains);
  console.log(`\nclient domains: ${domains.length} (internal domain excluded)`);

  // ── 1. The function exists and runs ──
  console.log("\n1. The function is deployed");
  const { data: vis, error: visErr } = await mb.rpc("get_meeting_visibility", {
    p_internal_domain: INTERNAL_DOMAIN,
    p_client_domains: domains,
  });
  check("get_meeting_visibility is callable", !visErr, visErr ? `${visErr.code}: ${visErr.message}` : undefined);
  if (visErr) {
    console.log("\n  Cannot continue — has scripts/add-meeting-visibility.sql been run?");
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  const rows = (vis as any[]) || [];
  console.log(`   returned ${rows.length} events`);

  const dist = new Map<string, number>();
  for (const r of rows) dist.set(r.reason, (dist.get(r.reason) || 0) + 1);
  console.log("   distribution:");
  for (const [k, n] of Array.from(dist.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${k.padEnd(22)} ${String(n).padStart(5)}`);
  }
  const team = rows.filter((r) => r.visibility === "team").length;
  console.log(`   team ${team} / private ${rows.length - team}`);
  check(
    "team count is in the expected range, not thousands more",
    team > 0 && team < rows.length * 0.4,
    `${team} of ${rows.length} — if this is far higher, the client-domain list probably includes ${INTERNAL_DOMAIN}`
  );

  // ── 2. SQL agrees with the TypeScript model, per event ──
  console.log("\n2. The deployed rule agrees with the model it was decided on");
  let from = 0, pmRows: any[] = [];
  for (;;) {
    const { data } = await mb.from("processed_meeting").select("calendar_event_id, attendees").range(from, from + 999);
    pmRows = pmRows.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  const byEvent = new Map<string, Set<string>>();
  for (const r of pmRows as any[]) {
    if (!r.calendar_event_id) continue;
    const text = typeof r.attendees === "string" ? r.attendees : JSON.stringify(r.attendees ?? "");
    const em = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map((e: string) => e.toLowerCase());
    const s = byEvent.get(r.calendar_event_id) || new Set<string>();
    for (const a of em) s.add(a);
    byEvent.set(r.calendar_event_id, s);
  }
  /** The same rule, in TypeScript. Must match the SQL for every event. */
  function expected(em: Set<string>): string {
    if (em.size === 0) return "no_attendee_data";
    const doms = new Set(Array.from(em).map((a) => a.split("@")[1]));
    if (Array.from(doms).some((d) => domainSet.has(d))) return "client_attendee";
    if (Array.from(doms).some((d) => d !== INTERNAL_DOMAIN && !domainSet.has(d))) return "external_non_client";
    return em.size >= 3 ? "internal_group" : "internal_small";
  }
  let disagree = 0;
  const samples: string[] = [];
  for (const r of rows) {
    if (r.is_overridden) continue; // an override is meant to disagree
    const em = byEvent.get(r.calendar_event_id);
    if (!em) continue;
    const exp = expected(em);
    if (exp !== r.reason) {
      disagree++;
      // Ids only — a calendar event id is not meeting content.
      if (samples.length < 5) samples.push(`${r.calendar_event_id}: sql=${r.reason} ts=${exp} n=${r.attendee_count}`);
    }
  }
  check("SQL and TypeScript classify every event identically", disagree === 0, `${disagree} disagreements${samples.length ? `\n      ` + samples.join("\n      ") : ""}`);
  check("every event in the corpus is classified", rows.length === byEvent.size, `${rows.length} classified vs ${byEvent.size} events`);

  // ── 3. The personnel carve-out on top ──
  console.log("\n3. The personnel carve-out (applied by EngineAI, not the SQL)");
  const titleByEvent = new Map<string, boolean>();
  let from2 = 0, meta: any[] = [];
  for (;;) {
    const { data } = await mb.from("processed_meeting")
      .select("calendar_event_id, meeting_title, summary, key_topics").range(from2, from2 + 999);
    meta = meta.concat(data || []);
    if (!data || data.length < 1000) break;
    from2 += 1000;
  }
  for (const r of meta as any[]) {
    if (!r.calendar_event_id) continue;
    if (isPersonnelSensitive(r.meeting_title, r.summary, r.key_topics)) titleByEvent.set(r.calendar_event_id, true);
  }
  const heldBack = rows.filter((r) => r.reason === "internal_group" && titleByEvent.get(r.calendar_event_id)).length;
  console.log(`   internal_group events flagged personnel: ${heldBack}`);
  check("the carve-out holds back some but not most internal group meetings",
    heldBack > 0 && heldBack < (dist.get("internal_group") || 0) * 0.5,
    `${heldBack} of ${dist.get("internal_group")}`);

  // ── 4. RLS on the override table ──
  console.log("\n4. Anon-key lockout on the override table");
  await mb.from("meeting_visibility_override").delete().eq("calendar_event_id", PROBE_KEY);
  const { error: seedErr } = await mb.from("meeting_visibility_override")
    .insert({ calendar_event_id: PROBE_KEY, visibility: "team", reason: "rls probe", set_by: 0 });
  check("service role can write an override", !seedErr, seedErr?.message);

  if (!mbAnon) {
    check("anon key present to test with", false, "NEXT_PUBLIC_SUPABASE_ANON_KEY not set locally");
  } else {
    const { data: aRows, error: aErr } = await mbAnon
      .from("meeting_visibility_override").select("calendar_event_id").eq("calendar_event_id", PROBE_KEY);
    check("anon cannot read an override row that DEMONSTRABLY EXISTS",
      !!aErr || (aRows?.length ?? 0) === 0,
      aErr ? `blocked with ${aErr.code}` : `RETURNED ${aRows?.length} ROW(S)`);

    // No FK on this table and a key nothing else holds, so only RLS or grants
    // can reject this — unlike the episodes probe, which the FK was rejecting.
    const { error: aWriteErr } = await mbAnon.from("meeting_visibility_override")
      .insert({ calendar_event_id: PROBE_KEY + "-anon", visibility: "team", reason: "rls probe", set_by: 0 });
    check("anon cannot write an override",
      !!aWriteErr,
      aWriteErr ? `blocked with ${aWriteErr.code}` : "INSERT SUCCEEDED — anyone could share anyone's meeting");
    if (aWriteErr && /23503|23505/.test(aWriteErr.code || "")) {
      check("the write was blocked by RLS/grants, not a constraint", false, `got ${aWriteErr.code}`);
    }

    const { data: fnRows, error: fnErr } = await mbAnon.rpc("get_meeting_visibility", {
      p_internal_domain: INTERNAL_DOMAIN, p_client_domains: domains,
    });
    check("anon cannot call the classification function either",
      !!fnErr || ((fnRows as any[])?.length ?? 0) === 0,
      fnErr ? `blocked with ${fnErr.code}` : `RETURNED ${(fnRows as any[])?.length} ROW(S)`);
  }

  // ── 5. Overrides actually win ──
  console.log("\n5. An override changes the answer");
  const target = rows.find((r) => r.reason === "internal_small" && !r.is_overridden);
  if (!target) {
    check("a private event exists to override", false, "none found");
  } else {
    await mb.from("meeting_visibility_override").insert({
      calendar_event_id: target.calendar_event_id, visibility: "team", reason: "rls probe", set_by: 0,
    });
    const { data: after } = await mb.rpc("get_meeting_visibility", {
      p_internal_domain: INTERNAL_DOMAIN, p_client_domains: domains,
    });
    const now = ((after as any[]) || []).find((r) => r.calendar_event_id === target.calendar_event_id);
    check("an override flips a private meeting to team and is labelled",
      now?.visibility === "team" && now?.reason === "override" && now?.is_overridden === true,
      JSON.stringify(now));
    await mb.from("meeting_visibility_override").delete().eq("calendar_event_id", target.calendar_event_id);
  }

  // ── 6. No content escapes ──
  console.log("\n6. The function returns no meeting content");
  const cols = Object.keys(rows[0] || {});
  const allowed = ["calendar_event_id", "visibility", "reason", "attendee_count", "has_client", "is_overridden"];
  check("only classification fields are returned", cols.every((c) => allowed.includes(c)), cols.join(", "));
  check("no title, summary, transcript or attendee field",
    !cols.some((c) => /title|summary|transcript|attendee(?!_count)|insight|topic|note/i.test(c)), cols.join(", "));

  // Cleanup
  await mb.from("meeting_visibility_override").delete().eq("reason", "rls probe");
  const { count: leftover } = await mb.from("meeting_visibility_override").select("*", { count: "exact", head: true });
  console.log(`\n  cleanup: ${leftover ?? 0} override row(s) remain (0 expected on a fresh install)`);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("\nFAILED:", e.message); process.exit(1); });
