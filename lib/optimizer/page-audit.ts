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
  const m = tag.match(new RegExp(name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')", "i"));
  return m ? (m[2] !== undefined ? m[2] : m[3] || "") : "";
}

function metaContent(page: string, matcher: RegExp): string | null {
  const tags = page.match(/<meta\b[^>]*>/gi) || [];
  for (let i = 0; i < tags.length; i++) {
    if (matcher.test(tags[i])) return attr(tags[i], "content");
  }
  return null;
}

export function auditPage(input: PageAuditInput, now: Date): PageAuditResult {
  const { page, finalUrl } = input;
  const checks: AuditCheck[] = [];
  const push = (c: AuditCheck) => checks.push(c);
  const head = page.slice(0, page.search(/<body\b/i) >= 0 ? page.search(/<body\b/i) : Math.min(page.length, 60000));

  // ── Indexability — everything else is moot if this fails ────────────────
  push({
    id: "http-status", section: "indexability", name: "Responds 200 over HTTPS",
    status: input.httpStatus === 200 && /^https:/i.test(finalUrl) ? "pass" : "fail",
    detail: `HTTP ${input.httpStatus}, ${/^https:/i.test(finalUrl) ? "https" : "NOT https"}${input.redirectedFrom ? `, redirected from ${input.redirectedFrom}` : ""}`,
    remedy: input.httpStatus !== 200 ? "A page that does not answer 200 cannot be crawled, cited or ranked." : undefined,
  });

  const robots = metaContent(page, /name\s*=\s*["']robots["']/i);
  const noindex = !!robots && /noindex/i.test(robots);
  push({
    id: "robots-meta", section: "indexability", name: "Not blocked by a robots meta tag",
    status: noindex ? "fail" : "pass",
    detail: robots ? `robots meta: "${robots}"` : "no robots meta tag (allowed by default)",
    remedy: noindex ? "noindex removes the page from every index and every AI training crawl. Nothing else on this audit matters until this is gone." : undefined,
  });

  const canonicalTag = (page.match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i) || [])[0];
  const canonical = canonicalTag ? attr(canonicalTag, "href") : "";
  let canonicalStatus: AuditStatus = "warn";
  let canonicalDetail = "no canonical link";
  if (canonical) {
    const same = canonical.replace(/\/$/, "") === finalUrl.replace(/\/$/, "");
    canonicalStatus = same ? "pass" : "warn";
    canonicalDetail = same ? `self-referencing: ${canonical}` : `points elsewhere: ${canonical}`;
  }
  push({
    id: "canonical", section: "indexability", name: "Canonical URL",
    status: canonicalStatus, detail: canonicalDetail,
    remedy: canonicalStatus !== "pass" ? "A canonical pointing elsewhere hands this page's citations to another URL; missing means duplicates compete with it." : undefined,
  });

  const langAttr = (page.match(/<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
  push({
    id: "lang", section: "indexability", name: "Language declared",
    status: langAttr ? "pass" : "warn",
    detail: langAttr ? `lang="${langAttr}"` : "no lang attribute on <html>",
    remedy: !langAttr ? "Declare the language so retrieval systems index the page in the right locale." : undefined,
  });

  // ── Identity — the title/meta layer models actually read ────────────────
  const title = strip((page.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || ["", ""])[1]);
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

  const metaDesc = metaContent(page, /name\s*=\s*["']description["']/i);
  push({
    id: "meta-description", section: "identity", name: "Meta description",
    status: !metaDesc ? "fail" : metaDesc.length < 70 || metaDesc.length > 175 ? "warn" : "pass",
    detail: metaDesc ? `${metaDesc.length} chars: "${metaDesc.slice(0, 110)}"` : "missing",
    remedy: !metaDesc ? "Write one sentence answering the page's question, naming the brand — engines fall back to arbitrary page text without it." : metaDesc && (metaDesc.length < 70 || metaDesc.length > 175) ? "Aim for 150–160 characters." : undefined,
  });

  const ogTitle = metaContent(page, /property\s*=\s*["']og:title["']/i);
  const ogDesc = metaContent(page, /property\s*=\s*["']og:description["']/i);
  const ogImage = metaContent(page, /property\s*=\s*["']og:image["']/i);
  const ogMissing = [!ogTitle && "og:title", !ogDesc && "og:description", !ogImage && "og:image"].filter(Boolean);
  push({
    id: "og-tags", section: "identity", name: "Open Graph tags",
    status: ogMissing.length === 0 ? "pass" : ogMissing.length === 3 ? "fail" : "warn",
    detail: ogMissing.length === 0 ? "og:title, og:description and og:image all present" : `missing: ${ogMissing.join(", ")}`,
    remedy: ogMissing.length ? "OG tags control how the page appears when shared and are read by several answer engines as a second description source." : undefined,
  });

  // ── Structure — as PUBLISHED, which can differ from the draft ───────────
  const h1s = (page.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) || []).map((h) => strip(h));
  push({
    id: "one-h1", section: "structure", name: "Exactly one H1",
    status: h1s.length === 1 ? "pass" : "fail",
    detail: h1s.length === 0 ? "no H1 on the page" : h1s.length === 1 ? `"${h1s[0].slice(0, 80)}"` : `${h1s.length} H1s: ${h1s.map((h) => `"${h.slice(0, 40)}"`).join(", ")}`,
    remedy: h1s.length !== 1 ? "One H1 stating the page's subject. Zero leaves the subject undeclared; several leave it ambiguous." : undefined,
  });

  const headingTags = page.match(/<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/gi) || [];
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

  const faqVisible = /Frequently asked|FAQ/i.test(strip(page.slice(0, 400000)));
  push({
    id: "faq-visible", section: "structure", name: "Visible FAQ block",
    status: faqVisible ? "pass" : "info",
    detail: faqVisible ? "an FAQ section appears in the page text" : "no FAQ section found",
    remedy: !faqVisible ? "Question + short answer pairs are pre-chunked for extraction — the most direct route to answer-engine citations. Optional, not a defect." : undefined,
  });

  // ── Images ──────────────────────────────────────────────────────────────
  const imgs = page.match(/<img\b[^>]*>/gi) || [];
  let missingAlt = 0, emptyAlt = 0, filenameAlt = 0;
  for (let i = 0; i < imgs.length; i++) {
    const hasAlt = /\balt\s*=/i.test(imgs[i]);
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
  const ldBlocks = page.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
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

  const hasArticleWithAuthor = /"@type"\s*:\s*"(Article|NewsArticle|BlogPosting)"/.test(page) && /"author"/.test(page);
  push({
    id: "schema-author", section: "schema", name: "Article schema names an author",
    status: uniqueTypes.some((t) => ["Article", "NewsArticle", "BlogPosting"].indexOf(t) >= 0) ? (hasArticleWithAuthor ? "pass" : "warn") : "info",
    detail: hasArticleWithAuthor ? "Article schema with an author entity" : uniqueTypes.some((t) => ["Article", "NewsArticle", "BlogPosting"].indexOf(t) >= 0) ? "Article schema present but no author field" : "no Article schema (see structured data above)",
    remedy: !hasArticleWithAuthor ? "A named author in schema is the machine-readable half of the byline." : undefined,
  });

  // ── Freshness ───────────────────────────────────────────────────────────
  const visibleText = strip(page.slice(0, 300000));
  const dateMatch = visibleText.match(/\b(?:published|updated|posted|revised)[^.]{0,30}?((?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}?,?\s*(?:19|20)\d{2}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:19|20)\d{2})/i);
  push({
    id: "visible-date", section: "freshness", name: "A visible published or updated date",
    status: dateMatch ? "pass" : "warn",
    detail: dateMatch ? `found: "${dateMatch[0].slice(0, 60)}"` : "no visible published/updated date found in the page text",
    remedy: !dateMatch ? "Freshness is the strongest single signal in the citation research, and an engine cannot reward a date it cannot find." : undefined,
  });

  // ── Links ───────────────────────────────────────────────────────────────
  const anchors = page.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
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
