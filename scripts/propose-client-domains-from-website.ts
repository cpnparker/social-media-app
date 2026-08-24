/**
 * Client email domains, from the website you already recorded — cross-checked
 * against the domains that actually appear in your meetings.
 *
 * WHY NOT THE EXISTING PROPOSER. propose-client-domains.ts matches tokens from
 * the client's NAME against meeting titles, and on this corpus that produces
 * mostly noise: zurich.com proposed to five different clients with the identical
 * evidence count of 7 — the same seven meetings attributed five ways, of which
 * at most one can be right. IPU offered beonemed.com, esmo.org, gustaveroussy.fr
 * and omv.com, matched on the word "union". UNDRR offered office-consultant.ch,
 * matched on "office". The script flags all of this honestly, which is to its
 * credit, but a proposal queue that is mostly wrong trains people to stop
 * reading it.
 *
 * And the answer was already printed, as a warning: "registered website resolves
 * to undrr.org". app_clients.link_website is maintained by a person, and a
 * company's website domain is usually its email domain. That is a RECORD where
 * the token match was an inference.
 *
 * THE CROSS-CHECK IS THE POINT. A website domain alone can still be wrong —
 * BeOne's site is beonemedicines.com while its people write from beonemed.com.
 * So each candidate is tested against the domains genuinely seen in
 * processed_meeting attendees. Agreement between two INDEPENDENT sources — a
 * record someone maintains and addresses observed in the wild — is worth far
 * more than either alone, and it is the only corroboration in this system that
 * a mistaken guess cannot manufacture for itself.
 *
 *   npx tsx scripts/propose-client-domains-from-website.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.log("\n  Missing Supabase credentials.\n"); process.exit(2); }
const intel = createClient(url!, key!, { db: { schema: "intelligence" } });
const pub = createClient(url!, key!);
const mb = createClient(url!, key!, { db: { schema: "meetingbrain" } });

/** Never a client's email domain, whatever a website field says. */
const INTERNAL = ["thecontentengine.com", "authorityon.ai", "zdigitalagency.com"];
const NEVER = new Set([
  ...INTERNAL,
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
  "google.com", "sites.google.com", "wixsite.com", "squarespace.com",
  "linkedin.com", "facebook.com", "x.com", "twitter.com",
]);

/**
 * A website URL reduced to the domain people would send mail from.
 *
 * Subdomains are dropped to the registrable domain: cybathlon.ethz.ch is a
 * project site, and its people write from ethz.ch. Two-part public suffixes
 * (.co.uk, .org.uk, .com.sg) are handled, because taking the last two labels
 * there would produce "co.uk" and match every British company at once.
 */
export function emailDomainFromWebsite(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host = String(raw).trim().toLowerCase();
  host = host.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split("/")[0].split("?")[0].split("#")[0];
  if (!host || host.indexOf(".") < 0 || /\s/.test(host)) return null;
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  const SECOND_LEVEL = new Set(["co", "org", "net", "ac", "gov", "com", "edu"]);
  let keep = 2;
  if (parts.length >= 3 && SECOND_LEVEL.has(parts[parts.length - 2])) keep = 3;
  const domain = parts.slice(-keep).join(".");
  return NEVER.has(domain) ? null : domain;
}

async function main() {
  const { data: clients, error: cErr } = await pub.from("app_clients").select("id_client, name_client, link_website");
  if (cErr) { console.log(`  clients query failed: ${cErr.message}`); process.exit(2); }

  const { data: existing } = await intel.from("client_email_domains").select("id_client, domain, flag_confirmed");
  const confirmed = new Set((existing || []).map((r: any) => `${r.id_client}|${String(r.domain).toLowerCase()}`).filter((_, i) => (existing as any[])[i].flag_confirmed === 1));
  const known = new Set((existing || []).map((r: any) => `${r.id_client}|${String(r.domain).toLowerCase()}`));

  // Every domain that genuinely appears as a meeting attendee, with a count.
  // This is the independent half of the cross-check.
  process.stdout.write("  reading attendee domains");
  const seen = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await mb.from("processed_meeting")
      .select("attendees").like("attendees", "[%").range(from, from + 999);
    if (error) { console.log(`\n  attendee query failed: ${error.message}`); process.exit(2); }
    const rows = (data || []) as any[];
    if (!rows.length) break;
    for (const r of rows) {
      let list: any[] = [];
      try { list = JSON.parse(r.attendees); } catch { continue; }
      for (const a of list) {
        const d = String(a?.email || "").toLowerCase().split("@")[1];
        if (d && !NEVER.has(d)) seen.set(d, (seen.get(d) || 0) + 1);
      }
    }
    process.stdout.write(".");
    if (rows.length < 1000) break;
  }
  console.log(` ${seen.size} distinct domains`);

  const corroborated: { id: number; name: string; domain: string; hits: number }[] = [];
  const websiteOnly: { id: number; name: string; domain: string }[] = [];
  const noWebsite: string[] = [];

  for (const c of (clients || []) as any[]) {
    const domain = emailDomainFromWebsite(c.link_website);
    if (!domain) { noWebsite.push(c.name_client || `client ${c.id_client}`); continue; }
    if (confirmed.has(`${c.id_client}|${domain}`)) continue;
    const hits = seen.get(domain) || 0;
    if (hits > 0) corroborated.push({ id: c.id_client, name: c.name_client, domain, hits });
    else websiteOnly.push({ id: c.id_client, name: c.name_client, domain });
  }

  console.log(`\n  ${corroborated.length} client(s) whose registered website domain ALSO appears in your meetings`);
  console.log(`  ${websiteOnly.length} with a website domain but no attendee ever seen from it`);
  console.log(`  ${noWebsite.length} with no usable website recorded\n`);

  // ── One domain, several client records ────────────────────────────────
  //
  // A domain confirmed for two clients attributes to NEITHER: loadConfirmedClientDomains
  // deletes it outright, because "guessing which one is how a meeting lands on
  // the wrong account". Engine holds several records per organisation — three
  // Marsh entities, three UBS, three ETH, two World Bank, and Gavi alongside
  // IFFIm which it hosts — so confirming the obvious domain for each would
  // silently leave all of them with no mapping whatever, which is worse than
  // leaving them alone.
  //
  // The lowest id_client wins: it is the original record, and it is right for
  // Marsh (19 over Marsh Cyber), UBS (39, the bank itself), Zurich (35, the
  // insurer) and Gavi (9, which hosts IFFIm rather than being it). It is a
  // heuristic, so the losers are printed rather than hidden — if the parent
  // account is not the oldest one, say so and it can be changed by hand.
  const byDomain = new Map<string, { id: number; name: string; domain: string; hits: number }[]>();
  for (const r of corroborated) {
    const l = byDomain.get(r.domain) || [];
    l.push(r);
    byDomain.set(r.domain, l);
  }
  const canonical: typeof corroborated = [];
  const shared: { domain: string; winner: string; others: string[] }[] = [];
  for (const [domain, rows] of Array.from(byDomain.entries())) {
    if (rows.length === 1) { canonical.push(rows[0]); continue; }
    rows.sort((a, b) => a.id - b.id);
    canonical.push(rows[0]);
    shared.push({
      domain,
      winner: `${rows[0].name} (id ${rows[0].id})`,
      others: rows.slice(1).map((r) => `${r.name} (id ${r.id})`),
    });
  }

  if (shared.length) {
    console.log("── SHARED DOMAINS — one organisation, several client records ──\n");
    for (const s of shared) {
      console.log(`  ${s.domain}`);
      console.log(`     attributing to : ${s.winner}`);
      console.log(`     also claimed by: ${s.others.join(", ")}`);
    }
    console.log(`
  Confirming a domain for more than one client makes it attribute to NEITHER —
  loadConfirmedClientDomains deletes any domain claimed twice, deliberately,
  because guessing puts a meeting on the wrong account. So only the first row
  above is emitted for each. If the account named is not the right parent,
  change the id by hand before running the SQL.
`);
  }

  if (canonical.length) {
    console.log("── CORROBORATED — a record you maintain and addresses seen in the wild agree ──\n");
    canonical.sort((a, b) => b.hits - a.hits);
    const corroborated = canonical;
    for (const r of corroborated) {
      console.log(`  ${r.name}  (id ${r.id})`);
      console.log(`     ${r.domain}   seen on ${r.hits} meeting attendee record(s)${known.has(`${r.id}|${r.domain}`) ? "   [already proposed, unconfirmed]" : ""}`);
    }
    console.log(`
  These are the ones worth confirming in bulk. Two independent sources agree:
  a website a person maintains in Engine, and addresses that actually turned up
  in meetings. Neither can manufacture the other.
`);
    console.log("INSERT INTO intelligence.client_email_domains (id_client, domain, type_source, count_evidence, information_note, flag_confirmed, date_confirmed)");
    console.log("VALUES");
    // 'manual', not 'website'. client_email_domains constrains type_source to
    // ('manual','inferred','alias_migration') — a CHECK violation fails the
    // WHOLE multi-row INSERT, so a value invented here would have inserted
    // nothing at all while looking like a careful bulk write.
    //
    // 'manual' is also the honest label: the domain comes from a field a person
    // maintains in Engine, and nothing here is confirmed without a person
    // reading it first. The derivation is recorded in information_note, which
    // is where the detail belongs.
    console.log(corroborated.map((r) =>
      `  (${r.id}, '${r.domain}', 'manual', ${r.hits}, 'registered website domain, corroborated by ${r.hits} attendee record(s)', 1, now())`
    ).join(",\n"));
    console.log("ON CONFLICT (id_client, domain) DO UPDATE SET flag_confirmed = 1, date_confirmed = now();\n");
  }

  if (websiteOnly.length) {
    console.log("── WEBSITE ONLY — plausible, but nobody from this domain has ever been in a meeting ──\n");
    for (const r of websiteOnly.slice(0, 40)) console.log(`  ${r.name}  (id ${r.id})  →  ${r.domain}`);
    if (websiteOnly.length > 40) console.log(`  … and ${websiteOnly.length - 40} more`);
    console.log(`
  Left UNCONFIRMED deliberately. A website domain is usually the email domain
  and sometimes is not — BeOne's site is beonemedicines.com while its people
  write from beonemed.com. With no attendee ever seen from these, there is
  nothing to check them against, so confirming them would be trusting one
  source twice.
`);
  }
}

main().catch((e) => { console.log(`\n  ERROR: ${e?.message || e}\n`); process.exit(2); });
