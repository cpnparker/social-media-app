/**
 * Auto-router: classifies user prompts to pick the best model.
 *
 * Default   → Grok 4.1 Fast   (cheap & fast — $0.20/$0.50, native web search)
 * Reasoning → Grok 4.3        (code, analysis, complex writing — $1.25/$2.50)
 * Grounded  → Claude Sonnet 5 (image-gen + web/fact-check, where Grok fails)
 *
 * Why the Grounded carve-out: Grok has no discrete web_search tool — only
 * LiveSearch, which blends live results with training data and fabricates
 * (the Ceri/Catherine fact-check bug). And Grok hallucinates fake markdown
 * images instead of reliably calling the image tool. Both stay on Claude.
 * The messages route additionally forces web-search queries onto the Grounded
 * model even when they'd otherwise route to a Grok leg.
 *
 * Uses keyword/pattern matching — no LLM call required.
 */

const FAST_MODEL = "grok-4-1-fast" as const;
const REASONING_MODEL = "grok-4-6" as const;
const GROUNDED_MODEL = "claude-sonnet-5" as const;

// ── Keyword patterns that signal a reasoning-heavy prompt ──

const REASONING_KEYWORDS = [
  "analyze", "analyse", "evaluate", "compare", "contrast",
  "explain why", "pros and cons", "trade-off", "tradeoff",
  "critique", "critically", "assess", "justify", "reasoning",
  "implications", "consequences", "root cause",
  "strategy", "strategic", "framework", "methodology",
];

const CODE_KEYWORDS = [
  "write code", "debug", "refactor", "implement", "algorithm",
  "typescript", "javascript", "python", "sql", "regex",
  "function that", "class that", "api endpoint", "unit test",
  "code review", "pull request", "git diff", "compile",
  "syntax error", "stack trace", "exception",
];

const COMPLEX_WRITING_KEYWORDS = [
  "write a report", "draft a proposal", "business plan",
  "long-form", "essay", "white paper", "whitepaper",
  "technical document", "specification", "architecture",
  "comprehensive", "in-depth", "detailed analysis",
];

/**
 * Writing that goes to OTHER PEOPLE, and is judged by them.
 *
 * These were missing entirely, so "write a powerful message to the whole
 * company from the directors after a restructure" scored as an ordinary short
 * prompt and routed to the cheap fast workhorse — the least capable leg — for
 * one of the highest-stakes things anyone asks this product to write. The
 * follow-up that refined it did the same.
 *
 * Stakes here are about AUDIENCE, not length or complexity: a 150-character
 * all-company announcement after redundancies deserves the flagship far more
 * than a 600-character question does, and only the length heuristic above was
 * catching anything.
 */
const AUDIENCE_WRITING_KEYWORDS = [
  "whole company", "all-company", "all company", "all staff", "all-hands",
  "everyone at", "the entire team", "company-wide", "companywide",
  "announcement", "announce to", "press release", "statement",
  "message to the team", "message to the whole", "message to staff",
  "note to the team", "memo", "newsletter",
  "client email", "email to the client", "message to the client",
  "write a message", "draft a message", "write an email", "draft an email",
  "write a note", "draft a note", "write a post", "draft a post",
  "write a letter", "draft a letter", "write a speech", "draft a speech",
];

const MATH_KEYWORDS = [
  "calculate", "solve", "prove", "formula", "equation",
  "derivative", "integral", "probability", "statistics",
  "mathematical", "theorem",
];

// Image generation prompts need Claude — Grok hallucinates fake markdown images
// instead of calling the generate_image tool reliably
const IMAGE_GEN_KEYWORDS = [
  "generate an image", "generate a image", "generate image",
  "create an image", "create a image", "create image",
  "make an image", "make a image", "make image",
  "draw me", "draw a", "draw an",
  "make me a picture", "make a picture", "generate a picture",
  "create a picture", "create a graphic", "make a graphic",
  "generate a graphic", "design a graphic", "design an image",
  "make an infographic", "create an infographic", "generate an infographic",
  "make a visual", "create a visual", "generate a visual",
  "picture of", "image of", "graphic of",
  "make me a logo", "create a logo", "design a logo",
  "make a carousel", "create a carousel", "design a carousel",
  "make a poster", "create a poster", "design a poster",
  "make a banner", "create a banner", "design a banner",
  "make a thumbnail", "create a thumbnail",
  "generate a photo", "create a photo",
  "illustrate", "illustration of",
  // Image-EDIT follow-ups ("make the image more photo realistic", "change the
  // background") — same tool, same Grok-hallucination risk as fresh requests.
  // Keep these phrases image-specific: includes() matching means a generic
  // phrase ("in the background", "in the style of") hijacks ordinary chat.
  "make the image", "make this image", "make that image",
  "the image more", "edit the image", "edit this image",
  "update the image", "change the image", "regenerate the image",
  "redo the image", "new version of the image", "another version of the image",
  "photo realistic", "photorealistic", "more realistic", "less realistic",
  "change the background", "restyle", "stylise this", "stylize this",
  "use this logo", "use the logo", "with the logo",
];

const MULTI_STEP_PATTERNS = [
  /step[\s-]by[\s-]step/i,
  /\b(first|1[\.\)]).*(then|2[\.\)])/i,
  /^\s*\d+[\.\)]\s/m, // numbered list in prompt
];

/** Returns true if the prompt contains a code fence */
function hasCodeFence(text: string): boolean {
  return text.includes("```");
}

/** Check if any keyword from the list appears in the text */
function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

/**
 * A follow-up that operates on what was just produced, rather than asking for
 * something new. "tighten it up", "make it shorter", "less formal", "try again".
 *
 * These carry no subject matter of their own, so classified alone they score as
 * trivial and route to the cheap leg — which is how the SECOND draft of a
 * sensitive all-company message came from the least capable model available,
 * after the first had correctly reached the flagship. The refinement of a
 * high-stakes piece is part of the same high-stakes piece.
 */
const REFINEMENT_PATTERNS = [
  // "trim" and "condense" were missing, so "trim it down" read as a fresh topic
  // and the walk-back stopped there — found by asserting that rephrasing a
  // refinement routes the same as repeating it verbatim, which it did not.
  // Deliberately NOT including "cut": "cut the budget" is a subject, not an edit.
  /^(now |ok,? |okay,? |and |but |also )?(can you |could you |please )?(tighten|shorten|trim|condense|lengthen|expand|rewrite|reword|redo|revise|refine|polish|punch|simplify|soften|sharpen|improve|fix|adjust|tweak|change|update|try)\b/i,
  /\b(make it|keep it|a bit|a little|too) (short|long|brief|concise|punchy|formal|informal|casual|warm|direct|blunt|soft|strong)/i,
  /^(try again|again|another version|different version|one more|same but|shorter|longer|less formal|more formal)\b/i,
  /\b(do not|don'?t) (put|use|make|include)\b/i,
];

/** Short enough that it cannot be carrying its own subject matter. */
const REFINEMENT_MAX_CHARS = 260;

/**
 * Classify a user message and return the best model to use.
 * Exported for use in the messages API route.
 *
 * `priorUserMessages` (most recent first) lets a bare refinement inherit the
 * routing of the thing it is refining. The inheritance is deliberately ONE-WAY:
 * it can only raise the tier, never lower it, so the worst case is that a cheap
 * follow-up becomes a capable one. The reverse — letting a trivial follow-up
 * drag a complex thread down — is the failure this exists to prevent.
 */
export function routeModel(
  userMessage: string,
  priorUserMessages?: string[],
  opts?: { hasDocumentAttachment?: boolean }
): typeof FAST_MODEL | typeof REASONING_MODEL | typeof GROUNDED_MODEL {
  // A DOCUMENT OVERRIDES THE TEXT. Routing used to read the message only, and
  // attachments were invisible to it — so "can you look over this presentation
  // thoroughly" scored as a short, easy request and went to the fast model,
  // which cannot read a PDF at all. The deck was dropped, nothing said so, and
  // the reply explained that the file was not in the shared Drive.
  //
  // GROUNDED_MODEL is Claude, the only chain here that takes a PDF natively as
  // a document block. Extraction usually gets there first, but when it returns
  // nothing — a scanned or image-only deck, an encrypted file, a parser that
  // gave up — Claude can still read the actual pages. Routing on the text and
  // hoping the extractor succeeded is what made the failure silent.
  if (opts?.hasDocumentAttachment) return GROUNDED_MODEL;

  const own = routeOwn(userMessage);
  if (own !== FAST_MODEL || !priorUserMessages?.length) return own;
  if (!isRefinement(userMessage)) return own;

  // Walk back to what is actually being refined — the most recent prior
  // message that is NOT itself a refinement.
  //
  // Looking at exactly ONE prior message was not enough, and the failure was
  // quiet. "write a powerful message to the whole company" → flagship;
  // "shorten it" → inherits; "make it a bit warmer" → its predecessor is now
  // "shorten it", which scores as trivial, so the THIRD draft of a sensitive
  // all-company message landed on the cheapest model available.
  //
  // It also inverted the incentive: repeating yourself verbatim held the high
  // tier (the caller skips messages identical to the current one, so the
  // lookup reached past them to the original), while rephrasing each time
  // collapsed to the cheap leg. Saying the same thing three times should not
  // route better than saying it three different ways.
  for (const prior of priorUserMessages) {
    if (isRefinement(prior)) continue;
    return routeOwn(prior);
  }
  // Every prior message was a refinement too — nothing substantive to inherit.
  return own;
}

/** A follow-up that operates on the last output rather than introducing a topic. */
function isRefinement(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length <= REFINEMENT_MAX_CHARS && REFINEMENT_PATTERNS.some((p) => p.test(trimmed));
}

function routeOwn(userMessage: string): typeof FAST_MODEL | typeof REASONING_MODEL | typeof GROUNDED_MODEL {
  const lower = userMessage.toLowerCase();

  // Image generation → Claude (Grok hallucinates fake markdown images instead
  // of reliably calling the generate_image tool). Checked first so it wins.
  if (matchesAny(lower, IMAGE_GEN_KEYWORDS)) return GROUNDED_MODEL;

  // Code fences → reasoning model
  if (hasCodeFence(userMessage)) return REASONING_MODEL;

  // Long prompts (>500 chars) suggest complex requests
  if (userMessage.length > 500) return REASONING_MODEL;

  // Keyword checks
  if (matchesAny(lower, REASONING_KEYWORDS)) return REASONING_MODEL;
  if (matchesAny(lower, CODE_KEYWORDS)) return REASONING_MODEL;
  if (matchesAny(lower, COMPLEX_WRITING_KEYWORDS)) return REASONING_MODEL;
  // Writing with an audience. Checked after code so "write a script" still
  // reads as code when the rest of the prompt says so.
  if (matchesAny(lower, AUDIENCE_WRITING_KEYWORDS)) return REASONING_MODEL;
  if (matchesAny(lower, MATH_KEYWORDS)) return REASONING_MODEL;

  // Multi-step pattern checks
  if (MULTI_STEP_PATTERNS.some((p) => p.test(userMessage))) return REASONING_MODEL;

  // Default → fast model
  return FAST_MODEL;
}
