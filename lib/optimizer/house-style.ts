/**
 * One house style for every piece of text this app offers to put in someone's
 * document, and one detector for when it has not been followed.
 *
 * ── WHY IT IS ONE CONSTANT ──────────────────────────────────────────────────
 *
 * Five separate surfaces generate text destined for a writer's piece: the
 * Writer's first draft, the Discuss panel's ```draft blocks, the "add a fact"
 * expansions, the judge's suggestedEdit replacements, and the span rewrites
 * behind a suggestion. Written five times, the rule would hold in three of them
 * within a month. Written once and asserted present in every ASSEMBLED prompt,
 * it holds or the check goes red.
 *
 * ── WHY THE PROMPTS THEMSELVES HAD TO CHANGE ────────────────────────────────
 *
 * A ban on em dashes, written with em dashes, is the same mistake this repo has
 * made before and written down: a new rule sitting beside a contradicting old
 * one changes nothing, because the model reads both. Every prompt that carries
 * this rule is asserted to contain no em dash of its own. The instruction is
 * the smaller half of that; the example is the larger.
 *
 * ── WHY NOTHING IS REWRITTEN AUTOMATICALLY ──────────────────────────────────
 *
 * `mechanicalDedash` exists and is deliberately never called on text that goes
 * into a document unseen. There is no substitution for an em dash that is
 * always right: a comma after an independent clause is a comma splice, a colon
 * before one is usually wrong, and a semicolon before a fragment is wrong the
 * other way. The transform is offered to the WRITER, in an editable box, where
 * a wrong guess costs a glance instead of shipping a broken sentence.
 */

/**
 * The stock phrases, chosen for one property: a human writing about this
 * subject would not reach for them by accident.
 *
 * Mostly multi-word, because single words are where a ban starts eating real
 * writing. "Landscape" is a trope in "the ever-changing landscape" and an
 * ordinary noun in "landscape architecture", so the phrase is listed and the
 * word is not. Anything that failed that test is in the comment below rather
 * than in the list: robust, seamless, leverage, elevate, unlock, empower,
 * crucial, vital, foster, realm, myriad. Each is a genuine tell in aggregate
 * and a false positive one sentence at a time, and a detector that cries wolf
 * teaches a writer to ignore it.
 */
export const AI_TROPES: { pattern: RegExp; label: string }[] = [
  { pattern: /\bdelve[sd]? into\b/i, label: "delve into" },
  { pattern: /\bdive[sd]? into\b/i, label: "dive into" },
  { pattern: /\bin today'?s (fast[- ]paced|digital|ever[- ]changing)\b/i, label: "in today's fast-paced…" },
  { pattern: /\bin an era (where|of)\b/i, label: "in an era where…" },
  { pattern: /\bever[- ](evolving|changing|shifting) landscape\b/i, label: "ever-evolving landscape" },
  { pattern: /\b(a|is a) testament to\b/i, label: "a testament to" },
  { pattern: /\bnavigat(e|ing) the (complexities|challenges|landscape)\b/i, label: "navigating the complexities" },
  { pattern: /\b(unlock|harness|unleash)(ing)? the (power|potential)\b/i, label: "unlock the power" },
  { pattern: /\bgame[- ]chang(er|ing)\b/i, label: "game-changer" },
  { pattern: /\bat the end of the day\b/i, label: "at the end of the day" },
  { pattern: /\bthe world of\b/i, label: "the world of" },
  { pattern: /\bin conclusion\b/i, label: "in conclusion" },
  { pattern: /\bmoreover\b/i, label: "moreover" },
  { pattern: /\bfurthermore\b/i, label: "furthermore" },
  { pattern: /\bcutting[- ]edge\b/i, label: "cutting-edge" },
  { pattern: /\bstands? as a\b/i, label: "stands as a…" },
  // Structural tells, which survive a synonym swap that kills every phrase above.
  { pattern: /\b(is|it'?s|isn'?t|they'?re|we'?re) not (just|only|merely) [^.!?]{1,60}[,;] (it'?s|they'?re|but)\b/i, label: "not just X, it's Y" },
  { pattern: /\bnot only [^.!?]{1,60} but also\b/i, label: "not only… but also" },
  { pattern: /\bit'?s worth noting that\b/i, label: "it's worth noting that" },
];

export interface HouseStyleFlags {
  /** How many dash-as-punctuation marks were found. */
  dashes: number;
  /** Which stock phrases were found, by label, in the order listed. */
  tropes: string[];
  clean: boolean;
}

/** What is wrong with a piece of suggested text, if anything. */
export function houseStyleFlags(text: string): HouseStyleFlags {
  const s = String(text || "");
  // Ranges are not punctuation. "2020-2024" and "pages 10–12" are correct as
  // written, and flagging them would train a writer to ignore the flag.
  const dashes = (s.match(/(?<!\d\s?)(--|—|–)(?!\s?\d)/g) || []).length;
  const tropes: string[] = [];
  for (const t of AI_TROPES) if (t.pattern.test(s)) tropes.push(t.label);
  return { dashes, tropes, clean: dashes === 0 && tropes.length === 0 };
}

/**
 * Remove dash punctuation, mechanically, for a human to check.
 *
 * The rules, and what each is worth:
 *   PAIRED dashes around an aside become commas. Always grammatical, because an
 *     aside set off by dashes is an aside set off by commas.
 *   A SINGLE dash becomes a semicolon when what follows is a complete statement
 *     and a colon when it is not. The alternative, a comma everywhere, produces
 *     a comma splice on exactly the sentences models most like to write.
 *   A dash between digits is left alone. It is a range, not punctuation.
 *
 * Never called on text going into a document unseen. See the header.
 */
export function mechanicalDedash(text: string): string {
  return String(text || "")
    .split(/(?<=[.!?])(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : dedashSentence(part)))
    .join("");
}

function dedashSentence(sentence: string): string {
  const re = /(--|—|–)/g;
  const marks: { index: number; len: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence))) {
    // The neighbours are read from the STRING, not from capture groups. An
    // earlier version captured the surrounding whitespace and tested that for
    // digits, so the range guard never fired once and "2020-2024" came out as
    // "2020, 2024" in a check I only caught by printing the output.
    const before = sentence.slice(0, m.index);
    const after = sentence.slice(m.index + m[0].length);
    if (/\d\s*$/.test(before) && /^\s*\d/.test(after)) continue;
    marks.push({ index: m.index, len: m[0].length });
  }
  if (marks.length === 0) return sentence;

  let out = "";
  let cursor = 0;
  for (const mk of marks) {
    let start = mk.index;
    while (start > 0 && /\s/.test(sentence[start - 1])) start--;
    let end = mk.index + mk.len;
    while (end < sentence.length && /\s/.test(sentence[end])) end++;

    const rep =
      marks.length >= 2
        ? ", "
        : hasFiniteVerb(sentence.slice(end))
          ? "; "
          : ": ";
    out += sentence.slice(cursor, start) + rep;
    cursor = end;
  }
  out += sentence.slice(cursor);
  // A dash immediately before existing punctuation leaves ", ," behind.
  return out.replace(/,\s*([,;:.])/g, "$1").replace(/\s+([.!?])/g, "$1");
}

/**
 * Does this clause stand on its own? Used only to choose between a semicolon
 * and a colon.
 *
 * AUXILIARIES AND A FEW UNAMBIGUOUS VERBS ONLY. The first version listed
 * ordinary lexical verbs, and "Three things matter, speed, cost and trust" came
 * back with a semicolon because "cost" is in the list as a verb and in the
 * sentence as a noun. Every word below is one that is almost never a noun, so a
 * false positive needs an unusual sentence rather than a common one.
 */
function hasFiniteVerb(clause: string): boolean {
  return /\b(is|are|was|were|has|have|had|does|did|will|would|can|could|should|must|might|may|isn'?t|aren'?t|wasn'?t|weren'?t|doesn'?t|didn'?t|won'?t|cannot|can'?t)\b/i.test(
    clause.slice(0, 140)
  );
}

/**
 * The rule, as the model receives it.
 *
 * Written without a single dash of its own, which is not a flourish: a rule
 * demonstrating the thing it bans is the contradiction this file's header is
 * about. It also names the replacements, because "do not use X" with no
 * alternative is an instruction a model satisfies by writing a worse sentence.
 */
export const HOUSE_STYLE_RULE =
  `# House style for anything you write FOR the piece\n` +
  `No dashes as punctuation. No em dash, no en dash, no double hyphen. ` +
  `Where you would reach for one, use a comma for an aside, a colon before a list or an explanation, ` +
  `a semicolon between two complete statements, or a full stop and a new sentence. ` +
  `A hyphen inside a compound word is fine, and so is a dash between two numbers in a range.\n` +
  `No stock AI phrasing. Avoid: delve into, dive into, in today's fast paced world, in an era where, ` +
  `the ever evolving landscape, a testament to, navigating the complexities, unlock the power, ` +
  `game changer, at the end of the day, the world of, in conclusion, moreover, furthermore, ` +
  `cutting edge, stands as a, it is worth noting that.\n` +
  `No "it is not just X, it is Y" and no "not only X but also Y". Both are sentence shapes rather than ` +
  `phrases, and they read as generated even when every word in them is different.\n` +
  `Do not open a sentence by restating the question, and do not close a passage by summarising what you ` +
  `just said. Write the way the rest of the piece is written.`;
