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

import type { RenderOutcome } from "./render";
import { crawlerAccess } from "./crawler-access";

export type AuditStatus = "pass" | "warn" | "fail" | "info";

export interface AuditCheck {
  id: string;
  /** Grouping key for the UI. */
  section: "rendering" | "indexability" | "identity" | "structure" | "images" | "schema" | "links" | "freshness";
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
  /** The technical render, when one was performed. Null or absent means the
   *  render did not run — which is REPORTED, never quietly treated as "no
   *  JavaScript gap found". Not looking and finding nothing are different
   *  claims, and only one of them is honest. */
  render?: RenderOutcome | null;
  /**
   * The site's robots.txt, or null when it was NOT READ.
   *
   * Null is not "allowed". A 404, a timeout or a refusal all mean we did not
   * look, and the check reports that rather than counting a pass — the same
   * contract `render` already carries, for the same reason.
   */
  robotsTxt?: string | null;
  /** The site's llms.txt, or null when it was not read. */
  llmsTxt?: string | null;
}

export interface PageAuditResult {
  checks: AuditCheck[];
  counts: { pass: number; warn: number; fail: number };
  fetchedAt: string;
  /** The page's own <title>, so a report about someone's page can call it what
   *  they call it. The report used to title-case the URL slug, which rendered
   *  the Amrize article as "Building The Future 10 Things To Know About
   *  Amrize": the client's own headline, with its punctuation removed and its
   *  capitals changed, as the largest type in a document about their page. */
  pageTitle?: string;
}

const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/**
 * The article region of an already-script-stripped page, for checks that must
 * not be diluted by site chrome.
 *
 * Measured, not assumed: the Amrize page this audit was built against carries
 * 47 images, of which 10 are the article's and 37 are the megamenu and footer.
 * A proportional alt-text rule over all 47 is mostly measuring the nav — and
 * because nav images are template-generated and always captioned, they drag
 * every image verdict toward "pass" no matter what the article does.
 *
 * Deliberately NOT lib/optimizer/url-import's extractArticleRegion: that one
 * exists to extract TEXT and is free to discard markup, whereas this must keep
 * <img> tags intact. Same intuition, different contract — sharing one function
 * across both would mean one of the two callers silently getting the wrong
 * thing. It also keeps this module import-free of anything touching the
 * network, which is what lets it stay pure and offline.
 */
function contentRegion(dom: string): { region: string; scoped: boolean } {
  const s = dom.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1\s*>/gi, " ");
  for (const tag of ["article", "main"]) {
    const m = s.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "i"));
    // The length floor stops a decorative <main> wrapper around a hero banner
    // from being mistaken for the article and shrinking every count to nothing.
    if (m && m[1].replace(/<[^>]+>/g, "").trim().length > 400) return { region: m[1], scoped: true };
  }
  return { region: s, scoped: false };
}

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

/**
 * Words in the article region of a document, by ONE definition.
 *
 * The JavaScript-gap ratio divides a served-HTML number by a rendered number,
 * and the two were produced by different code: this file's contentRegion()
 * regex on one side, and render.ts's `document.querySelector("main, article,
 * [role=main], #main, .main-content")` on the other. Those disagree on real
 * pages — a <main> under the 400-character floor, an <article> nested inside
 * <nav>, a page whose content sits in #main — and when they disagree the ratio
 * compares two different regions and reports a fully server-rendered page as
 * JavaScript-dependent. Both sides now call this, on their own HTML.
 */
function regionWords(html: string): number {
  const live = html.replace(/<!--[\s\S]*?-->/g, " ");
  const dom = live.replace(/<(script|noscript|template|style|svg)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const region = contentRegion(dom).region;
  const text = strip(region);
  return text ? text.split(" ").filter(Boolean).length : 0;
}

export function auditPage(input: PageAuditInput, now: Date): PageAuditResult {
  const { page, finalUrl } = input;
  const checks: AuditCheck[] = [];
  const push = (c: AuditCheck) => checks.push(c);

  // Comments come out FIRST, before anything reads the markup.
  //
  // Commenting a tag out is how a developer disables it, and the audit read
  // the raw string: a commented-out `<meta name="robots" content="noindex">`
  // was reported as a live noindex, which is the single most alarming verdict
  // this file can produce — "nothing else on this audit matters until this is
  // gone" — delivered about a page that is perfectly indexable. The same held
  // for a commented-out JSON-LD block, reported as schema the page does not
  // have. The <h1> checks already stripped comments; the head never did.
  const live = page.replace(/<!--[\s\S]*?-->/g, " ");

  // JSON-LD is extracted BEFORE scripts are deleted, but AFTER comments are.
  const ldBlocks = live.match(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi) || [];

  // Everything structural reads a STRIPPED copy. The raw page is full of dead
  // content that produced confident wrong verdicts: an <h1> inside a script
  // template counted as a second H1, the GTM <noscript><img></noscript> pixel
  // (alt-less, near-universal) raised a standing false alt warning, and an
  // inline SVG's accessibility <title> could stand in for a missing head
  // title. Machines reading the page strip these; the audit must too.
  const dom = live.replace(/<(script|noscript|template|style|svg)\b[\s\S]*?<\/\1\s*>/gi, " ");

  // ── Indexability — everything else is moot if this fails ────────────────
  push({
    id: "http-status", section: "indexability", name: "Responds 200 over HTTPS",
    status: input.httpStatus === 200 && /^https:/i.test(finalUrl) ? "pass" : "fail",
    detail: `HTTP ${input.httpStatus}, ${/^https:/i.test(finalUrl) ? "https" : "NOT https"}${input.redirectedFrom ? `, redirected from ${input.redirectedFrom}` : ""}`,
    remedy: input.httpStatus !== 200 ? "A page that does not answer 200 cannot be crawled, cited or ranked." : undefined,
  });

  const robotsAll = metaContents(live, "robots");
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

  const linkTags = live.match(/<link\b[^>]*>/gi) || [];
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
    const baseTag = (live.match(/<base\b[^>]*>/i) || [])[0];
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
  // ── AI crawler access ───────────────────────────────────────────────────
  //
  // The loudest thing this panel can say. Every other check measures how well
  // a page would be quoted; this one asks whether the crawler is allowed
  // through the door at all. The audit has always read the robots META tag,
  // which governs Google's index, and never the robots FILE, which is where
  // AI crawlers are turned away.
  const crawlerPath = (() => {
    try { return new URL(finalUrl).pathname || "/"; } catch { return "/"; }
  })();
  const verdicts = crawlerAccess(input.robotsTxt === undefined ? null : input.robotsTxt, crawlerPath);
  if (!verdicts) {
    push({
      id: "ai-crawler-access", section: "indexability", name: "AI crawlers allowed",
      status: "info",
      detail: "Not checked — this site's robots.txt could not be read. That is not the same as being open to AI crawlers.",
      remedy: "Fetch https://<domain>/robots.txt by hand and look for GPTBot, ClaudeBot, PerplexityBot, Google-Extended, OAI-SearchBot and CCBot.",
    });
  } else {
    const blocked = verdicts.filter((v) => !v.allowed);
    push({
      id: "ai-crawler-access", section: "indexability", name: "AI crawlers allowed",
      status: blocked.length === 0 ? "pass" : "fail",
      detail: blocked.length === 0
        ? `robots.txt allows all ${verdicts.length} AI crawlers checked on this path.`
        : `robots.txt BLOCKS ${blocked.map((b) => `${b.label} (${b.who})`).join(", ")} on this path.`,
      remedy: blocked.length === 0
        ? undefined
        : "Everything else on this page is worth nothing to those assistants until this changes. Allow them in robots.txt, or accept that this page cannot be cited there.",
    });
  }

  push({
    id: "llms-txt", section: "indexability", name: "llms.txt",
    status: "info",
    detail: input.llmsTxt === undefined || input.llmsTxt === null
      ? "Not checked, or not present. llms.txt is a proposed convention, not a standard, and no major assistant is known to require it."
      : `Present, ${(input.llmsTxt.match(/\S+/g) || []).length} words. It is a proposed convention, not a standard.`,
  });

  push({
    id: "canonical", section: "indexability", name: "Canonical URL",
    status: canonicalStatus, detail: canonicalDetail,
    remedy: canonicalStatus !== "pass" ? "A canonical pointing elsewhere hands this page's citations to another URL; missing means duplicates compete with it." : undefined,
  });

  const htmlTag = (live.match(/<html\b[^>]*>/i) || [""])[0];
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

  const metaDesc = metaContent(live, "name", "description");
  push({
    id: "meta-description", section: "identity", name: "Meta description",
    status: !metaDesc ? "fail" : metaDesc.length < 70 || metaDesc.length > 175 ? "warn" : "pass",
    detail: metaDesc ? `${metaDesc.length} chars: "${metaDesc.slice(0, 110)}"` : "missing",
    remedy: !metaDesc ? "Write one sentence answering the page's question, naming the brand — engines fall back to arbitrary page text without it." : metaDesc && (metaDesc.length < 70 || metaDesc.length > 175) ? "Aim for 150–160 characters." : undefined,
  });

  // property= is the spec; name= is a widespread malformation that Facebook's
  // and most answer engines' parsers deliberately accept. Reporting working
  // tags as missing steers a developer to add duplicates for a non-problem.
  const ogTitle = metaContent(live, "any", "og:title");
  const ogDesc = metaContent(live, "any", "og:description");
  const ogImage = metaContent(live, "any", "og:image");
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
  // The FIRST skip, named. The detail used to read "3 level skips (e.g. H2 →
  // H4)" with that example hardcoded, on every page, whatever it actually
  // skipped. A client checks the one example a report gives them, and an
  // invented one in the line that is supposed to carry the evidence costs more
  // than the finding is worth. Both levels are right here in the loop.
  let firstSkip = "";
  for (let i = 1; i < headings.length; i++) {
    if (headings[i].level > headings[i - 1].level + 1) {
      skips++;
      if (!firstSkip) firstSkip = `H${headings[i - 1].level} to H${headings[i].level}`;
    }
  }
  push({
    id: "heading-hierarchy", section: "structure", name: "Heading levels do not skip",
    status: skips === 0 ? "pass" : "warn",
    detail: skips === 0
      ? `${headings.length} headings, levels descend cleanly`
      : `${skips} level skip${skips === 1 ? "" : "s"}, the first ${firstSkip}`,
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

  /**
   * A summary block near the top: the checklist's TL;DR.
   *
   * Two ways a page can have one and only one of them is reliable to detect.
   * A labelled block ("Key takeaways", "In short", "TL;DR") is unambiguous. A
   * short bulleted list in the first quarter of the article is the unlabelled
   * form, and it is the common one — so it counts, but only when the bullets
   * are short enough to be summary lines rather than a body list.
   *
   * Deliberately NOT scored on the whole page: a footer list of links or a
   * navigation menu is a list of short items near nothing in particular, and
   * counting it would report a summary on almost every page on the web.
   */
  const articleTypesForCoverage = ["Article", "NewsArticle", "BlogPosting", "TechArticle"];
  const { region: articleRegion } = contentRegion(dom);
  const articleTop = articleRegion.slice(0, Math.max(2000, Math.round(articleRegion.length * 0.25)));
  const labelledSummary = /\b(key takeaways?|in short|tl;?dr|at a glance|the short version|summary)\b/i.test(strip(articleTop));
  const topLists = articleTop.match(/<(ul|ol)\b[\s\S]*?<\/\1\s*>/gi) || [];
  const summaryList = topLists.some((list) => {
    const items = list.match(/<li\b[\s\S]*?<\/li\s*>/gi) || [];
    if (items.length < 3 || items.length > 6) return false;
    const lengths = items.map((li) => strip(li).length);
    // Summary lines: a complete statement, not a two-word nav label and not a
    // paragraph. Measured on the checklist's own description, "3-5 bullets,
    // each a complete, self-contained fact".
    return lengths.every((n) => n >= 40 && n <= 320);
  });
  const hasSummary = labelledSummary || summaryList;
  push({
    id: "tldr-visible", section: "structure", name: "A summary block near the top",
    status: hasSummary ? "pass" : "warn",
    detail: labelledSummary
      ? "a labelled summary block appears near the top of the article"
      : summaryList
        ? "a short bulleted list near the top reads as a summary"
        : "no summary block or short bulleted list in the first quarter of the article",
    remedy: hasSummary
      ? undefined
      : "Three to five bullets under the H1, each a complete fact that stands on its own. It is the block most often lifted whole as an answer, because it is the only part of the page already written as one.",
  });

  /**
   * A visible byline. The machine-readable half is schema-author, above.
   *
   * A page can name its author in schema and show nothing to a reader, or the
   * reverse; both halves are worth having and only one of them was checked.
   */
  const bylineMarkup = /\b(rel=["']?author|class=["'][^"']*\b(author|byline)\b)/i.test(articleRegion);
  const bylineText = /\bby\s+[A-Z][a-z]+(?:\s+[A-Z][a-z'’-]+){1,3}\b/.test(strip(articleTop));
  const hasByline = bylineMarkup || bylineText;
  push({
    id: "byline-visible", section: "identity", name: "A named author on the page",
    status: hasByline ? "pass" : "warn",
    detail: hasByline
      ? bylineMarkup ? "an author or byline element is marked up in the article" : "a byline appears in the opening of the article"
      : "no visible byline in the article",
    remedy: hasByline
      ? undefined
      : "A named author with a role is one of the few reliability signals a model can read literally. An article with no author is anonymous corporate copy to a system deciding whether to repeat it.",
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

  // ── Images — scoped to the ARTICLE, not the site chrome ─────────────────
  const { region: contentDom, scoped: regionFound } = contentRegion(dom);
  const allImgs = dom.match(/<img\b[^>]*>/gi) || [];
  const imgs = contentDom.match(/<img\b[^>]*>/gi) || [];
  const chromeImgs = allImgs.length - imgs.length;
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
  const scopeNote = regionFound && chromeImgs > 0
    ? ` (${chromeImgs} nav/footer image${chromeImgs === 1 ? "" : "s"} excluded)`
    : "";
  push({
    id: "image-alt", section: "images", name: "Images carry real alt text",
    status: imgs.length === 0 ? "info" : altBad === 0 ? "pass" : altBad > imgs.length / 2 ? "fail" : "warn",
    detail: imgs.length === 0
      ? `no images in the article${chromeImgs > 0 ? ` (${chromeImgs} in site chrome, not judged)` : ""}`
      : `${imgs.length} article image${imgs.length === 1 ? "" : "s"}${scopeNote} — ${missingAlt} with no alt attribute, ${filenameAlt} with a filename as alt${emptyAlt ? `, ${emptyAlt} decorative (empty alt)` : ""}`,
    remedy: altBad > 0 ? "Models read alt text to understand the page. Describe what the image shows factually; empty alt is correct only for decoration." : undefined,
  });

  // ── Rendering — what an AI crawler actually receives ─────────────────────
  //
  // The crawlers that feed AI answers largely do not execute JavaScript, so
  // the SERVED HTML is what they see. Everything above reads that HTML on
  // purpose. This section exists to answer the one question the served HTML
  // cannot answer about itself: is there content here that only appears after
  // JavaScript runs, and is therefore invisible to them?
  const r = input.render;
  const rawContentWords = strip(contentDom).split(" ").filter(Boolean).length;
  // The rendered side measured by the SAME function, over the DOM the browser
  // actually built — which render.ts already returns in full.
  const renderedContentWords = r && r.ok && r.html ? regionWords(r.html) : 0;

  // Audit-infrastructure status is INFO, never pass/warn/fail: it describes
  // how much the audit could see, not a defect in the page, and it must not
  // move a tally the reader takes as a to-do list.
  push({
    id: "render-ran", section: "rendering", name: "Technical render",
    status: "info",
    detail: !r
      ? "No technical render was performed — every check on this page reads the served HTML only."
      : r.ok
        ? `Rendered in a headless browser in ${(r.renderMs / 1000).toFixed(1)}s${r.blockedRequests > 0 ? `, ${r.blockedRequests} subresource request(s) refused by the address fence` : ""}.`
        : `The render did not complete: ${r.reason}. The checks above still hold — they read the served HTML — but nothing here rules out JavaScript-dependent content.`,
  });

  // A render whose subresources were partly refused is a render that may have
  // run less JavaScript than a real browser would. Reporting a comfortable
  // "no gap" off that would be a confident wrong verdict of exactly the kind
  // this file exists to avoid, so the measurement is withheld instead.
  const renderTrustworthy = !!r && r.ok && r.blockedRequests === 0 && renderedContentWords >= 50;
  if (!renderTrustworthy) {
    push({
      id: "js-dependency", section: "rendering", name: "Content present without JavaScript",
      status: "info",
      detail: !r || !r.ok
        ? "Not measured — this needs a successful render to compare against the served HTML."
        : r.blockedRequests > 0
          ? `Not measured — ${r.blockedRequests} of the page's own requests were refused, so the rendered view is incomplete and any comparison against it would understate the gap.`
          : "Not measured — the rendered article was too short to compare against reliably.",
    });
  } else {
    const ratio = rawContentWords / renderedContentWords;
    const pct = Math.round(ratio * 100);
    push({
      id: "js-dependency", section: "rendering", name: "Content present without JavaScript",
      status: ratio >= 0.75 ? "pass" : ratio >= 0.4 ? "warn" : "fail",
      // The served HTML routinely holds MORE words than the browser shows,
      // because innerText omits what is hidden — collapsed menus, tab panels,
      // screen-reader text. That is the healthy direction, but phrased as a
      // ratio it printed "carries 68 of the 60 words — about 113%", which is
      // nonsense and invites a reader to distrust every other number here.
      detail: ratio >= 1
        ? `The served HTML carries the whole article (${rawContentWords} words) — nothing here waits on JavaScript.`
        : `The served HTML carries ${rawContentWords} of the ${renderedContentWords} words a browser ends up showing — about ${pct}%.`,
      remedy: ratio >= 0.75 ? undefined
        : `The crawlers behind AI answers mostly do not run JavaScript, so roughly ${100 - pct}% of this article is invisible to them. Server-render the article body, or ship it in the initial HTML.`,
    });

  }

  // Image findings depend on a SUCCESSFUL RENDER, not on the word ratio. They
  // were nested inside the ratio's branch, so a page whose JavaScript gap
  // could not be measured — a short article, or (before the scheme fix) any
  // page carrying an inline SVG — silently lost its broken-image and
  // resolution findings too. Two independent questions had been wired to one
  // gate, and the coupling was invisible until the ratio changed.
  if (r && r.ok && r.images.length > 0) {
    // Only a render knows whether an image ever actually arrived. Judged over
    // ARTICLE images with a real layout box: a hidden megamenu image never
    // loads by design, and counting those produced 33 "broken images" on a
    // page whose 10 article images were all fine.
    const judged = r.images.filter((i) => i.inContent && (i.width > 0 || i.height > 0));
    const broken = judged.filter((i) => !i.loaded);
    if (judged.length > 0) {
      push({
        id: "images-resolve", section: "rendering", name: "Article images actually load",
        status: broken.length === 0 ? "pass" : broken.length > judged.length / 2 ? "fail" : "warn",
        detail: broken.length === 0
          ? `all ${judged.length} visible article image${judged.length === 1 ? "" : "s"} loaded`
          : `${broken.length} of ${judged.length} visible article images did not load`,
        remedy: broken.length > 0 ? "A broken image is a dead reference to a machine and a hole to a reader. Check the src values that failed." : undefined,
      });

      // Upscaling is invisible in the HTML and obvious on screen.
      const upscaled = judged.filter((i) => i.loaded && i.naturalWidth > 0 && i.width > i.naturalWidth * 1.35);
      if (upscaled.length > 0) {
        push({
          id: "image-resolution", section: "rendering", name: "Images served at display size",
          status: "warn",
          detail: `${upscaled.length} article image${upscaled.length === 1 ? " is" : "s are"} displayed larger than the file supplied — e.g. ${upscaled[0].naturalWidth}px wide shown at ${upscaled[0].width}px.`,
          remedy: "An upscaled image looks soft on the page. Supply the asset at least at its displayed width.",
        });
      }
    }
  }

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

  /**
   * WHICH types, not just whether any.
   *
   * `schema-present` lists what it found, which is evidence rather than a
   * verdict: a page carrying only BreadcrumbList passes it while telling a
   * model nothing about who published the article or what it answers. The four
   * below are the ones with a mechanism behind them — identity (Organization,
   * Person), the article itself, and answer-block eligibility (FAQPage).
   */
  const WANTED = ["Organization", "Person", "FAQPage"];
  const missingTypes = WANTED.filter((t) => uniqueTypes.indexOf(t) < 0)
    .concat(uniqueTypes.some((t) => articleTypesForCoverage.indexOf(t) >= 0) ? [] : ["Article"]);
  push({
    id: "schema-coverage", section: "schema", name: "Schema covers identity, the article and its answers",
    status: ldBlocks.length === 0 ? "info" : missingTypes.length === 0 ? "pass" : "warn",
    detail: ldBlocks.length === 0
      ? "no JSON-LD to cover anything (see structured data above)"
      : missingTypes.length === 0
        ? "Organization, Person, Article and FAQPage are all present"
        : `missing: ${missingTypes.join(", ")}`,
    remedy: ldBlocks.length > 0 && missingTypes.length > 0
      ? "Organization and Person say who is behind the page, Article says what it is, FAQPage is what makes an answer block eligible. Anything else is decoration by comparison."
      : undefined,
  });

  // From the PARSED types — the raw-regex version missed array-form @type
  // ("@type": ["Article", "TechArticle"]) and read "author" from anywhere in
  // the page, including body prose.
  const articleTypes = articleTypesForCoverage;
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
    // "A grade-A signal in the rubric" is our word for it, not the client's,
    // and a remedy should say what to do rather than why it scores.
    remedy: !dateMatch ? "Print the published date, and the updated date if it has changed, in the article itself rather than only in the markup. Recently updated pages are cited about twice as often, and an engine cannot reward a date it cannot find." : undefined,
  });

  // ── Schema against the visible copy ─────────────────────────────────────
  //
  // The playbook's sharpest line, and the one thing here nothing else checks:
  // "a mismatch is worse than no schema at all". Schema that disagrees with the
  // page asserts a machine-readable fact the page contradicts, and the page is
  // what a human will be shown.
  //
  // GRADED CONSERVATIVELY, and deliberately never `fail`. Every comparison here
  // has a legitimate exception — a syndicated author, a schema date that leads
  // a visible one by a day, a legal name that differs from the trading name —
  // and a check that cries wolf on those is one people learn to skip. `headline`
  // versus H1 is reported as DETAIL ONLY, with no bearing on the status,
  // because an SEO headline differing from the H1 is normal practice.
  const ldJoined = ldBlocks.join(" ");
  const mismatches: string[] = [];
  const notes: string[] = [];

  const schemaDateRaw = (ldJoined.match(/"date(?:Modified|Published)"\s*:\s*"((?:19|20)\d{2})-(\d{2})-\d{2}/) || []);
  if (schemaDateRaw.length > 0 && dateMatch) {
    const schemaYear = schemaDateRaw[1];
    const visibleYear = (dateMatch[0].match(/(?:19|20)\d{2}/) || [])[0];
    if (visibleYear && schemaYear !== visibleYear) {
      mismatches.push(`schema says ${schemaYear}, the visible date says ${visibleYear}`);
    }
  }

  const schemaAuthor = (ldJoined.match(/"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]{2,60})"/) || [])[1];
  if (schemaAuthor && visibleText.indexOf(schemaAuthor) < 0) {
    mismatches.push(`schema names the author "${schemaAuthor}", who does not appear in the page text`);
  }

  const schemaHeadline = (ldJoined.match(/"headline"\s*:\s*"([^"]{4,150})"/) || [])[1];
  if (schemaHeadline && h1s.length === 1 && schemaHeadline.trim() !== h1s[0].trim()) {
    notes.push("schema headline differs from the H1, which is normal and not counted against this check");
  }

  push({
    id: "schema-copy-consistency", section: "schema", name: "Schema agrees with the visible copy",
    status: ldBlocks.length === 0 ? "info" : mismatches.length === 0 ? "pass" : "warn",
    detail: ldBlocks.length === 0
      ? "Not checked — there is no schema on this page to compare."
      : mismatches.length === 0
        ? `The dates, author and organisation in the schema match what the page shows.${notes.length ? " " + notes.join(" ") : ""}`
        : `${mismatches.join("; ")}.${notes.length ? " " + notes.join(" ") : ""}`,
    remedy: mismatches.length > 0
      ? "A machine-readable claim the page contradicts is worse than no claim: it asserts something a reader can see is untrue. Make the schema follow the copy, or fix the copy."
      : undefined,
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

  // ── Internal link density ───────────────────────────────────────────────
  //
  // Counted inside the ARTICLE, not the page: a megamenu and a footer carry
  // dozens of internal links and would drown any signal from the body — the
  // same measurement that scoped the image checks.
  //
  // NOTE what this does NOT know, and says so: the cluster model is about
  // DIRECTION — up to the pillar, sideways to siblings, down to the product —
  // and that needs the site tree. Classifying by path depth would be right on
  // conventionally-structured sites and confidently wrong on the rest.
  const articleAnchors = (contentDom.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi) || []);
  let internal = 0;
  let host = "";
  try { host = new URL(finalUrl).host; } catch { host = ""; }
  for (let i = 0; i < articleAnchors.length; i++) {
    const href = (articleAnchors[i].match(/href=["']([^"']+)["']/i) || [])[1] || "";
    if (!href || href.charAt(0) === "#" || /^(mailto|tel|javascript):/i.test(href)) continue;
    if (/^https?:\/\//i.test(href)) {
      // An absolute link to the site's own domain IS internal. parse.ts marks
      // anything with a host as external, which is right for a draft with no
      // URL and wrong here, where the page's own host is known.
      try { if (new URL(href).host === host) internal++; } catch { /* not a URL */ }
    } else {
      internal++;
    }
  }
  const bodyWords = (strip(contentDom).match(/\S+/g) || []).length;
  const per1000 = bodyWords > 0 ? (internal / bodyWords) * 1000 : 0;
  push({
    id: "internal-link-density", section: "links", name: "Internal links through the body",
    status: bodyWords < 300 ? "info" : per1000 >= 5 ? "pass" : "warn",
    detail: bodyWords < 300
      ? `${internal} internal link${internal === 1 ? "" : "s"} in the article — too short to judge a rate against.`
      : `${internal} internal link${internal === 1 ? "" : "s"} in ${bodyWords.toLocaleString()} words of article, about ${per1000.toFixed(1)} per 1,000. Counts links only — not whether they point up to a pillar, sideways to siblings or down to a product, which needs the site tree.`,
    remedy: bodyWords >= 300 && per1000 < 5
      ? "One internal link every 150-200 words, in the body text with a descriptive anchor. Links in the body distribute authority and give a retrieval system the cluster's shape; navigation links do not."
      : undefined,
  });

  // ── URL hygiene ─────────────────────────────────────────────────────────
  const urlProblems: string[] = [];
  try {
    const u = new URL(finalUrl);
    const path = u.pathname;
    if (/[A-Z]/.test(path)) urlProblems.push("mixed case");
    if (/\/(19|20)\d{2}\/(\d{2})\//.test(path)) urlProblems.push("a date in the path, which dates the URL when the content is refreshed");
    if (/%[0-9a-f]{2}/i.test(path)) urlProblems.push("escaped characters");
    if (u.search && /(^|[?&])(id|p|page_id)=\d+/i.test(u.search)) urlProblems.push("a numeric id rather than a descriptive slug");
  } catch { /* a URL that does not parse is already reported by http-status */ }
  push({
    id: "url-hygiene", section: "identity", name: "URL shape",
    status: urlProblems.length === 0 ? "pass" : "warn",
    detail: urlProblems.length === 0
      ? "lower case, descriptive, no dates or ids"
      : `carries ${urlProblems.join(", ")}`,
    remedy: urlProblems.length > 0
      ? "A descriptive, stable, lower-case URL survives a content refresh. Whether THIS url is stable enough to survive one is a judgement only you can make — it is not checked here."
      : undefined,
  });

  const counts = { pass: 0, warn: 0, fail: 0 };
  for (let i = 0; i < checks.length; i++) {
    const s = checks[i].status;
    if (s === "pass") counts.pass++;
    else if (s === "warn") counts.warn++;
    else if (s === "fail") counts.fail++;
  }
  return { checks, counts, fetchedAt: now.toISOString(), pageTitle: title || undefined };
}
