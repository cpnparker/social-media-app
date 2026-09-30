/**
 * Propose client email domains from meeting evidence.
 * `npx tsx scripts/propose-client-domains.ts`
 *
 * Finds meetings whose TITLE names a client, then ranks the external attendee
 * domains that appear in them. Prints reviewable INSERT statements — it writes
 * nothing itself.
 *
 * EVERY PROPOSAL IS UNCONFIRMED, and that is not caution for its own sake. The
 * token "zurich" matches Zurich Instruments, ETH Zurich AND Zurich Insurance,
 * and the top inferred domain for the first two is zurich.com — which belongs
 * to the third. Auto-applying that would file one client's confidential
 * meetings under another client's account team. So this proposes; a person
 * confirms.
 *
 * The output names competing candidates and flags token collisions explicitly,
 * so confirming is a judgement made with the reasoning in view.
 *
 * PRIVACY: domains and counts only. No meeting titles, no attendee names, no
 * addresses.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const pub = createClient(SUPABASE_URL, SERVICE_KEY);
const mb = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "meetingbrain" } });

/** Ours. Never a client domain. Mirrors INTERNAL_DOMAINS in providers.ts. */
const INTERNAL = new Set(["thecontentengine.com", "authorityon.ai", "zdigitalagency.com"]);
/** Partners who attend client meetings with us. Their domain co-occurs with
 *  real client work constantly, so inference proposes them against unrelated
 *  accounts. Mirrors the entries in NON_CLIENT_HOSTS. */
const PARTNERS = new Set(["tcdigitalmarketing.ch"]);
const FREE = new Set([
  "gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com",
  "me.com", "aol.com", "proton.me", "protonmail.com", "live.com",
]);

/**
 * Words too generic to identify a company by.
 *
 * "energy", "instruments", "bank" and the legal suffixes match dozens of
 * unrelated meetings. Without this the proposals are noise; with it, a client
 * whose name is ENTIRELY stop-words gets no proposal at all, which is the
 * correct outcome rather than a bad guess.
 */
const STOP = new Set([
  "the", "and", "group", "ag", "sa", "ltd", "limited", "gmbh", "inc", "plc",
  "holding", "holdings", "international", "global", "energy", "instruments",
  "university", "bank", "insurance", "test", "client", "digital", "media",
]);

const MIN_EVIDENCE = 2;   // a single co-occurrence is coincidence, not evidence

function tokens(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/)
    .filter((t) => t.length >= 4 && !STOP.has(t));
}

function normaliseDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const s = String(raw).trim();
    return new globalThis.URL(s.startsWith("http") ? s : `https://${s}`)
      .hostname.replace(/^www\./, "").toLowerCase();
  } catch { return null; }
}

async function main() {
  const { data: cl } = await pub.from("app_clients").select("id_client, name_client, link_website, flag_active");
  // ids 1 and 2 are TCE's own work, not customers. id 2 even carries
  // thecontentengine.com as its "website", which is how a naive domain match
  // ends up classifying every internal meeting as client work.
  const INTERNAL_CLIENT_IDS = new Set([1, 2]);
  const clients = ((cl || []) as any[])
    .filter((c) => c.name_client && !INTERNAL_CLIENT_IDS.has(c.id_client));

  // Which tokens are ambiguous ACROSS clients? This is the whole safety story:
  // "zurich" belongs to three different companies here.
  const tokenOwners = new Map<string, number[]>();
  for (const c of clients) {
    for (const t of tokens(c.name_client)) {
      tokenOwners.set(t, [...(tokenOwners.get(t) || []), c.id_client]);
    }
  }

  let from = 0, pm: any[] = [];
  for (;;) {
    const { data } = await mb.from("processed_meeting").select("meeting_title, attendees").range(from, from + 999);
    pm = pm.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  const prepared = pm.map((r) => {
    const text = typeof r.attendees === "string" ? r.attendees : JSON.stringify(r.attendees ?? "");
    const doms: string[] = Array.from(new Set<string>(
      (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])
        .map((e: string) => e.split("@")[1].toLowerCase())
        .filter((d: string) => !INTERNAL.has(d) && !FREE.has(d) && !PARTNERS.has(d))
    ));
    return { title: String(r.meeting_title || "").toLowerCase(), doms };
  });

  console.log(`clients: ${clients.length}   meetings: ${pm.length}\n`);

  const inserts: string[] = [];
  let proposed = 0, skippedAmbiguous = 0, skippedNoToken = 0, alreadyRegistered = 0;

  for (const c of clients) {
    const known = normaliseDomain(c.link_website);
    const toks = tokens(c.name_client);
    if (!toks.length) { skippedNoToken++; continue; }

    const ambiguous = toks.filter((t) => new Set(tokenOwners.get(t) || []).size > 1);
    const counts = new Map<string, number>();
    let titleHits = 0;
    for (const m of prepared) {
      if (!toks.some((t) => m.title.includes(t))) continue;
      titleHits++;
      for (const d of m.doms) counts.set(d, (counts.get(d) || 0) + 1);
    }
    const ranked = Array.from(counts.entries())
      .filter(([, n]) => n >= MIN_EVIDENCE)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    if (!ranked.length) continue;

    // A domain the website already gives us is not news.
    const fresh = ranked.filter(([d]) => d !== known);
    if (!fresh.length) { alreadyRegistered++; continue; }

    const warn: string[] = [];
    if (ambiguous.length) {
      warn.push(`token(s) ${ambiguous.join(", ")} are shared with ${
        Array.from(new Set(ambiguous.flatMap((t) => tokenOwners.get(t) || []))).length - 1
      } other client(s) — these proposals may belong to one of them`);
      skippedAmbiguous++;
    }
    if (known) warn.push(`registered website resolves to ${known}`);

    proposed++;
    console.log(`${c.name_client}  (id ${c.id_client})${ambiguous.length ? "   ⚠ AMBIGUOUS" : ""}`);
    console.log(`  tokens matched : ${toks.join(", ")}   (${titleHits} meeting titles)`);
    console.log(`  registered     : ${known ?? "(no website)"}`);
    console.log(`  candidates     : ${fresh.map(([d, n]) => `${d} ×${n}`).join(", ")}`);
    if (warn.length) for (const w of warn) console.log(`  ⚠ ${w}`);
    console.log();

    for (const [d, n] of fresh) {
      const note = warn.length ? warn.join("; ").replace(/'/g, "''") : null;
      inserts.push(
        `INSERT INTO intelligence.client_email_domains (id_client, domain, type_source, count_evidence, information_note)\n` +
        `  VALUES (${c.id_client}, '${d}', 'inferred', ${n}, ${note ? `'${note}'` : "NULL"})\n` +
        `  ON CONFLICT (id_client, domain) DO NOTHING;   -- ${c.name_client}`
      );
    }
  }

  console.log("─".repeat(72));
  console.log(`${proposed} client(s) with proposals · ${skippedAmbiguous} carry an ambiguous token`);
  console.log(`${alreadyRegistered} already covered by their website · ${skippedNoToken} have no distinctive token`);
  console.log(`\nEvery row below inserts UNCONFIRMED (flag_confirmed defaults to 0) and is`);
  console.log(`ignored by the join until you set it. Review the ⚠ lines first — an`);
  console.log(`ambiguous token means a domain may belong to a DIFFERENT client, and`);
  console.log(`confirming it would file their meetings under this account.\n`);
  console.log(inserts.join("\n\n"));
  console.log(`\n-- Then, for each row you accept:`);
  console.log(`-- UPDATE intelligence.client_email_domains`);
  console.log(`--    SET flag_confirmed = 1, date_confirmed = now()`);
  console.log(`--  WHERE id_client = <id> AND domain = '<domain>';`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
