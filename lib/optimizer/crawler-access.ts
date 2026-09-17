/**
 * Which AI crawlers this site lets in.
 *
 * ── WHY THIS IS THE LOUDEST CHECK IN THE AUDIT ──────────────────────────────
 *
 * A page can pass every other check on the panel — schema, headings, answer
 * position, freshness, the lot — and be worth nothing on ChatGPT, because the
 * site's robots.txt tells GPTBot not to come. The audit has always read the
 * robots META TAG, which governs Google's index, and has never read the robots
 * FILE, which is where AI crawlers are actually turned away. Everything the
 * product measures is downstream of a question it was not asking.
 *
 * ── PARSING, NOT FETCHING ───────────────────────────────────────────────────
 *
 * Pure and offline, like the rest of page-audit: the route fetches, this
 * decides. That is what lets the check be driven by fixtures rather than by a
 * network, and it is why the existing audit can be verified at all.
 *
 * ── THE RULES THAT ACTUALLY MATTER ──────────────────────────────────────────
 *
 * robots.txt looks simpler than it is, and every one of these has bitten
 * somebody:
 *
 *   - GROUPS. Consecutive `User-agent:` lines share the rules that follow. A
 *     named agent's OWN group wins outright over `User-agent: *` — a site that
 *     blocks everything and then allows GPTBot is allowing GPTBot.
 *   - `Disallow:` WITH AN EMPTY VALUE MEANS ALLOW. It is the documented way to
 *     say "everything", and reading it as a block inverts the answer.
 *   - LONGEST MATCH WINS between Allow and Disallow, and Allow wins a tie. That
 *     is the standard's own rule, and it is how `Disallow: /` plus
 *     `Allow: /blog/` is meant to resolve.
 *   - CASE. Agent tokens are matched case-insensitively; paths are not.
 *
 * A wrong answer here is expensive in both directions: telling someone they are
 * blocked when they are not sends them to their infrastructure team for
 * nothing, and telling them they are open when they are blocked is the entire
 * failure this check exists to prevent.
 *
 * ── AND THE BODY HAS TO BE A ROBOTS FILE ────────────────────────────────────
 *
 * Which is how that exact failure happened. Temasek's /robots.txt answers 200
 * with a 67KB web page — an AEM soft-404, no robots file on the site at all —
 * and a parser that reads a page as "a file with no rules in it" returns every
 * crawler allowed, byte-identical in meaning to a genuinely permissive file.
 * The audit then printed "robots.txt allows all 6 AI crawlers checked on this
 * path" on the strength of a page that said nothing of the kind.
 *
 * The guard lives HERE, in the parser, rather than at the place that fetches.
 * Both were honest homes for it and the fetch seam was the tempting one — but
 * this repo's recorded failure mode is a fix that lands in one path and not its
 * sibling, and a fetch seam can refuse a body without being able to SAY
 * anything, so a soft-404 would arrive downstream indistinguishable from a
 * timeout. A predicate over a string is exactly as pure and as offline as the
 * parser it sits beside, so nothing about "the route fetches, this decides"
 * changes. crawlerAccess refuses the body itself, page-audit asks
 * notRobotsReason which kind of nothing it received, and any future caller
 * arrives with the hole already closed.
 *
 * TWO PREDICATES, and the difference matters. bodyIsMarkup is the broad one and
 * belongs to robots.txt, where the body is supposed to be plain text and any
 * tag at all is a sign of something else served at that address.
 * bodyIsServedPage is the narrow one, for llms.txt, which is MARKDOWN and
 * routinely carries `<br>`, `<details>` and a `<script>` inside a code sample:
 * reading those as a page reports a file that is present and correct as absent,
 * which is this module's own failure with the sign flipped.
 */

/** The crawlers behind AI answers. Names as they appear in robots.txt. */
export const AI_CRAWLERS: { token: string; label: string; who: string }[] = [
  { token: "GPTBot", label: "GPTBot", who: "ChatGPT" },
  { token: "OAI-SearchBot", label: "OAI-SearchBot", who: "ChatGPT search" },
  { token: "ClaudeBot", label: "ClaudeBot", who: "Claude" },
  { token: "PerplexityBot", label: "PerplexityBot", who: "Perplexity" },
  { token: "Google-Extended", label: "Google-Extended", who: "Gemini and AI Overviews training" },
  { token: "CCBot", label: "CCBot", who: "Common Crawl, which feeds many models" },
];

export interface CrawlerVerdict {
  token: string;
  label: string;
  who: string;
  allowed: boolean;
  /** Which group decided it: the agent's own rules, or the wildcard. */
  via: "own-group" | "wildcard" | "default";
}

interface Group {
  agents: string[];
  rules: { allow: boolean; path: string }[];
}

/**
 * Why a fetched body is not a robots.txt at all.
 *
 *   markup         — a doctype, a tag, an XML declaration: a page, not a file.
 *   no-directives  — it has content, and none of that content is a robots
 *                    line. A JSON error body, a plain-text "Page not found",
 *                    an S3 <Error>.
 */
export type NotRobotsReason = "markup" | "no-directives";

/** Comment-stripped, blank-stripped lines — what a robots parser actually sees. */
function contentLines(body: string): string[] {
  const out: string[] = [];
  const lines = String(body || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/#.*$/, "").trim();
    if (line) out.push(line);
  }
  return out;
}

/** Non-blank lines, comments and all — what a MARKDOWN file's first line is. */
function rawLines(body: string): string[] {
  const out: string[] = [];
  const lines = String(body || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line) out.push(line);
  }
  return out;
}

/**
 * A line that OPENS like a document: a doctype, an XML declaration, a tag.
 *
 * The angle bracket alone is not enough, and markdown is why: `<https://x/y>`
 * is an autolink, a shape a real llms.txt opens with. So the bracket has to be
 * followed by `!`, `?`, or a tag name that ends where a tag name ends — which
 * `https:` does not.
 */
function opensLikeDocument(line: string): boolean {
  // An HTML COMMENT is not a document opener. Markdown files carry generator
  // banners — `<!-- generated by …, do not edit -->` — and a page that opens
  // with a comment still has its doctype and its <html> on the lines below.
  if (line.indexOf("<!--") === 0) return false;
  return /^<(?:[!?]|\/?[a-z][a-z0-9]*(?:[\s/>]|$))/i.test(line);
}

/**
 * Is this body a SERVED WEB PAGE — the shapes a page always has and a
 * plain-text or markdown file never does?
 *
 * The narrow predicate, and the one the seams use for llms.txt. An llms.txt is
 * MARKDOWN: it routinely carries `<br>`, `<details>`, an `<img>` badge or a
 * `<script>` tag inside a code sample, and the broad test below reads every one
 * of those as a page. Discarding a real llms.txt and reporting it absent is the
 * crying-wolf direction of this module's own failure — so this half asks only
 * for the marks a document carries and a file does not: a doctype, the page
 * skeleton, or an opening line that is a tag or a declaration.
 *
 * Raw lines, not comment-stripped: `#` starts a comment in robots.txt and a
 * HEADING in markdown, and stripping the heading off an llms.txt would leave
 * whatever followed it standing in for the first line.
 */
export function bodyIsServedPage(body: string): boolean {
  const lines = rawLines(body);
  if (lines.length === 0) return false;
  if (opensLikeDocument(lines[0])) return true;
  const joined = lines.join("\n");
  if (/<!doctype\b/i.test(joined)) return true;
  return /<(?:html|head|body)\b[^>]*>/i.test(joined);
}

/**
 * Is this fetched body markup rather than a plain-text file?
 *
 * The broad predicate, for robots.txt ONLY, where the body is supposed to be
 * plain text and any tag at all is a sign of something else served at that
 * address. A meta-refresh stub and a fragment with no doctype both arrive this
 * way, and neither is a robots file.
 *
 * Comments are stripped before the test, so a robots.txt whose comment happens
 * to mention `<html>` is not condemned by its own documentation.
 */
export function bodyIsMarkup(body: string): boolean {
  const lines = contentLines(body);
  if (lines.length === 0) return false;
  if (opensLikeDocument(lines[0])) return true;
  const joined = lines.join("\n");
  if (/<!doctype\b/i.test(joined)) return true;
  // A closing tag, or a recognisable element anywhere in the body.
  if (/<\/[a-z][a-z0-9]*\s*>/i.test(joined)) return true;
  return /<(?:html|head|body|title|meta|link|script|style|div|span|p|a|h[1-6]|nav|main|section|article|header|footer|img|br|table|tr|td|ul|ol|li|form|input|button|svg|iframe)\b[^>]*>/i.test(joined);
}

/**
 * The lines a robots parser would ACT on, counted by kind.
 *
 * Counting them is how "is this a robots file" is answered, and the counts are
 * kept apart because the three kinds carry different weight — see the rule in
 * notRobotsReason below.
 */
function robotsEvidence(lines: string[]): { agents: number; rules: number; sitemaps: number } {
  let agents = 0, rules = 0, sitemaps = 0;
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].indexOf(":");
    if (at < 0) continue;
    const field = lines[i].slice(0, at).trim().toLowerCase();
    const value = lines[i].slice(at + 1).trim();
    if (field === "user-agent") agents++;
    else if (field === "allow" || field === "disallow" || field === "crawl-delay") rules++;
    // A Sitemap value is a URL by the standard, and demanding one is what
    // tells a real sitemap-only file from a sentence that begins with the
    // word: "Sitemap: not available on this server, sorry" is prose.
    else if (field === "sitemap" && /^https?:\/\//i.test(value)) sitemaps++;
  }
  return { agents, rules, sitemaps };
}

/**
 * Is this body a robots.txt at all, or something else served at that address?
 *
 * Returns null when it IS one — and the two legitimate near-empty cases are the
 * reason this is a predicate rather than a length test. A genuinely EMPTY
 * robots.txt and a COMMENTS-ONLY robots.txt are both real files that really do
 * say "everything is allowed", and reading either as junk would invent a block
 * nobody wrote. Those are not the failure; a web page is.
 *
 * MARKUP BEATS DIRECTIVES, and directives beat everything else:
 *
 *  - markup first, because an HTML page about robots.txt (a search result, a
 *    docs page, a CMS soft-404 with a sitemap widget on it) can contain the
 *    word "Disallow:" and must still not be parsed as a file.
 *  - A RECOGNISED WORD BEFORE A COLON IS NOT ENOUGH, which is the second thing
 *    this got wrong. Any body can contain one: an echo of the request headers
 *    opens `Host:` and `User-Agent:`, and a file accepted on that evidence is
 *    parsed into a group with no rules and printed as "allows all 6 AI
 *    crawlers" — this module's own nightmare sentence, from three lines of
 *    junk. So a robots file is one that has a GROUP — an agent line and at
 *    least one rule beneath it — or a Sitemap line pointing at a real URL,
 *    which is a shape sites genuinely serve on its own.
 *  - The cost of that tightening is the malformed file: a bare `User-agent: *`
 *    with no rules, or a `Disallow: /` with no agent, now reads as "not a
 *    robots file" and the panel says it did not check. Both are rare, both are
 *    ignored by crawlers anyway, and the sentence a reader gets is "go and
 *    look" rather than a verdict invented from an ambiguous body.
 *  - CONTENT-TYPE IS NOT CONSULTED, deliberately, and that is the one judgement
 *    call in here. A robots.txt served as text/html with real directives in it
 *    reads as a ROBOTS FILE. Static hosts mislabel plain-text files constantly
 *    — S3, AEM and half of nginx will hand you text/html for a file that is
 *    perfectly well-formed — while a body full of `User-agent:` lines is
 *    unambiguous evidence of what it is. Crawlers parse the bytes; so do we.
 *    Condemning that file would report a site with a correct robots.txt as
 *    unreadable, which is the crying-wolf direction of the same error. The
 *    content type therefore only ever agrees with a verdict the body already
 *    supports, which is another way of saying it adds nothing.
 */
export function notRobotsReason(body: string): NotRobotsReason | null {
  const lines = contentLines(body);
  // Empty, or nothing but comments. A real file, and an open one.
  if (lines.length === 0) return null;
  if (bodyIsMarkup(body)) return "markup";

  const ev = robotsEvidence(lines);
  if (ev.agents > 0 && ev.rules > 0) return null;
  if (ev.sitemaps > 0) return null;
  return "no-directives";
}

/**
 * Parse robots.txt into groups.
 *
 * Consecutive User-agent lines accumulate into one group; the first rule line
 * after them closes the agent list, so the NEXT User-agent starts a new group.
 */
function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let collectingAgents = false;

  const lines = String(text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/#.*$/, "").trim();
    if (!line) continue;
    const at = line.indexOf(":");
    if (at < 0) continue;
    const field = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();

    if (field === "user-agent") {
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
        collectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (field !== "allow" && field !== "disallow") continue;
    if (!current) continue;
    collectingAgents = false;
    // An empty Disallow means "nothing is disallowed" — a rule that must be
    // recorded, not skipped, because it is how a site says "everything".
    current.rules.push({ allow: field === "allow" || value === "", path: value });
  }
  return groups;
}

/** Longest match wins; Allow wins a tie. The standard's own resolution. */
function decide(rules: { allow: boolean; path: string }[], path: string): boolean {
  let best: { allow: boolean; len: number } | null = null;
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (r.path === "") {
      // Empty value: an empty Disallow allows everything; an empty Allow says
      // nothing at all and is ignored rather than treated as a match.
      if (r.allow && !best) best = { allow: true, len: 0 };
      continue;
    }
    if (path.indexOf(r.path) !== 0) continue;
    if (!best || r.path.length > best.len || (r.path.length === best.len && r.allow)) {
      best = { allow: r.allow, len: r.path.length };
    }
  }
  return best ? best.allow : true;
}

/**
 * Can each AI crawler fetch this path?
 *
 * `null` text means the file was NOT READ — a 404, a timeout, a refusal. That
 * is not the same as "allowed", and the caller must render it differently;
 * this function reports it by returning null rather than a cheerful set of
 * passes.
 *
 * A body that is NOT A ROBOTS FILE returns null for the same reason and with
 * the same force. 200 is not evidence; the bytes are. A caller that wants to
 * say WHICH of the two it was asks notRobotsReason itself — one function, one
 * rule, so the sentence on screen and the verdict behind it cannot drift apart.
 */
export function crawlerAccess(robotsTxt: string | null, path: string = "/"): CrawlerVerdict[] | null {
  if (robotsTxt === null || robotsTxt === undefined) return null;
  if (notRobotsReason(robotsTxt)) return null;
  const groups = parseGroups(robotsTxt);

  const wildcard = groups.filter((g) => g.agents.indexOf("*") >= 0);
  return AI_CRAWLERS.map((c) => {
    const token = c.token.toLowerCase();
    const own = groups.filter((g) => g.agents.indexOf(token) >= 0);
    if (own.length > 0) {
      const rules = own.reduce((acc: { allow: boolean; path: string }[], g) => acc.concat(g.rules), []);
      return { ...c, allowed: decide(rules, path), via: "own-group" as const };
    }
    if (wildcard.length > 0) {
      const rules = wildcard.reduce((acc: { allow: boolean; path: string }[], g) => acc.concat(g.rules), []);
      return { ...c, allowed: decide(rules, path), via: "wildcard" as const };
    }
    // No group applies. The standard's default is allow, and saying so beats
    // inventing a block nobody wrote.
    return { ...c, allowed: true, via: "default" as const };
  });
}
