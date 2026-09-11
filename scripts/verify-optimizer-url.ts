/**
 * The URL importer's extraction, checked by making it fail.
 *
 * Scope: the PURE functions only — extractArticleRegion and extractTitle.
 * importFromUrl is network-bound and its two guards that matter (public-address
 * checks, scheme allowlist) belong to safeFetch, which has its own script.
 * This one answers the question those cannot: given a real page's markup, does
 * the article come out and does the chrome stay behind?
 *
 * The stakes are quieter than they look. Extraction feeds the sanitiser, so
 * nothing here is a security boundary — but a wrong REGION choice silently
 * imports a page's navigation as prose, and every downstream number (word
 * count, keyword density, AI-tell rate) is then computed over menu items. The
 * writer sees a bad score for an article that was never read.
 *
 *   npx tsx scripts/verify-optimizer-url.ts
 *
 * MUTATION LOG — every entry run in a throwaway git worktree, never the
 * shared tree (`vercel deploy --prod` uploads the working directory).
 *
 *   2026-08-21  scripts stripped AFTER the region choice   → 1 fail  ✓
 *   2026-08-21  region preference inverted (body first)    → 1 fail  ✓
 *   2026-08-21  the 400-char floor removed                 → 2 fail  ✓
 *   2026-08-21  og:title preference dropped                → 1 fail  ✓
 *   2026-08-21  the site-suffix trim removed               → 1 fail  ✓
 *   2026-08-21  the nav/header/footer strip removed        → 3 fail  ✓ (2nd try)
 *   (baseline, unmutated: exit 0)
 *
 * The nav-strip mutation SURVIVED the first run, and the reason is a shape
 * this repo keeps meeting: the strip is load-bearing only on the BODY-FALLBACK
 * path, because on the article/main paths the chrome sits outside the chosen
 * region and never enters it. Every fixture had an <article> or <main>, so the
 * one page shape where the strip matters — a chromeful page with neither —
 * was exactly the shape not tested. The §2 chromeful-body fixture exists
 * because of that survival.
 */
import { extractArticleRegion, extractTitle } from "../lib/optimizer/url-import";

let failures = 0;
const pass = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const has = (label: string, hay: string, needle: string) =>
  hay.indexOf(needle) >= 0 ? pass(label) : fail(`${label} — ${JSON.stringify(needle)} not found`);
const hasnt = (label: string, hay: string, needle: string) =>
  hay.indexOf(needle) < 0 ? pass(label) : fail(`${label} — ${JSON.stringify(needle)} IS present`);

/** A long-enough article body: the 400-char floor is part of the contract. */
const BODY = "<p>" + "Real article prose about payment routing. ".repeat(12) + "</p>";

// ── 1. Region choice ─────────────────────────────────────────────────────
console.log(`\n1. The article region wins over the chrome`);
{
  const page =
    `<html><body><nav><a href="/">Home</a><a href="/about">About us</a></nav>` +
    `<div class="sidebar">Related stories and other teasers live here</div>` +
    `<article>${BODY}</article>` +
    `<footer>Copyright Vaultline 2026. All rights reserved.</footer></body></html>`;
  const region = extractArticleRegion(page);
  has("the article's prose is in the region", region, "Real article prose");
  hasnt("the nav did not come with it", region, "About us");
  hasnt("the footer did not come with it", region, "All rights reserved");
  hasnt("the sidebar did not come with it", region, "Related stories");

  // Precondition: the fixture's chrome must live OUTSIDE <article>, or the
  // assertions above test the sanitiser's future work, not the region choice.
  page.indexOf("<nav>") < page.indexOf("<article>")
    ? pass("the fixture's chrome sits outside the article")
    : fail("the fixture's chrome is inside the article — region choice is untested");
}

console.log(`\n2. Fallbacks`);
{
  const mainOnly = `<html><body><nav><a>Menu item</a></nav><main>${BODY}</main></body></html>`;
  has("<main> is used when there is no <article>", extractArticleRegion(mainOnly), "Real article prose");
  hasnt("...and the nav still stays behind", extractArticleRegion(mainOnly), "Menu item");

  const bare = `<html><body>${BODY}</body></html>`;
  has("body is the last resort", extractArticleRegion(bare), "Real article prose");

  // The nav strip is load-bearing ONLY here. On the article/main paths the
  // chrome sits outside the chosen region and never enters it, so a mutation
  // deleting the strip survived every earlier fixture — the one page shape
  // where it matters is a chromeful page with no article or main at all.
  const chromefulBody =
    `<html><body><nav><a>Menu item</a><a>Second menu item</a></nav>` +
    `<header>Site masthead text</header>${BODY}<footer>All rights reserved.</footer></body></html>`;
  const fell = extractArticleRegion(chromefulBody);
  has("the body fallback keeps the prose", fell, "Real article prose");
  hasnt("...and strips the nav, which nothing downstream would catch as chrome", fell, "Menu item");
  hasnt("...and the masthead", fell, "masthead");
  hasnt("...and the footer", fell, "All rights reserved");
}

// ── 3. The floor: a teaser <article> must not shadow the real content ────
console.log(`\n3. The 400-character floor`);
{
  // News homepages wrap every card in <article>. Choosing the first tiny one
  // would import a headline and a read-more link as the whole piece.
  const teaser =
    `<html><body><article><p>Short teaser card.</p></article><main>${BODY}</main></body></html>`;
  const region = extractArticleRegion(teaser);
  has("a sub-400-char article is skipped in favour of main", region, "Real article prose");

  // Precondition: the teaser really is under the floor.
  "Short teaser card.".length < 400
    ? pass("the teaser fixture is genuinely under 400 characters")
    : fail("the teaser fixture is too long to test the floor");

  // A script cannot pad a region past the floor: scripts die BEFORE the length
  // test, or a page whose <article> is one line of text and 10k of analytics
  // bootstrap gets chosen on the strength of its JavaScript.
  const padded =
    `<html><body><article><p>One line.</p><script>${"x".repeat(5000)}</script></article>` +
    `<main>${BODY}</main></body></html>`;
  has("script bytes do not count toward the floor", extractArticleRegion(padded), "Real article prose");
}

// ── 4. Titles ────────────────────────────────────────────────────────────
console.log(`\n4. Titles`);
{
  const both =
    `<head><meta property="og:title" content="The Real Name"><title>The Real Name | Vaultline Media</title></head>`;
  extractTitle(both) === "The Real Name"
    ? pass("og:title wins outright")
    : fail(`og:title lost: ${JSON.stringify(extractTitle(both))}`);

  const reversed = `<head><meta content="Reversed Attributes" property="og:title"></head>`;
  extractTitle(reversed) === "Reversed Attributes"
    ? pass("the attribute-order variant of og:title is read")
    : fail(`reversed og:title missed: ${JSON.stringify(extractTitle(reversed))}`);

  const suffixed = `<head><title>Ten Things About Zephyr | Vaultline</title></head>`;
  extractTitle(suffixed) === "Ten Things About Zephyr"
    ? pass("the site suffix is trimmed from a bare <title>")
    : fail(`suffix survived: ${JSON.stringify(extractTitle(suffixed))}`);

  const entities = `<head><title>Q&amp;A: What&#39;s Next</title></head>`;
  extractTitle(entities) === "Q&A: What's Next"
    ? pass("entities decode in titles")
    : fail(`entities survived: ${JSON.stringify(extractTitle(entities))}`);

  extractTitle("<p>no title anywhere</p>") === ""
    ? pass("no title yields empty, never an invention")
    : fail("a title was invented from nothing");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
