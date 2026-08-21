/**
 * The boundary between the cacheable part of a system prompt and the part that
 * changes too fast to cache.
 *
 * Its own module because both sides need it and system-prompts.ts already
 * imports from providers.ts — importing back the other way would close a cycle
 * around a module-level constant, which is the kind of thing that works in dev
 * and is undefined at import time in a production bundle. A duplicated literal
 * in two files would have been the other option, and duplicated constants
 * drifting apart is a mistake this codebase has already paid for today.
 *
 * WHY IT EXISTS. The whole system string was wrapped in one cache_control
 * block, and a minute-resolution clock was interpolated about six thousand
 * characters in. A cached prefix is matched byte for byte, so a prefix that
 * changes every minute is a prefix that is never reused — and because the
 * breakpoint covers everything before it, the loss was not the timestamp, it
 * was the entire ~100KB of instructions behind it, on every turn of every
 * conversation.
 *
 * THE RULE: anything that changes faster than the cache TTL goes at the END of
 * the prompt, behind this marker. Putting volatile content in the middle does
 * not cost you that fragment. It costs you everything after it.
 */
export const VOLATILE_MARKER = "\n\n<<<ENGINEAI_VOLATILE>>>\n\n";
