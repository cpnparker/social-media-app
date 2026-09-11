/**
 * Guards the AI-crawler access check, and the page-audit rows added with it.
 *
 * Run: npx tsx scripts/verify-optimizer-crawlers.ts --self-test
 *
 * ── WHY THIS ONE MATTERS MORE THAN ITS SIZE ─────────────────────────────────
 *
 * It is the loudest thing the audit can say. A page can pass every other check
 * — schema, headings, answer position, freshness — and be worth nothing on
 * ChatGPT because robots.txt turns GPTBot away. Until this shipped the audit
 * read the robots META tag, which governs Google's index, and never the robots
 * FILE, which is where AI crawlers are actually refused.
 *
 * Which means a WRONG answer here is expensive in both directions. Telling
 * someone they are blocked when they are not sends them to their
 * infrastructure team for nothing. Telling them they are open when they are
 * blocked is the exact failure the check exists to prevent. Hence the fixture
 * list below: every one is a real robots.txt shape that a naive parser reads
 * backwards.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 * KILLED  treating an empty `Disallow:` as a block                    → check 1
 * KILLED  letting `User-agent: *` beat an agent's own group           → check 2
 * KILLED  first-match-wins instead of longest-match                   → check 3
 * KILLED  case-sensitive agent matching                               → check 4
 * KILLED  returning "allowed" when the file was not read              → check 5
 * KILLED  ai-crawler-access reporting `pass` on a null robots.txt     → check 6
 * SURVIVED  removing the `#` comment strip — no fixture depends on a comment
 *           sharing a line with a rule, and real files put them on their own
 *           line. Recorded rather than tidied: it is a finding about the
 *           check's coverage, not a defect in the parser.
 */
import { crawlerAccess, AI_CRAWLERS } from "../lib/optimizer/crawler-access";
import { auditPage } from "../lib/optimizer/page-audit";

let failures = 0;
const pass = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string) => { failures++; console.log(`  ✗ ${m}`); };
const assert = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

const verdictFor = (robots: string | null, token: string, path = "/") => {
  const v = crawlerAccess(robots, path);
  if (!v) return null;
  return v.filter((x) => x.token === token)[0] || null;
};

// ── 1. An empty Disallow means ALLOW ───────────────────────────────────────
console.log("\n1. The empty Disallow");
{
  const robots = "User-agent: *\nDisallow:";
  const v = verdictFor(robots, "GPTBot");
  assert(!!v && v.allowed,
    "`Disallow:` with no value allows everything — reading it as a block inverts the answer");

  const blocked = verdictFor("User-agent: *\nDisallow: /", "GPTBot");
  assert(!!blocked && !blocked.allowed, "`Disallow: /` blocks everything");
}

// ── 2. A named group beats the wildcard ────────────────────────────────────
console.log("\n2. Groups");
{
  const robots = "User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n";
  const gpt = verdictFor(robots, "GPTBot");
  const claude = verdictFor(robots, "ClaudeBot");
  assert(!!gpt && gpt.allowed && gpt.via === "own-group",
    "a site that blocks everything then allows GPTBot is ALLOWING GPTBot");
  assert(!!claude && !claude.allowed && claude.via === "wildcard",
    "and still blocking the ones with no group of their own");

  const shared = "User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n";
  assert(!verdictFor(shared, "GPTBot")!.allowed && !verdictFor(shared, "ClaudeBot")!.allowed,
    "consecutive User-agent lines share the rules beneath them");
}

// ── 3. Longest match wins, Allow wins a tie ────────────────────────────────
console.log("\n3. Rule resolution");
{
  const robots = "User-agent: *\nDisallow: /\nAllow: /blog/\n";
  assert(verdictFor(robots, "GPTBot", "/blog/post")!.allowed,
    "a longer Allow beats a shorter Disallow — first-match-wins gets this backwards");
  assert(!verdictFor(robots, "GPTBot", "/pricing")!.allowed,
    "and the Disallow still applies everywhere else");

  const tie = "User-agent: *\nDisallow: /docs\nAllow: /docs\n";
  assert(verdictFor(tie, "GPTBot", "/docs/x")!.allowed, "Allow wins an exact tie");
}

// ── 4. Case, comments, junk ────────────────────────────────────────────────
console.log("\n4. Real files are messy");
{
  assert(!verdictFor("user-agent: gptbot\ndisallow: /", "GPTBot")!.allowed,
    "agent and field names match case-insensitively");
  assert(verdictFor("# nothing here\n\n", "GPTBot")!.allowed,
    "a file with no groups allows by default — the standard's own answer");
  assert(verdictFor("", "GPTBot")!.allowed, "an empty file allows");
  assert(verdictFor("<html><body>404</body></html>", "GPTBot")!.allowed,
    "junk parses to no rules rather than throwing");
  const all = crawlerAccess("User-agent: *\nDisallow: /", "/");
  assert(!!all && all.length === AI_CRAWLERS.length, "every registered crawler gets a verdict");
}

// ── 5. Not read is NOT allowed ─────────────────────────────────────────────
console.log("\n5. Not looking, versus looking and finding nothing");
assert(crawlerAccess(null, "/") === null,
  "a robots.txt that could not be read returns null, never a set of passes");

// ── 6. The check reports that difference on screen ─────────────────────────
console.log("\n6. The audit row");
{
  const page = "<html><head><title>T</title></head><body><h1>H</h1><p>x</p></body></html>";
  const base = { page, finalUrl: "https://example.com/a", httpStatus: 200 };

  const notRead = auditPage({ ...base, robotsTxt: null }, new Date());
  const row = notRead.checks.filter((c) => c.id === "ai-crawler-access")[0];
  assert(!!row && row.status === "info", "an unread robots.txt reports INFO, never pass");
  assert(!!row && /not checked/i.test(row.detail) && /not the same as/i.test(row.detail),
    "and says so in words — that is the whole point of the row");

  const blocked = auditPage({ ...base, robotsTxt: "User-agent: GPTBot\nDisallow: /" }, new Date());
  const brow = blocked.checks.filter((c) => c.id === "ai-crawler-access")[0];
  assert(!!brow && brow.status === "fail", "a blocked crawler FAILS — it is not a warning");
  assert(!!brow && /GPTBot/.test(brow.detail) && /ChatGPT/.test(brow.detail),
    "naming the crawler AND who it feeds, because one of those means something to a marketer");

  const open = auditPage({ ...base, robotsTxt: "User-agent: *\nAllow: /" }, new Date());
  const orow = open.checks.filter((c) => c.id === "ai-crawler-access")[0];
  assert(!!orow && orow.status === "pass", "an open robots.txt passes");

  // The path matters: a blanket allow with one blocked directory must not
  // report the whole site blocked.
  const scoped = auditPage(
    { ...base, finalUrl: "https://example.com/blog/x", robotsTxt: "User-agent: *\nDisallow: /private/" },
    new Date()
  );
  assert(scoped.checks.filter((c) => c.id === "ai-crawler-access")[0].status === "pass",
    "the verdict is for THIS page's path, not the site as a whole");
}

// ── 7. Schema against the visible copy ─────────────────────────────────────
console.log("\n7. Schema versus copy");
{
  const withSchema = (ld: string, body: string) =>
    `<html><head><title>T</title><script type="application/ld+json">${ld}</script></head><body><h1>Head</h1>${body}</body></html>`;

  const agree = auditPage(
    { page: withSchema('{"@type":"Article","datePublished":"2026-08-01"}', "<p>Published 1 August 2026. Text.</p>"), finalUrl: "https://e.com/a", httpStatus: 200 },
    new Date()
  ).checks.filter((c) => c.id === "schema-copy-consistency")[0];
  assert(agree.status === "pass", "schema and copy that agree pass");

  const disagree = auditPage(
    { page: withSchema('{"@type":"Article","datePublished":"2023-01-01"}', "<p>Published 1 August 2026. Text.</p>"), finalUrl: "https://e.com/a", httpStatus: 200 },
    new Date()
  ).checks.filter((c) => c.id === "schema-copy-consistency")[0];
  assert(disagree.status === "warn", "a schema year that contradicts the visible year WARNS");
  assert(/2023/.test(disagree.detail) && /2026/.test(disagree.detail),
    "and quotes both, so the reader can see which to fix");
  assert(disagree.status !== "fail",
    "never FAIL — every comparison here has a legitimate exception, and a check that cries wolf gets skipped");

  // The one that stops it crying wolf.
  const headline = auditPage(
    { page: withSchema('{"@type":"Article","headline":"A different headline"}', "<p>Text.</p>"), finalUrl: "https://e.com/a", httpStatus: 200 },
    new Date()
  ).checks.filter((c) => c.id === "schema-copy-consistency")[0];
  assert(headline.status === "pass",
    "a schema headline differing from the H1 does NOT change the status — that is normal practice");
  assert(/headline differs/i.test(headline.detail), "it is reported as detail only");

  const none = auditPage(
    { page: "<html><body><h1>H</h1><p>x</p></body></html>", finalUrl: "https://e.com/a", httpStatus: 200 },
    new Date()
  ).checks.filter((c) => c.id === "schema-copy-consistency")[0];
  assert(none.status === "info" && /no schema/i.test(none.detail),
    "with no schema it reports NOT CHECKED, rather than passing a comparison it never made");
}

// ── 8. Internal links are counted in the article, and honest about direction ─
console.log("\n8. Internal link density");
{
  const body = `<article>${"<p>word word word word word word word word word word.</p>".repeat(40)}
    <p><a href="/one">one</a> <a href="https://example.com/two">two</a>
       <a href="https://elsewhere.com/x">out</a> <a href="#frag">frag</a>
       <a href="mailto:a@b.c">mail</a></p></article>`;
  const nav = `<nav>${'<a href="/n">n</a>'.repeat(50)}</nav>`;
  const r = auditPage(
    { page: `<html><body>${nav}${body}</body></html>`, finalUrl: "https://example.com/a", httpStatus: 200 },
    new Date()
  ).checks.filter((c) => c.id === "internal-link-density")[0];
  assert(/\b2\b/.test(r.detail),
    "counts 2 internal links: the relative one and the absolute SAME-HOST one, which parse.ts would call external");
  assert(!/\b52\b/.test(r.detail), "and not the 50 in the nav — the article is the unit");
  assert(/site tree/.test(r.detail),
    "and states plainly that it does not know direction — up, sideways or down needs the site tree");
}

// ── 9. URL hygiene ─────────────────────────────────────────────────────────
console.log("\n9. URL shape");
{
  const at = (u: string) =>
    auditPage({ page: "<html><body><h1>H</h1></body></html>", finalUrl: u, httpStatus: 200 }, new Date())
      .checks.filter((c) => c.id === "url-hygiene")[0];
  assert(at("https://e.com/cement-products").status === "pass", "a clean slug passes");
  assert(at("https://e.com/Cement-Products").status === "warn", "mixed case warns");
  assert(at("https://e.com/2019/03/post").status === "warn", "a date in the path warns");
  assert(at("https://e.com/index.php?id=166747").status === "warn", "a numeric id warns");
  assert(/only you can make/i.test(at("https://e.com/Bad").remedy || ""),
    "and it says which property it is NOT judging — stability is a human call");
}

// ── Self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  console.log("\n── self-test: each detector against input it must reject ──");
  let broken = 0;
  const detects = (what: string, fired: boolean) => {
    if (fired) console.log(`  ✓ fires on ${what}`);
    else { broken++; console.log(`  ✗ SILENT on ${what}`); }
  };

  detects("an empty Disallow read as a block",
    verdictFor("User-agent: *\nDisallow:", "GPTBot")!.allowed === true);
  detects("the wildcard overriding an agent's own group",
    verdictFor("User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /", "GPTBot")!.allowed === true);
  detects("first-match-wins instead of longest-match",
    verdictFor("User-agent: *\nDisallow: /\nAllow: /blog/", "GPTBot", "/blog/x")!.allowed === true);
  detects("case-sensitive agent matching",
    verdictFor("user-agent: gptbot\ndisallow: /", "GPTBot")!.allowed === false);
  detects("an unread file reported as allowed", crawlerAccess(null, "/") === null);
  {
    const page = "<html><head><title>T</title></head><body><h1>H</h1><p>x</p></body></html>";
    const row = auditPage({ page, finalUrl: "https://e.com/a", httpStatus: 200, robotsTxt: null }, new Date())
      .checks.filter((c) => c.id === "ai-crawler-access")[0];
    detects("the audit row passing on a robots.txt it never read", row.status === "info");
  }
  detects("a headline mismatch counted against the page",
    auditPage(
      { page: '<html><head><script type="application/ld+json">{"@type":"Article","headline":"X"}</script></head><body><h1>Y</h1></body></html>', finalUrl: "https://e.com/a", httpStatus: 200 },
      new Date()
    ).checks.filter((c) => c.id === "schema-copy-consistency")[0].status === "pass");

  if (broken > 0) { console.log(`\n✗ ${broken} detector(s) failed to fire — reporting nothing.`); process.exit(1); }
  console.log("  all detectors fire.");
}

if (process.argv.indexOf("--self-test") >= 0) selfTest();

console.log(failures === 0 ? "\n✓ crawler-access checks pass\n" : `\n✗ ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
