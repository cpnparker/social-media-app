/**
 * Auto-router: classifies user prompts to pick the best model.
 *
 * Default → Grok 4 Fast (cheap & fast)
 * Upgrade → Claude Sonnet 4.6 (reasoning, code, complex writing)
 *
 * Uses keyword/pattern matching — no LLM call required.
 */

const FAST_MODEL = "grok-4-1-fast" as const;
const REASONING_MODEL = "claude-sonnet-4-6" as const;

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
export function routeModel(userMessage: string): typeof FAST_MODEL | typeof REASONING_MODEL {
  const lower = userMessage.toLowerCase();

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
