/**
 * The live-page audit — what the DRAFT rubric deliberately does not score.
 *
 * The optimizer's rubric scores one unpublished draft, and its spec drops
 * every page-only criterion for exactly that reason: a draft has no title tag,
 * no schema, no images, no site graph. A LIVE URL has all of them, and they
 * are precisely what Thomas Cremese's Amrize audit spent half its pages on —
 * title tags with no brand, zero pages carrying schema, images without alt
 * text, no visible dates. Auditing a published page is the honest home for
 * those checks; scoring them on a draft never was.
 *
 * HONESTY RULES, inherited from the spec and binding here:
 *
 *  - NO composite score. A draft score is one number because the rubric is
 *    evidence-weighted; bolting a second number onto page furniture would
 *    invite "we went from 61 to 74" claims the evidence cannot carry. The
 *    audit reports checks — pass, warn, fail — and counts them, nothing more.
 *  - SCHEMA IS REPORTED AS MACHINE-READABILITY, NEVER AS RANKING LIFT. The
 *    Ahrefs causal null on schema is written into the spec; the audit says
 *    "absent — models read this to disambiguate identity", not "add this to
 *    rank". The one schema claim with direct mechanism (FAQPage feeding AI
 *    Overview extraction) is graded exactly that far and no further.
 *  - EVERY CHECK POINTS AT ITS EVIDENCE — the tag found, the count, the
 *    filename-as-alt-text — so a developer can act without re-crawling.
 *
 * Pure and offline: takes the fetched HTML string plus fetch metadata, calls
 * nothing. The route owns the network; scripts/verify-optimizer-page-audit.ts
 * owns proving these checks can fail.
 */

export type AuditStatus = "pass" | "warn" | "fail" | "info";

export interface AuditCheck {
  id: string;
  /** Grouping key for the UI. */
  section: "indexability" | "identity" | "structure" | "images" | "schema" | "links" | "freshness";
  name: string;
  status: AuditStatus;
  /** What was found — the evidence, not advice. */
  detail: string;
  /** What to do about it, when the status is not pass. */
  remedy?: string;
}

export interface PageAuditInput {
  /** The RAW page HTML, before any sanitising. */
  page: string;
  finalUrl: string;
  httpStatus: number;
  redirectedFrom?: string | null;
  /** Brand / entity names, from the session canon, for title and schema checks. */
  brandNames?: string[];
  targetQueries?: string[];
}

export interface PageAuditResult {
  checks: AuditCheck[];
  counts: { pass: number; warn: number; fail: number };
  fetchedAt: string;
}

const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function attr(tag: string, name: string): string {
  // Quoted, single-quoted, or UNQUOTED — minifiers strip quotes from
  // space-free values, and an attr() blind to that inverted verdicts in both
  // directions at once: a noindexed page passed while present metas read as
  // missing.
  const m = tag.match(new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))", "i"));
  if (!m) return "";
  return m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] || "";
}

function metaContent(page: string, attrName: "name" | "property" | "any", value: string): string | null {
  const tags = page.match(/<meta\b[^>]*>/gi) || [];
  for (let i = 0; i < tags.length; i++) {
    const nameVal = attr(tags[i], "name").toLowerCase();
    const propVal = attr(tags[i], "property").toLowerCase();
    const hit =
      attrName === "name" ? nameVal === value :
      attrName === "property" ? propVal === value :
      nameVal === value || propVal === value;
    if (hit) return attr(tags[i], "content");
  }
  return null;
}

/** ALL matching meta contents — crawlers honour the most restrictive robots
 *  tag, and a CMS plugin injecting a second one after the theme's permissive
 *  one is a real WordPress pattern that a first-match read sails past. */
function metaContents(page: string, value: string): string[] {
  const tags = page.match(/<meta\b[^>]*>/gi) || [];
  const out: string[] = [];
  for (let i = 0; i < tags.length; i++) {
    if (attr(tags[i], "name").toLowerCase() === value) out.push(attr(tags[i], "content"));
  }
  return out;
}

export function auditPage(input: PageAuditInput, now: Date): PageAuditResult {
  const { page, finalUrl } = input;
  const checks: AuditCheck[] = [];
  const push = (c: AuditCheck) => checks.push(c);

  // JSON-LD is extracted from the RAW page FIRST, because the very next step
  // deletes every <script>.
  const ldBlocks = page.match(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi) || [];

  // Everything structural reads a STRIPPED copy. The raw page is full of dead
  // content that produced confident wrong verdicts: an <h1> inside a script
  // template counted as a second H1, the GTM <noscript><img></noscript> pixel
  // (alt-less, near-universal) raised a standing false alt warning, and an
  // inline SVG's accessibility <title> could stand in for a missing head
  // title. Machines reading the page strip these; the audit must too.
  const dom = page
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|noscript|template|style|svg)\b[\s\S]*?<\/\1\s*>/gi, " ");

  // ── Indexability — everything else is moot if this fails ────────────────
  push({
    id: "http-status", section: "indexability", name: "Responds 200 over HTTPS",
    status: input.httpStatus === 200 && /^https:/i.test(finalUrl) ? "pass" : "fail",
    detail: `HTTP ${input.httpStatus}, ${/^https:/i.test(finalUrl) ? "https" : "NOT https"}${input.redirectedFrom ? `, redirected from ${input.redirectedFrom}` : ""}`,
    remedy: input.httpStatus !== 200 ? "A page that does not answer 200 cannot be crawled, cited or ranked." : undefined,
  });

  const robotsAll = metaContents(page, "robots");
  const robots = robotsAll.length ? robotsAll.join(" | ") : null;
  // content="none" is the documented equivalent of noindex,nofollow, and the
  // most restrictive of SEVERAL robots tags is what crawlers honour.
  const noindex = robotsAll.some((r) => /\bnoindex\b/i.test(r) || /\bnone\b/i.test(r));
  push({
    id: "robots-meta", section: "indexability", name: "Not blocked by a robots meta tag",
    status: noindex ? "fail" : "pass",
    detail: robots ? `robots meta: "${robots}"` : "no robots meta tag (allowed by default)",
    remedy: noindex ? "noindex removes the page from every index and every AI training crawl. Nothing else on this audit matters until this is gone." : undefined,
  });

  const linkTags = page.match(/<link\b[^>]*>/gi) || [];
  let canonical = "";
  for (let i = 0; i < linkTags.length; i++) {
    if (attr(linkTags[i], "rel").toLowerCase() === "canonical") { canonical = attr(linkTags[i], "href"); break; }
  }
  let canonicalStatus: AuditStatus = "warn";
  let canonicalDetail = "no canonical link";
  if (canonical) {
    // Resolved, not string-compared. A relative self-canonical ("/blog/post")
    // is perfectly valid and was being reported as "points elsewhere" — an
    // alarming, concretely wrong claim about a correct page. <base href> wins
    // as the resolution root when present, exactly as a browser resolves it.
    const baseTag = (page.match(/<base\b[^>]*>/i) || [])[0];
    const baseHref = baseTag ? attr(baseTag, "href") : "";
    let resolved = canonical;
    try {
      resolved = new URL(canonical, baseHref ? new URL(baseHref, finalUrl).toString() : finalUrl).toString();
    } catch { /* an unparseable href falls through to the string compare */ }
    const norm = (u: string) => u.replace(/\/$/, "").toLowerCase().replace(/^https?:\/\//, "");
    const same = norm(resolved) === norm(finalUrl);
    canonicalStatus = same ? "pass" : "warn";
    canonicalDetail = same ? `self-referencing: ${canonical}` : `points elsewhere: ${resolved}`;
  }
  push({
    id: "canonical", section: "indexability", name: "Canonical URL",
    status: canonicalStatus, detail: canonicalDetail,
    remedy: canonicalStatus !== "pass" ? "A canonical pointing elsewhere hands this page's citations to another URL; missing means duplicates compete with it." : undefined,
  });

  const htmlTag = (page.match(/<html\b[^>]*>/i) || [""])[0];
  const langAttr = attr(htmlTag, "lang");
  push({
    id: "lang", section: "indexability", name: "Language declared",
    status: langAttr ? "pass" : "warn",
    detail: langAttr ? `lang="${langAttr}"` : "no lang attribute on <html>",
    remedy: !langAttr ? "Declare the language so retrieval systems index the page in the right locale." : undefined,
  });

  // ── Identity — the title/meta layer models actually read ────────────────
  const title = strip((dom.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || ["", ""])[1]);
  const brands = (input.brandNames || []).filter(Boolean);
  const titleHasBrand = brands.length > 0 && brands.some((b) => title.toLowerCase().indexOf(b.toLowerCase()) >= 0);
  let titleStatus: AuditStatus = "pass";
  const titleProblems: string[] = [];
  if (!title) { titleStatus = "fail"; titleProblems.push("missing"); }
  else {
    if (title.length > 60) { titleStatus = "warn"; titleProblems.push(`${title.length} chars (over 60, truncates in results)`); }
    if (brands.length > 0 && !titleHasBrand) { titleStatus = "warn"; titleProblems.push("does not name the brand — the entity does not travel with the result"); }
  }
  push({
    id: "title-tag", section: "identity", name: "Title tag",
    status: titleStatus,
    detail: title ? `"${title.slice(0, 90)}"${titleProblems.length ? " — " + titleProblems.join("; ") : ""}` : "missing",
    remedy: titleStatus !== "pass" ? "Buyer's phrase + brand, under 60 characters. The title does not have to match the H1." : undefined,
  });

  const metaDesc = metaContent(page, "name", "description");
  push({
    id: "meta-description", section: "identity", name: "Meta description",
    status: !metaDesc ? "fail" : metaDesc.length < 70 || metaDesc.length > 175 ? "warn" : "pass",
    detail: metaDesc ? `${metaDesc.length} chars: "${metaDesc.slice(0, 110)}"` : "missing",
    remedy: !metaDesc ? "Write one sentence answering the page's question, naming the brand — engines fall back to arbitrary page text without it." : metaDesc && (metaDesc.length < 70 || metaDesc.length > 175) ? "Aim for 150–160 characters." : undefined,
  });

  // property= is the spec; name= is a widespread malformation that Facebook's
  // and most answer engines' parsers deliberately accept. Reporting working
  // tags as missing steers a developer to add duplicates for a non-problem.
  const ogTitle = metaContent(page, "any", "og:title");
  const ogDesc = metaContent(page, "any", "og:description");
  const ogImage = metaContent(page, "any", "og:image");
  const ogMissing = [!ogTitle && "og:title", !ogDesc && "og:description", !ogImage && "og:image"].filter(Boolean);
  push({
    id: "og-tags", section: "identity", name: "Open Graph tags",
    status: ogMissing.length === 0 ? "pass" : ogMissing.length === 3 ? "fail" : "warn",
    detail: ogMissing.length === 0 ? "og:title, og:description and og:image all present" : `missing: ${ogMissing.join(", ")}`,
    remedy: ogMissing.length ? "OG tags control how the page appears when shared and are read by several answer engines as a second description source." : undefined,
  });

  // ── Structure — as PUBLISHED, which can differ from the draft ───────────
  const h1s = (dom.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) || []).map((h) => strip(h));
  push({
    id: "one-h1", section: "structure", name: "Exactly one H1",
    status: h1s.length === 1 ? "pass" : "fail",
    detail: h1s.length === 0 ? "no H1 on the page" : h1s.length === 1 ? `"${h1s[0].slice(0, 80)}"` : `${h1s.length} H1s: ${h1s.map((h) => `"${h.slice(0, 40)}"`).join(", ")}`,
    remedy: h1s.length !== 1 ? "One H1 stating the page's subject. Zero leaves the subject undeclared; several leave it ambiguous." : undefined,
  });

  const headingTags = dom.match(/<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/gi) || [];
  const headings = headingTags.map((h) => ({ level: Number((h.match(/<h([1-6])/i) || [])[1]), text: strip(h) }));
  let skips = 0;
  for (let i = 1; i < headings.length; i++) {
    if (headings[i].level > headings[i - 1].level + 1) skips++;
  }
  push({
    id: "heading-hierarchy", section: "structure", name: "Heading levels do not skip",
    status: skips === 0 ? "pass" : "warn",
    detail: skips === 0 ? `${headings.length} headings, levels descend cleanly` : `${skips} level skip${skips === 1 ? "" : "s"} (e.g. H2 → H4)`,
    remedy: skips > 0 ? "Skipped levels break the outline retrieval systems use to segment the page into liftable chunks." : undefined,
  });

  const questionHeads = headings.filter((h) => h.level >= 2 && h.level <= 3 && /\?\s*$/.test(h.text)).length;
  const sectionHeads = headings.filter((h) => h.level >= 2 && h.level <= 3).length;
  push({
    id: "question-headings-live", section: "structure", name: "Question-shaped headings",
    status: sectionHeads === 0 ? "warn" : questionHeads > 0 ? "pass" : "warn",
    detail: sectionHeads === 0 ? "no H2/H3 sections at all" : `${questionHeads} of ${sectionHeads} section headings are questions`,
    remedy: questionHeads === 0 ? "A heading phrased as the buyer's question is what retrieval matches against; a label matches nothing." : undefined,
  });

  const faqVisible = /Frequently asked|FAQ/i.test(strip(dom.slice(0, 400000)));
  push({
    id: "faq-visible", section: "structure", name: "Visible FAQ block",
    // Info in BOTH states, deliberately: the draft rubric keeps FAQ presence
    // unscored (DROPPED_FROM_AUTHORITYON, with a verify script asserting it),
    // and letting it feed the audit's pass tally would smuggle the same score
    // back in through the side door.
    status: "info",
    detail: faqVisible ? "an FAQ section appears in the page text" : "no FAQ section found",
    remedy: !faqVisible ? "Question + short answer pairs are pre-chunked for extraction; FAQPage markup feeding answer-box extraction is the one schema mechanism with direct evidence. Optional, not a defect." : undefined,
  });

  // ── Images ──────────────────────────────────────────────────────────────
  const imgs = dom.match(/<img\b[^>]*>/gi) || [];
  let missingAlt = 0, emptyAlt = 0, filenameAlt = 0;
  for (let i = 0; i < imgs.length; i++) {
    // \s boundary, not \b: \b matches after the hyphen in data-alt, so an
    // image with only data-alt read as having alt text.
    const hasAlt = /\salt\s*=/i.test(imgs[i]);
    if (!hasAlt) { missingAlt++; continue; }
    const alt = attr(imgs[i], "alt").trim();
    if (!alt) { emptyAlt++; continue; }
    if (/\.(jpe?g|png|webp|gif|svg)\s*$/i.test(alt) || /^(img|dsc|image)[-_]?\d+/i.test(alt)) filenameAlt++;
  }
  const altBad = missingAlt + filenameAlt;
  push({
    id: "image-alt", section: "images", name: "Images carry real alt text",
    status: imgs.length === 0 ? "info" : altBad === 0 ? "pass" : altBad > imgs.length / 2 ? "fail" : "warn",
    detail: imgs.length === 0 ? "no images on the page" : `${imgs.length} images — ${missingAlt} with no alt attribute, ${filenameAlt} with a filename as alt${emptyAlt ? `, ${emptyAlt} decorative (empty alt)` : ""}`,
    remedy: altBad > 0 ? "Models read alt text to understand the page. Describe what the image shows factually; empty alt is correct only for decoration." : undefined,
  });

  // ── Schema — reported as machine-readability, never as ranking lift ─────
  const schemaTypes: string[] = [];
  for (let i = 0; i < ldBlocks.length; i++) {
    const body = ldBlocks[i].replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      const parsed = JSON.parse(body);
      const walk = (o: any) => {
        if (!o || typeof o !== "object") return;
        if (Array.isArray(o)) { o.forEach(walk); return; }
        const t = o["@type"];
        if (typeof t === "string") schemaTypes.push(t);
        else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && schemaTypes.push(x));
        Object.keys(o).forEach((k) => walk(o[k]));
      };
      walk(parsed);
    } catch {
      schemaTypes.push("(unparseable block)");
    }
  }
  const uniqueTypes = Array.from(new Set(schemaTypes));
  push({
    id: "schema-present", section: "schema", name: "Structured data",
    status: ldBlocks.length === 0 ? "warn" : uniqueTypes.indexOf("(unparseable block)") >= 0 ? "warn" : "pass",
    detail: ldBlocks.length === 0 ? "no JSON-LD on the page" : `types found: ${uniqueTypes.join(", ")}`,
    remedy: ldBlocks.length === 0
      ? "Schema is the page's machine-readable identity statement. The evidence does not support ranking-lift claims — the honest case is disambiguation (Organization, Person, Article) and answer-block eligibility (FAQPage)."
      : uniqueTypes.indexOf("(unparseable block)") >= 0 ? "A JSON-LD block failed to parse — invalid schema is worse than none, because it claims machine-readability it does not deliver." : undefined,
  });

  // From the PARSED types — the raw-regex version missed array-form @type
  // ("@type": ["Article", "TechArticle"]) and read "author" from anywhere in
  // the page, including body prose.
  const articleTypes = ["Article", "NewsArticle", "BlogPosting", "TechArticle"];
  const hasArticleType = uniqueTypes.some((t) => articleTypes.indexOf(t) >= 0);
  const hasArticleWithAuthor = hasArticleType && ldBlocks.some((blk) => /"author"\s*:/.test(blk));
  push({
    id: "schema-author", section: "schema", name: "Article schema names an author",
    status: hasArticleType ? (hasArticleWithAuthor ? "pass" : "warn") : "info",
    detail: hasArticleWithAuthor ? "Article schema with an author entity" : hasArticleType ? "Article schema present but no author field" : "no Article schema (see structured data above)",
    remedy: !hasArticleWithAuthor ? "A named author in schema is the machine-readable half of the byline." : undefined,
  });

  // ── Freshness ───────────────────────────────────────────────────────────
  const visibleText = strip(dom.slice(0, 300000));
  const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";
  const DATE_FORMS =
    `(?:\\d{1,2}\\s+)?${MONTH}\\.?\\s+\\d{1,2}?,?\\s*(?:19|20)\\d{2}` + // 19 August 2026 / August 19, 2026 / August 2026
    `|\\d{1,2}\\s+${MONTH}\\.?\\s+(?:19|20)\\d{2}` +
    `|(?:19|20)\\d{2}-\\d{2}-\\d{2}` +                                        // ISO
    `|\\d{1,2}[\\/.]\\d{1,2}[\\/.](?:19|20)\\d{2}`;                        // 19/08/2026
  const dateMatch = visibleText.match(new RegExp(`\\b(?:published|updated|posted|revised|last modified)[^.]{0,30}?(${DATE_FORMS})`, "i"));
  push({
    id: "visible-date", section: "freshness", name: "A visible published or updated date",
    status: dateMatch ? "pass" : "warn",
    detail: dateMatch ? `found: "${dateMatch[0].slice(0, 60)}"` : "no visible published/updated date found in the page text",
    remedy: !dateMatch ? "Freshness is a grade-A signal in the rubric — roughly double the citation rate for recently-updated content — and an engine cannot reward a date it cannot find." : undefined,
  });

  // ── Links ───────────────────────────────────────────────────────────────
  const anchors = dom.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
  let clickHere = 0;
  for (let i = 0; i < anchors.length; i++) {
    const t = strip(anchors[i]).toLowerCase();
    if (t === "click here" || t === "here" || t === "read more" || t === "learn more") clickHere++;
  }
  push({
    id: "anchor-text", section: "links", name: "Descriptive anchor text",
    status: clickHere === 0 ? "pass" : "warn",
    detail: clickHere === 0 ? `${anchors.length} links, none with empty-calorie anchors` : `${clickHere} link${clickHere === 1 ? "" : "s"} with "click here"-style anchors`,
    remedy: clickHere > 0 ? 'Anchor text tells machines what the destination is. "Click here" tells them nothing.' : undefined,
  });

  const counts = { pass: 0, warn: 0, fail: 0 };
  for (let i = 0; i < checks.length; i++) {
    const s = checks[i].status;
    if (s === "pass") counts.pass++;
    else if (s === "warn") counts.warn++;
    else if (s === "fail") counts.fail++;
  }
  return { checks, counts, fetchedAt: now.toISOString() };
}
