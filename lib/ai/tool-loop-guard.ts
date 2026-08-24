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
  // SEARCHING A MAILBOX IS ITERATIVE, and the contract costs two calls per
  // answer: search returns headers, only report "thread" returns the body. At
  // the default cap of 3 a turn got roughly ONE real attempt, which is not how
  // anyone finds an email — the first guess at a search term rarely hits.
  //
  // The visible cost: asked to confirm a won contract, the model searched once,
  // missed, correctly worked out that the plain client name alone was the query
  // to try, and then ASKED PERMISSION to try it rather than trying it — because
  // it had no calls left. The user had to supply the sender's name from memory
  // before it could find a thread that had been sitting in the mailbox, with
  // the client's name in its subject, the whole time. Asking is what the model
  // does when it cannot act.
  //
  // These four lived in BOTH inline copies and were missing HERE, so until
  // 2026-08-24 the Gemini and OpenAI chains capped them at the default 3.
  // Gmail, calendar and Microsoft are Claude-only and never registered on those
  // chains — but query_slack is not, and it ran there on a third of its
  // intended budget. This file already promised the four chains "cannot drift
  // on wording again"; they drifted on NUMBERS instead, which is why they now
  // share the loop itself rather than only its constants.
  query_gmail: 8, query_slack: 8, query_calendar: 6, query_microsoft: 6,
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

/** What a turn actually did with one tool. */
export interface ToolUsage {
  name: string;
  /** Times the model asked for it, INCLUDING refused attempts. */
  calls: number;
  /** Times the guard refused — duplicate signature or over budget. */
  blocked: number;
}

export interface ToolLoopGuard {
  /** null to run the call; otherwise the text to return as its result. */
  blockFor(name: string, args: unknown): string | null;
  /**
   * Undo the signature record after a RETRYABLE failure.
   *
   * A failed call must not trip the duplicate-signature guard into "answer with
   * what you have" — an honest identical retry is exactly right when the first
   * attempt errored. Both inline copies did this for image generation and the
   * factory could not, which is the single reason the two chains kept their own
   * loops for months. The call COUNT is deliberately not rolled back: a tool
   * failing repeatedly should still exhaust its budget rather than retry for
   * ever.
   */
  release(name: string, args: unknown): void;
  /** What ran this turn, for attribution. Never includes arguments or results. */
  usage(): ToolUsage[];
}

export function createToolLoopGuard(): ToolLoopGuard {
  const executed = new Set<string>();
  const counts = new Map<string, number>();
  const blocked = new Map<string, number>();
  const sigOf = (name: string, args: unknown) =>
    `${name}:${typeof args === "string" ? args : JSON.stringify(args ?? {})}`;

  return {
    blockFor(name, args) {
      const sig = sigOf(name, args);
      const n = (counts.get(name) || 0) + 1;
      counts.set(name, n);
      const refuse = (why: string) => {
        blocked.set(name, (blocked.get(name) || 0) + 1);
        return why;
      };
      if (executed.has(sig)) return refuse(repeatedCallNotice(name));
      if (n > toolBudgetFor(name)) return refuse(overBudgetNotice(name));
      executed.add(sig);
      return null;
    },
    release(name, args) {
      executed.delete(sigOf(name, args));
    },
    usage() {
      const names: string[] = [];
      const it = Array.from(counts.keys());
      for (let i = 0; i < it.length; i++) names.push(it[i]);
      names.sort();
      const out: ToolUsage[] = [];
      for (let i = 0; i < names.length; i++) {
        out.push({ name: names[i], calls: counts.get(names[i]) || 0, blocked: blocked.get(names[i]) || 0 });
      }
      return out;
    },
  };
}
