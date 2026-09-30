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
  query_xero: 8, query_engine: 8, query_drive_docs: 6,
  search_notebook: 6,
  // RAISED 6 → 8 on 2026-09-16, after the cap cut two client answers short in
  // one day. Asked to brief a new client, a turn spent its six on the search
  // and three meeting details and then reported the two meetings it never
  // reached as unavailable — one of them "(no recording)" against a 28,563
  // character transcript. That evening, asked to prepare for a kick-off call
  // the next morning, a turn spent six reading the June-to-August history and
  // never reached the three September meetings, including one from that same
  // afternoon that had already settled the agenda.
  //
  // The shape of the tool is why six is short: finding a meeting costs a
  // search, and reading one costs a separate details call, so six calls buy
  // roughly three meetings. A question about a client relationship is a
  // question about more meetings than that. Eight buys four.
  query_meetingbrain: 8,
  // THE WEB IS ITERATIVE TOO, and this is the pair to the subject given back
  // to web_search in lib/ai/tool-activity.ts — the two move together or the
  // notice is wrong in one direction or the other. On the default cap of 3 an
  // ordinary "look these four things up" turn ended over budget, and a warning
  // that fires on most search turns stops being read, which is this repo's own
  // lesson about a check that cries wolf. Six calls is four real questions
  // plus a retry, and only a turn that genuinely ran out now says so.
  web_search: 6,
  // Four separate reports behind one tool name, so the default cap of 3 makes
  // "how are we tracking, and who is free to take it on" unanswerable — the
  // turn runs out of calls before it runs out of questions.
  query_resourcing: 8,
  // A search of the conversation is a cheap DB query, and the model is told to
  // try a DIFFERENT distinctive word when one misses. Capping that at the
  // default 3 gives it barely two attempts, which is how a search tool ends up
  // reporting absence — the exact failure it was added to prevent.
  search_thread: 6,
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

  // NOT read-only, and here on purpose. Building a long deck is a sequence of
  // legitimate calls, not a spiral: one to create it and then a batch of about
  // a dozen slides appended per call, because a single call cannot write out
  // thirty-five slides before it is cut off. At the default cap of three, a
  // 35-slide conversion stopped at 24 and the user had to type "continue" —
  // measured, converting a real client deck. Six covers roughly seventy slides.
  //
  // The other half of the guard still applies: a call with the SAME arguments
  // is refused outright however large the budget, so this cannot become a loop.
  generate_slides: 6,

  // SIXTEEN REPORTS BEHIND ONE NAME, and the first call is always the brand
  // list. At the default 3 an advisory report gets brands, the full report and
  // one more — and a probe of the audit family (brands, audits, audit_reports,
  // audit_report) was cut off at its fourth call, measured 2026-09-06.
  //
  // Raised again to 8 on 2026-09-07: the guidance now MANDATES brands, the full
  // report, score_history and change_ledger for any brand analysis, and asks
  // for recommendations on top — five before a single artefact is built. At 6
  // a request for a report AND a deck spent its whole allowance on the reading
  // and had nothing left for the second deliverable. Same-argument calls stay
  // refused however large the budget, so this cannot become a loop.
  query_authorityon: 8,
};

export function toolBudgetFor(name: string): number {
  return READ_ONLY_TOOL_BUDGET[name] ?? MAX_CALLS_PER_TOOL;
}

/**
 * WHOSE LIMIT WAS HIT. Two clauses, and the split matters more than the words.
 *
 * THE INCIDENT, 2026-09-16 (thumbs-down #7). A turn made 9 query_meetingbrain
 * calls against a budget of 6 and told the user it could not open "the 1
 * September client meeting (no recording)". That meeting sits on his own
 * MeetingBrain record with a 28,563-character transcript, and he personally sat
 * in it. The model could not see WHY its call was refused, so it supplied a
 * reason — and the reason it invented was a fact about the source.
 *
 * `overBudgetNotice` said "Say plainly which parts you could not fetch AND
 * WHY", which is an invitation to do exactly that; `repeatedCallNotice` said
 * "if the data isn't available, say so plainly", which is the same invitation
 * in fewer words. Both are replaced rather than supplemented. The correct
 * wording already existed three functions away in postTaintRefusal, so this is
 * that clause made shared.
 *
 * WHY IT IS TWO CONSTANTS AND NOT ONE. The first draft carried a single clause
 * into all four refusal branches, and in two of them its opening sentence was
 * FALSE. A duplicate-signature refusal reached everything — the result is in
 * the context, a line above — so telling that branch to "say the lookup was cut
 * short" asks for exactly the class of invented statement this work exists to
 * remove. A post-taint refusal of a GENERATOR reached no source at all; a
 * blocked deck build is not a cut-short lookup, which is the same category
 * error the user-facing notice's `dataSubject` gate exists to prevent, made in
 * the model-facing text instead. So the half that is true of every refusal is
 * carried everywhere, and the half about a cut-short lookup is carried only
 * where a lookup really was cut short.
 */
export const DO_NOT_BLAME_THE_SOURCE =
  "Do NOT report it as the source being unavailable, missing, unrecorded, not transcribed or non-existent — you cannot see " +
  "that from a refusal, and what you did not reach may well be there.";

/** The other half: true only where OUR allowance stopped a real lookup. */
export const OUR_LIMIT_CUT_IT_SHORT =
  "The limit that stopped you is OURS, not the source's: name what you did not reach and say the lookup was cut short here.";

export function repeatedCallNotice(name: string): string {
  return `You already called ${name} with these exact arguments this turn — the result is above. Do NOT call it again. Answer the user now with what you have: you already HAVE this result, so do not describe it as something you could not reach. ${DO_NOT_BLAME_THE_SOURCE} Never promise to run a search or tool you cannot actually run.`;
}

/**
 * What a user is told when a round was abandoned mid-stream.
 *
 * A tool call still being written when the stall guard fires is simply gone:
 * nothing ran, nothing threw, and the narration the model had already streamed
 * ("I'll rebuild this as a preview…") was persisted as a complete answer. A
 * user asked for a 35-slide deck, read a confident reply, and got no deck.
 *
 * This is DETERMINISTIC text, not an instruction to the model. The forced final
 * pass is already asked to be honest about what it could not retrieve, and in
 * this case it was not — it cannot see that its own tool call was dropped. The
 * system knows for a fact that the round was abandoned, so it says so itself
 * rather than hoping.
 */
export function stallNotice(toolName?: string): string {
  const what = toolName ? `The \`${toolName}\` call` : "A tool call";
  return (
    `\n\n---\n\n⚠ **This turn was cut off.** ${what} was still being written when it ran out of time, ` +
    `so it never ran and nothing was created. Anything described above as done was not done.\n\n` +
    `Ask again — and if it was a large deck or document, ask for it in parts ("do the first twelve slides, ` +
    `then continue"). A single call that has to write out dozens of slides is what runs out of time; the same ` +
    `deck built in three or four calls goes through.`
  );
}

/**
 * What to do about a stalled round, as a decision rather than as two ifs spread
 * through a streaming loop.
 *
 * Pulled out because the two cases are easy to state and were easy to get
 * wrong: with nothing streamed the turn must be RETHROWN so the provider
 * fallback restarts it cleanly, and with something already streamed it must be
 * KEPT and annotated, because that text is already on the user's screen. The
 * chain had only the first, so the second silently shipped a confident answer
 * over a tool call that never ran.
 */
export interface StallOutcome {
  /** Text to append and stream, or null when there is nothing to say. */
  append: string | null;
  /** Rethrow instead: nothing was shown, so the turn can be restarted. */
  rethrow: boolean;
}

export function stallOutcome(stalled: boolean, textSoFar: string, toolName?: string): StallOutcome {
  if (!stalled) return { append: null, rethrow: false };
  if (!String(textSoFar || "").trim()) return { append: null, rethrow: true };
  return { append: stallNotice(toolName), rethrow: false };
}

/**
 * How many slides a streaming generate_slides call has written so far.
 *
 * A deck takes a minute or more to write out, and for all of it the client
 * used to show one static "Generating presentation…" line — indistinguishable
 * from a stall, which this session has real ones of. The partial JSON is
 * counted as it accumulates and the count streamed to the client, so the user
 * watches slide 14 become slide 15 instead of watching a pulse.
 *
 * `"layout"` keys are the proxy: one per slide in `slides` and in
 * `insertSlides`, and never inside a payload (cards, stats and table rows have
 * no layout field). A slide that omits layout undercounts by one, which is the
 * right direction for a progress figure — it may only ever tick up.
 */
export function slidesWritten(partialJson: string): number {
  if (!partialJson) return 0;
  return (partialJson.match(/"layout"/g) || []).length;
}

export function overBudgetNotice(name: string): string {
  return `You have called ${name} too many times this turn. Stop calling it and answer now. IMPORTANT: report only what you actually retrieved — do NOT fill missing rows or columns with placeholders — no "[not retrieved]", "Not retrieved", "N/A", "TBC" or dashes standing in for figures you never fetched. If a whole column would be placeholders, drop that column and say why underneath the table instead of shipping a column of nothing. Say plainly which parts you could not fetch. ${OUR_LIMIT_CUT_IT_SHORT} ${DO_NOT_BLAME_THE_SOURCE} Mention that many of these tools accept a comma-separated list (or "all") so the rest can be fetched in ONE call next time.`;
}

/** What a turn actually did with one tool. */
export interface ToolUsage {
  name: string;
  /** Times the model asked for it, INCLUDING refused attempts. */
  calls: number;
  /**
   * Refused because the same tool was asked for with the SAME arguments.
   *
   * Costs the user nothing: the result is already in the context, and the model
   * is told so. This is the model asking twice, not a hole in the answer.
   */
  blockedRepeat: number;
  /**
   * Refused because the per-tool budget was spent.
   *
   * This IS a hole: data the answer never saw and cannot know it is missing.
   * The two were one `blocked` field until 2026-09-16, and reviewing the
   * NatureFinance flag meant reconstructing which was which arithmetically
   * against the budget table. Only this one drives the user-facing notice.
   */
  blockedBudget: number;
}

/**
 * THE TURN SAYS ITS OWN LOOKUP WAS CUT SHORT, rather than hoping the model
 * will. Deterministic text, appended and streamed at the end of the turn beside
 * the four notices that already exist.
 *
 * The model cannot see this gap honestly: asked why it had not read two
 * meetings, it volunteered "(no recording)" about a meeting carrying a
 * 28,563-character transcript. A refusal is invisible from inside the answer,
 * so the system states the one thing it knows for a fact — that it stopped
 * itself — and does not ask the model to be honest about something it cannot
 * see. This is the review-1 precedent (the unstarted-conversion notice) applied
 * one level down. 13 turns in the 2026-09-03 to 09-16 window would have carried
 * it.
 *
 * OVER-BUDGET ONLY. A duplicate-signature refusal is the model asking the same
 * question twice and the result is already above it; announcing that would cry
 * wolf on a turn that lost nothing.
 *
 * `subjectOf` is passed in rather than imported so this file stays free of
 * every other module and a check can drive it with its own map. In the app it
 * is dataSubject() from lib/ai/tool-activity.ts, which is null for generators
 * and for tools nobody has mapped — so a notice never names the deck builder
 * as something the turn failed to read.
 */
export function cutShortLookupNotice(
  usage: ToolUsage[] | null | undefined,
  subjectOf: (name: string) => string | null
): string {
  const subjects: string[] = [];
  const used = usage || [];
  for (let i = 0; i < used.length; i++) {
    const u = used[i];
    if (!u || !(u.blockedBudget > 0)) continue;
    const subject = subjectOf(u.name);
    if (!subject || subjects.indexOf(subject) >= 0) continue;
    subjects.push(subject);
  }
  if (!subjects.length) return "";
  const list = subjects.length === 1
    ? subjects[0]
    : `${subjects.slice(0, subjects.length - 1).join(", ")} and ${subjects[subjects.length - 1]}`;
  const source = subjects.length === 1 ? "the source" : "the sources";
  return (
    `\n\n---\n\n⚠ **A lookup was cut short.** This turn ran out of its own allowance for reading ` +
    `${list}, so some of what was asked for was never fetched and the answer above may be missing ` +
    `it. That is a limit at this end, not a gap in ${source} — what was not reached may well be ` +
    // "CAN", not "will", and the ask is qualified. The first draft promised
    // "ask for that part on its own and it will be fetched", which the product
    // does not always keep: the router sends "Summarise the call with Thomas"
    // conversational with no hints at all, while "Summarise the 1 September
    // client meeting" reaches the meeting tools. Routing is frozen pending a
    // separate decision, so the sentence is made true rather than the router
    // made to match it — and naming the thing is the form that demonstrably
    // gets there.
    `there.\n\nAsk for that part on its own, naming what you want — a date, a meeting, a document — and it can be fetched.`
  );
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
  // TWO COUNTERS, NOT ONE WITH A TOTAL BESIDE IT. The two refusals mean
  // opposite things to the user — one costs nothing, the other is data the
  // answer never saw — and a redundant total would be a second source of truth
  // for a number that already has one.
  const repeats = new Map<string, number>();
  const overBudget = new Map<string, number>();
  const sigOf = (name: string, args: unknown) =>
    `${name}:${typeof args === "string" ? args : JSON.stringify(args ?? {})}`;

  return {
    blockFor(name, args) {
      const sig = sigOf(name, args);
      const n = (counts.get(name) || 0) + 1;
      counts.set(name, n);
      const refuse = (map: Map<string, number>, why: string) => {
        map.set(name, (map.get(name) || 0) + 1);
        return why;
      };
      if (executed.has(sig)) return refuse(repeats, repeatedCallNotice(name));
      if (n > toolBudgetFor(name)) return refuse(overBudget, overBudgetNotice(name));
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
        out.push({
          name: names[i],
          calls: counts.get(names[i]) || 0,
          blockedRepeat: repeats.get(names[i]) || 0,
          blockedBudget: overBudget.get(names[i]) || 0,
        });
      }
      return out;
    },
  };
}
