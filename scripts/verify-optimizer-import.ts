/**
 * The optimiser's import path, checked by making it fail.
 *
 * Two things here can go wrong silently, which is why they get a script rather
 * than a code review:
 *
 *   1. `extractDocId` is what stops a pasted URL from becoming an arbitrary
 *      fetch. Its host check is an ALLOWLIST on the parsed hostname, and the
 *      classic way to break it is to relax it into a substring test — at which
 *      point "docs.google.com.evil.test" passes and nothing anywhere goes red.
 *   2. The set of import sources is written down in three places: the client's
 *      tab→source map, the route's accept list, and the migration's CHECK
 *      constraint. A source added to two of the three fails at INSERT time, in
 *      production, on the one path nobody tested.
 *
 *   npx tsx scripts/verify-optimizer-import.ts
 *
 * MUTATION LOG — every entry was run in a throwaway git worktree, never the
 * shared tree (`vercel deploy --prod` uploads the working directory, so a
 * deliberate break left in it can ship).
 *
 *   2026-08-21  host allowlist → hostname.includes("google.com") → 1 fail  ✓
 *   2026-08-21  the 200-text/html sign-in branch removed        → 1 fail   ✓
 *   2026-08-21  'gdoc-link' dropped from the migration CHECK    → 1 fail   ✓
 *   2026-08-21  export URL built from caller input, not the id  → 1 fail   ✓
 *   2026-08-21  BOM strip removed                    → SURVIVED, see below
 *   (baseline, unmutated: exit 0)
 *
 * The survivor is recorded because the survival IS the finding. Deleting the
 * BOM strip in doc-link.ts changed nothing, because `Response.text()` is a
 * UTF-8 decode and a UTF-8 decode already removes a leading BOM — the guard is
 * unreachable through this path and no fixture can make it fire. Section 3
 * therefore asserts the property (imported text starts at a real character)
 * rather than that line, and asserts the fixture carried a BOM to begin with.
 * A check written the other way round would have passed forever while proving
 * nothing, which is the failure this repo keeps finding in its own tests.
 *
 * NO NETWORK. Every response here is fabricated locally; a check that needs
 * Drive to be reachable is a check that goes red for reasons unrelated to the
 * code and gets ignored within a week.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { extractDocId, fetchDocText } from "../lib/gdrive/doc-link";

const ROOT = join(__dirname, "..");
let failures = 0;
const pass = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };

const ID = "1kcDFls2sV3-OuVwWNEHOR4TrE96RC1MEaVJ7-dotGmY";

// ── 1. Link parsing ──────────────────────────────────────────────────────
console.log(`\n1. extractDocId accepts the real shapes`);
{
  const accepted: [string, string][] = [
    [`https://docs.google.com/document/d/${ID}/edit`, "the ordinary edit link"],
    [`https://docs.google.com/document/d/${ID}/edit?tab=t.0#heading=h.abc`, "with a tab and a fragment"],
    [`https://docs.google.com/document/u/0/d/${ID}/edit`, "the multi-account /u/0/ form"],
    [`https://drive.google.com/open?id=${ID}`, "the drive.google.com ?id= form"],
    [`  https://docs.google.com/document/d/${ID}/edit  `, "surrounding whitespace"],
    [ID, "a bare id"],
  ];
  for (let i = 0; i < accepted.length; i++) {
    const [input, why] = accepted[i];
    const got = extractDocId(input);
    got === ID ? pass(why) : fail(`${why} → ${got === null ? "null" : got}, expected the id`);
  }
}

console.log(`\n2. extractDocId refuses everything else`);
{
  // Each entry names the trap it sets. The two marked LOOKALIKE are the ones a
  // substring host check would let through, and they are the reason this
  // section exists at all.
  const rejected: [string, string][] = [
    [`https://docs.google.com.evil.test/document/d/${ID}/edit`, "LOOKALIKE: a suffixed host"],
    [`https://evil.test/docs.google.com/document/d/${ID}/edit`, "LOOKALIKE: the host in the path"],
    [`https://evil.test/document/d/${ID}/edit`, "an unrelated host"],
    ["http://169.254.169.254/latest/meta-data/", "the cloud metadata address"],
    ["http://localhost:3000/api/optimizer/sessions", "a loopback URL"],
    ["file:///etc/passwd", "a file: URL"],
    ["https://docs.google.com/document/d/short/edit", "an id too short to be one"],
    ["https://docs.google.com/spreadsheets/", "a Google URL with no id in it"],
    ["not a url at all", "free text"],
    ["", "the empty string"],
  ];

  // Assert the FIXTURE first. If the lookalike entries were ever softened into
  // ordinary bad hosts, every assertion below would still pass while testing
  // nothing — which is exactly how a check reports a hole as closed.
  let lookalikes = 0;
  for (let i = 0; i < rejected.length; i++) {
    if (rejected[i][0].indexOf("docs.google.com") >= 0 && rejected[i][1].indexOf("LOOKALIKE") === 0) lookalikes++;
  }
  lookalikes >= 2
    ? pass(`${lookalikes} fixtures contain the literal string "docs.google.com" on a non-Google host`)
    : fail("no lookalike fixture — a substring host check would pass this whole section");

  for (let i = 0; i < rejected.length; i++) {
    const [input, why] = rejected[i];
    const got = extractDocId(input);
    got === null ? pass(why) : fail(`${why} → returned "${got}" instead of null`);
  }
}

// ── 3. Fetching ──────────────────────────────────────────────────────────
// Wrapped in a function: tsx transforms these scripts to CJS, where top-level
// await is a build error rather than a runtime one — the script would not run
// at all, which reads as a broken check rather than a broken import path.
async function fetchChecks() {
console.log(`\n3. fetchDocText`);

/** A fetch that returns exactly one canned response, then records the call. */
function stubFetch(status: number, contentType: string, body: string) {
  const calls: string[] = [];
  const fn = (async (url: any) => {
    calls.push(String(url));
    return new Response(body, { status, headers: { "content-type": contentType } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

{
  const ok = stubFetch(200, "text/plain; charset=utf-8", "Headline\n\nBody text here.");
  const r = await fetchDocText(ID, 40000, ok.fn);
  r.ok && r.text === "Headline\n\nBody text here."
    ? pass("a plain-text export is returned verbatim")
    : fail(`plain text → ok=${r.ok} text=${JSON.stringify((r.text || "").slice(0, 40))}`);

  // The URL is built here, not taken from the caller. Assert it, because the
  // whole SSRF argument for this file rests on it.
  ok.calls.length === 1 && ok.calls[0] === `https://docs.google.com/document/d/${ID}/export?format=txt`
    ? pass("fetches a hardcoded docs.google.com URL built from the id")
    : fail(`fetched ${JSON.stringify(ok.calls)}`);
}

{
  // Google returns the sign-in interstitial as 200 text/html. Accepting it
  // would import a login page as an article and score it — a failure that
  // looks like success, which is the worst kind this feature can have.
  const html = "<!doctype html><html><head><title>Sign in - Google Accounts</title></head><body>…</body></html>";
  const signin = stubFetch(200, "text/html; charset=utf-8", html);
  const r = await fetchDocText(ID, 40000, signin.fn);
  if (r.ok) {
    fail(`a 200 text/html sign-in page was imported as the document (${(r.text || "").length} chars of HTML)`);
  } else if (!r.permission) {
    fail("the sign-in page was rejected, but not as a permission problem — the user gets the wrong advice");
  } else {
    pass("a 200 text/html sign-in page is refused as a permission problem, not imported");
  }
  // Precondition: the fixture must actually be HTML with a 200, or this proves
  // nothing about the content-type branch.
  html.indexOf("<!doctype html") === 0
    ? pass("the sign-in fixture really is an HTML body served with status 200")
    : fail("the sign-in fixture is not HTML — the content-type branch was never reached");
}

{
  const denied = stubFetch(403, "application/json", `{"error":"forbidden"}`);
  const r = await fetchDocText(ID, 40000, denied.fn);
  !r.ok && r.permission
    ? pass("403 is reported as a permission problem")
    : fail(`403 → ok=${r.ok} permission=${r.permission}`);
}

{
  // A UTF-8 BOM at offset 0 would sit in the editor as an invisible first
  // character and shift every highlight anchor by one. What this asserts is the
  // PROPERTY — imported text begins with a real character — not the line in
  // doc-link.ts that strips it.
  //
  // The distinction is not pedantry. Removing that strip was run as a mutation
  // and SURVIVED, because `Response.text()` is specified as a UTF-8 decode and
  // a UTF-8 decode already removes a leading BOM. The guard in doc-link.ts is
  // therefore unreachable through this path, and no fixture can make it fire:
  // a check written to prove that line works would be a check that cannot fail.
  // So this proves the property, and the assertion below proves the fixture
  // really did carry a BOM before the decode — otherwise even the property is
  // being asserted over nothing.
  const withBom = "\uFEFFHeadline\n\nBody.";
  withBom.charCodeAt(0) === 0xfeff
    ? pass("the BOM fixture really does start with U+FEFF before it is decoded")
    : fail("the BOM fixture has no BOM in it — this section proves nothing");

  const bom = stubFetch(200, "text/plain", withBom);
  const r = await fetchDocText(ID, 40000, bom.fn);
  r.ok && (r.text || "").charCodeAt(0) !== 0xfeff && (r.text || "").indexOf("Headline") === 0
    ? pass("imported text starts at a real character, so anchor offset 0 is not off by one")
    : fail(`imported text starts with char code ${(r.text || "").charCodeAt(0)} — every anchor offset is shifted`);
}

{
  const big = stubFetch(200, "text/plain", "x".repeat(41000));
  const r = await fetchDocText(ID, 40000, big.fn);
  !r.ok && !r.permission && (r.error || "").indexOf("41k") >= 0
    ? pass("an over-long document is refused, and the message says how long it is")
    : fail(`over-long → ok=${r.ok} error=${JSON.stringify(r.error)}`);
}

}

// ── 4. The source vocabulary agrees across all three files ───────────────
function sourceChecks() {
console.log(`\n4. Import sources agree between client, route and migration`);
{
  const routeSrc = readFileSync(join(ROOT, "app/api/optimizer/import/route.ts"), "utf8");
  const sqlSrc = readFileSync(join(ROOT, "supabase/migrations/20260821_content_optimizer.sql"), "utf8");
  const uiSrc = readFileSync(join(ROOT, "components/optimizer/StartScreen.tsx"), "utf8");

  const routeMatch = routeSrc.match(/if \(\[([^\]]*)\]\.indexOf\(source\) < 0\)/);
  const sqlMatch = sqlSrc.match(/CHECK \(type_source IN \(([^)]*)\)\)/);
  const uiMatch = uiSrc.match(/type ImportSource = ([^;]*);/);

  if (!routeMatch || !sqlMatch || !uiMatch) {
    fail(
      `could not locate the source lists (route=${!!routeMatch} sql=${!!sqlMatch} ui=${!!uiMatch}) — ` +
        `this check is reading files by shape, so a refactor silently disables it`
    );
  } else {
    const parse = (s: string) => {
      const out: string[] = [];
      const m = s.match(/["'][^"']+["']/g) || [];
      for (let i = 0; i < m.length; i++) out.push(m[i].slice(1, -1));
      out.sort();
      return out;
    };
    const route = parse(routeMatch[1]);
    const ui = parse(uiMatch[1]);
    // The migration's list also carries 'generated', which no import produces —
    // a generated piece is not imported at all. Everything the ROUTE accepts
    // must be in it; the reverse is not required.
    const sql = parse(sqlMatch[1]);

    route.length >= 3
      ? pass(`route accepts ${route.length} sources: ${route.join(", ")}`)
      : fail(`only ${route.length} source(s) parsed from the route — the regex is probably matching the wrong thing`);

    let missingInSql: string[] = [];
    for (let i = 0; i < route.length; i++) if (sql.indexOf(route[i]) < 0) missingInSql.push(route[i]);
    missingInSql.length === 0
      ? pass(`every source the route accepts is allowed by the migration's CHECK`)
      : fail(
          `the route accepts ${missingInSql.join(", ")} but the CHECK constraint does not — ` +
            `importing that way fails at INSERT, in production, with a constraint violation`
        );

    let missingInRoute: string[] = [];
    for (let i = 0; i < ui.length; i++) if (route.indexOf(ui[i]) < 0) missingInRoute.push(ui[i]);
    missingInRoute.length === 0
      ? pass(`every source the client can send is accepted by the route`)
      : fail(`the client can send ${missingInRoute.join(", ")}, which the route rejects with 400`);
  }
}

}

fetchChecks()
  .then(() => {
    sourceChecks();
    console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
    process.exit(failures ? 1 : 0);
  })
  .catch((e) => {
    // A thrown error here means the script did not finish, which is NOT the
    // same as passing. Say so loudly and exit non-zero.
    console.error(`\nverify-optimizer-import CRASHED before finishing: ${e?.message || e}\n`);
    process.exit(1);
  });
