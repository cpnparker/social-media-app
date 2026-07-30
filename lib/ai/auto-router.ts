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
const REASONING_MODEL = "grok-4-3" as const;
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
 * Classify a user message and return the best model to use.
 * Exported for use in the messages API route.
 */
export function routeModel(userMessage: string): typeof FAST_MODEL | typeof REASONING_MODEL | typeof GROUNDED_MODEL {
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
  if (matchesAny(lower, MATH_KEYWORDS)) return REASONING_MODEL;

  // Multi-step pattern checks
  if (MULTI_STEP_PATTERNS.some((p) => p.test(userMessage))) return REASONING_MODEL;

  // Default → fast model
  return FAST_MODEL;
}
