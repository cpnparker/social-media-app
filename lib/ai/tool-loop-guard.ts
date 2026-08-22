/**
 * The no-progress guard: stop a model calling the same tool over and over.
 *
 * The Gemini and OpenAI chains use createToolLoopGuard() below. The Anthropic
 * and xAI chains keep their own inline copies of the same budget table — they
 * additionally roll a signature back on a RETRYABLE failure (executedToolSigs
 * .delete), which the factory does not model — but every chain now draws its
 * refusal text from repeatedCallNotice / overBudgetNotice here, so the four
 * cannot drift on wording again. Folding the two inline copies onto the factory
 * (by giving it a release() for the retry rollback) is the remaining cleanup;
 * until then this file is the single source for the budgets and the messages,
 * not yet for the loop itself.
 *
 * Two rules, and they do different jobs:
 *   - The same tool with the SAME ARGUMENTS is refused outright. There is no
 *     reading of that call that is not a spiral.
 *   - The same tool with different arguments has a budget. Read-only data tools
 *     get more headroom, because a legitimate multi-part report needs several
 *     pulls and capping those at three made the model fill the rest of a table
 *     with placeholders.
 */

const MAX_CALLS_PER_TOOL = 3;

const READ_ONLY_TOOL_BUDGET: Record<string, number> = {
  query_xero: 8, query_engine: 8, query_meetingbrain: 6, query_drive_docs: 6,
  search_notebook: 6,
  // Four separate reports behind one tool name, so the default cap of 3 makes
  // "how are we tracking, and who is free to take it on" unanswerable — the
  // turn runs out of calls before it runs out of questions.
  query_resourcing: 8,
};

export function toolBudgetFor(name: string): number {
  return READ_ONLY_TOOL_BUDGET[name] ?? MAX_CALLS_PER_TOOL;
}

export function repeatedCallNotice(name: string): string {
  return `You already called ${name} with these exact arguments this turn — the result is above. Do NOT call it again. Answer the user now with what you have; if the data isn't available, say so plainly. Never promise to run a search or tool you cannot actually run.`;
}

export function overBudgetNotice(name: string): string {
  return `You have called ${name} too many times this turn. Stop calling it and answer now. IMPORTANT: report only what you actually retrieved — do NOT fill missing rows or columns with placeholders — no "[not retrieved]", "Not retrieved", "N/A", "TBC" or dashes standing in for figures you never fetched. If a whole column would be placeholders, drop that column and say why underneath the table instead of shipping a column of nothing. Say plainly which parts you could not fetch and why, and mention that many of these tools accept a comma-separated list (or "all") so the rest can be fetched in ONE call next time.`;
}

export interface ToolLoopGuard {
  /** null to run the call; otherwise the text to return as its result. */
  blockFor(name: string, args: unknown): string | null;
}

export function createToolLoopGuard(): ToolLoopGuard {
  const executed = new Set<string>();
  const counts = new Map<string, number>();
  return {
    blockFor(name, args) {
      const sig = `${name}:${typeof args === "string" ? args : JSON.stringify(args ?? {})}`;
      const n = (counts.get(name) || 0) + 1;
      counts.set(name, n);
      if (executed.has(sig)) return repeatedCallNotice(name);
      if (n > toolBudgetFor(name)) return overBudgetNotice(name);
      executed.add(sig);
      return null;
    },
  };
}
