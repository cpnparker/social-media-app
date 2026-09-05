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
 */
export function crawlerAccess(robotsTxt: string | null, path: string = "/"): CrawlerVerdict[] | null {
  if (robotsTxt === null || robotsTxt === undefined) return null;
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
