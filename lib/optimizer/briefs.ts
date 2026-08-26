/**
 * The brief, and the prompt that turns it into a draft.
 *
 * Phase 1's job is to bake best practice in AT WRITE TIME rather than patch it
 * in during Phase 2. A draft that arrives answer-first, with self-contained
 * sections and honest source placeholders, starts around 30 points higher than
 * one that arrives as generic AI prose — and every one of those points is a
 * suggestion the writer does not have to read, judge and apply by hand.
 *
 * The rules below are the deterministic rubric restated as instructions. That
 * correspondence is deliberate and must be maintained: if Phase 1 is told to
 * do something Phase 2 does not measure, nobody finds out it stopped working;
 * if Phase 2 measures something Phase 1 was never told to do, every draft
 * opens with an avoidable failure and the tool looks like it is nagging.
 */

import type { ClientCanon } from "./client-canon";
import { styleBlock } from "./client-style";
import { sourcesBlock } from "./sources";
import type { OptimizerSource } from "./sources";
import type { ClientStyle } from "./client-style";

export interface OptimizerBrief {
  targetQueries: string[];
  audience: string;
  goal: string;
  lengthBand: string;
  voice: string;
  /**
   * THE ASSIGNMENT LAYER.
   *
   * Everything above is a GEO optimiser's idea of a brief: which queries to
   * rank for, how long, roughly what tone. That is what to aim at, and it is
   * silent on what a commissioning editor actually hands a writer — what this
   * piece is FOR, what it must cover, and what it must not say.
   *
   * All three are optional so every existing session keeps working: a brief
   * written before these existed reads as one with no assignment, which is
   * exactly what it is.
   */
  /** The commission as given — an Engine content unit's brief, or a note. */
  commission?: string;
  /** Points the piece must make. Rendered as requirements, not suggestions. */
  mustInclude?: string[];
  /**
   * Claims, terms or comparisons this piece may not make.
   *
   * The half that matters most and is hardest to recover from: a compliance
   * line, a competitor that may not be named, a claim legal has refused. A
   * writer who does not know is not careless, and a model that is not told
   * will cheerfully produce the forbidden sentence.
   */
  mustAvoid?: string[];
}

export interface GenerationContext {
  title: string;
  format: string;
  platform: string;
  brief: OptimizerBrief;
  canon: ClientCanon | null;
  /**
   * How this client SOUNDS, derived from their own published work.
   *
   * Distinct from `brief.voice`, which is what the writer asked for on THIS
   * piece. The card is the client's standing register; the brief is this
   * assignment. Both can be present, and where they disagree the brief wins
   * because somebody typed it deliberately — which is why the card is emitted
   * first and the brief's voice line after it.
   */
  style?: ClientStyle | null;
  /**
   * Background material this piece is written FROM.
   *
   * Emitted AFTER the canon and the style, and before the structural rules:
   * the canon says what may be asserted about the client, the style says how
   * they sound, and these are the specifics this particular piece draws on.
   */
  sources?: OptimizerSource[];
}

const PLATFORM_NOTES: { [k: string]: string } = {
  chatgpt:
    "Target platform: ChatGPT. It leans on definitional, encyclopaedic writing and often answers without searching at all, so entity clarity and a clean, quotable definition matter more here than freshness.",
  aio: "Target platform: Google AI Overviews. It retains substantial overlap with classic organic ranking, so query-aligned headings and conventional on-page structure carry more weight here.",
  perplexity:
    "Target platform: Perplexity. It cites fresher and structurally rougher pages than the others, so recency signals and specific, current data matter more than polish.",
  balanced: "Target platform: balanced across ChatGPT, AI Overviews and Perplexity.",
};

/**
 * Everything the model needs to know about WHO this is for and WHAT was asked
 * for — the brief, the client's facts, their house style, the background
 * material — with none of the instructions about writing a piece.
 *
 * Split out so the Writer's discussion panel can be grounded by the SAME
 * builder that produced the draft. A second, hand-written description of the
 * client would drift from this one, and the writer would find themselves
 * discussing their article with something that had been told a different story
 * about the audience. The join is unchanged, so the generation prompt this was
 * extracted from is byte-for-byte what it was.
 */
export function buildGroundingBlock(ctx: GenerationContext): string {
  const parts: string[] = [];

  if (ctx.brief.targetQueries.length > 0) {
    parts.push(
      `## The questions this must answer\n\nThese are the queries a buyer types into an AI assistant before they know the brand exists. The piece has to be the best available answer to them:\n` +
        ctx.brief.targetQueries.map((q) => `- ${q}`).join("\n")
    );
  }

  if (ctx.brief.commission) {
    parts.push(`## The commission\n\nThis is what was asked for. Where it and the notes below disagree, this wins:\n\n${ctx.brief.commission}`);
  }

  if (ctx.brief.mustInclude && ctx.brief.mustInclude.length > 0) {
    parts.push(
      `## This piece MUST cover\n\nEvery one of these. A draft missing any of them is not finished:\n` +
        ctx.brief.mustInclude.map((x) => `- ${x}`).join("\n")
    );
  }

  if (ctx.brief.mustAvoid && ctx.brief.mustAvoid.length > 0) {
    // Emitted as a prohibition rather than a preference, and last among the
    // constraints so it is the most recent instruction the model read. These
    // are the lines somebody will have to retract if they appear.
    parts.push(
      `## This piece must NOT say\n\nThese are prohibitions, not preferences. Do not state them, imply them, or work around them with a synonym:\n` +
        ctx.brief.mustAvoid.map((x) => `- ${x}`).join("\n")
    );
  }

  if (ctx.brief.audience) parts.push(`## Audience\n\n${ctx.brief.audience}`);
  if (ctx.brief.goal) parts.push(`## What the reader should take away\n\n${ctx.brief.goal}`);

  parts.push(`## ${PLATFORM_NOTES[ctx.platform] || PLATFORM_NOTES.balanced}`);

  // ── Client grounding ──
  if (ctx.canon && ctx.canon.facts && ctx.canon.facts.length > 0) {
    const facts = ctx.canon.facts
      .map((f) => `- ${f.text}${f.asOf ? ` (${f.source}, ${f.asOf})` : ` (${f.source})`}`)
      .join("\n");
    parts.push(
      `## What we know about ${ctx.canon.clientName}\n\nThese facts come from the client's own record, their uploaded material and shared client meetings. They are the ONLY client-specific facts you may state:\n\n${facts}\n\n` +
        `Refer to the client as "${ctx.canon.brandName}" throughout. Do not introduce other names or abbreviations for them, even ones that seem natural — an assistant reading one section in isolation must be able to tell who it is about, and inconsistent naming fragments that.`
    );
  }

  // The client's standing register, then this assignment's voice note. Order
  // matters: the brief is the later instruction and should read as the
  // adjustment to the house style, not be buried under it.
  //
  // styleBlock ALWAYS returns a block, including when there is no card — a
  // section that appears and disappears between clients changes the prefix
  // length and moves the cache breakpoint, costing a full cache write on every
  // client switch. Shape stable, content variable.
  parts.push(styleBlock(ctx.style || null));
  parts.push(sourcesBlock(ctx.sources || []));
  if (ctx.brief.voice) parts.push(`## Voice for this piece\n\n${ctx.brief.voice}`);

  return parts.join("\n\n");
}

export function buildGenerationPrompt(ctx: GenerationContext): string {
  const parts: string[] = [];

  parts.push(
    `You are writing a piece of content for The Content Engine that is optimised to be retrieved and cited by AI assistants — ChatGPT, Perplexity, Google's AI Overviews — as well as read by a person.`
  );

  parts.push(`## The piece\n\nWorking title: ${ctx.title}\nFormat: ${ctx.format}\nLength: roughly ${ctx.brief.lengthBand} words.`);

  parts.push(buildGroundingBlock(ctx));

  // ── The doctrine. Each rule maps to a criterion in lib/optimizer/rubric.ts ──
  parts.push(`## How to write it

**Open with the answer.** The first paragraph must answer the main question completely, in a way that could be quoted on its own with no surrounding context. Roughly 44% of AI citations are extracted from the first third of a page, so an answer that arrives after a scene-setting preamble is an answer that does not get cited. Do not open with throat-clearing about how important or complex the topic is.

**Follow it with a short key-takeaways block** — two or three bullets, each a complete statement rather than a teaser.

**Use question-shaped section headings** and answer each one in its first sentence or two. A heading followed by a paragraph of context before the answer wastes the extraction slot.

**Write self-contained sections.** Assume each section may be lifted out and quoted alone. Never open a section with "It", "They", "This is why" or "The company" — name the subject. Define the main entity once, early, in a plain copular sentence ("X is a [category] that …").

**Be specific and attribute.** Statistics, named expert quotations and citations to primary sources are the best-evidenced ways to earn a citation. Every number must carry its source IN THE SAME SENTENCE, because the sentence is the unit an assistant quotes — an attribution in the next sentence travels nowhere.

**Never invent a statistic, a source, a quotation or a case study.** If a number would strengthen a claim and you do not have a real one, write the claim without it and mark the gap inline as \`[NEEDS SOURCE: what would go here]\`. A fabricated citation is far worse than a missing one: it is the single fastest way to destroy a client's credibility, and it is the thing this tool exists to prevent, not to automate.

**Date it.** Include a visible publication date line, and prefer current-year data. Do not write "as of 2023" or similar stale currency claims.

**Sentences around 18 words on average.** Vary them, but avoid both academic sprawl and staccato fragments.

**Do not pad.** Length is not a virtue — measured correlation between word count and citation is essentially zero. Cut anything that does not carry information.

**Banned vocabulary**, because it marks text as machine-written: delve, leverage (as a verb), tapestry, seamlessly, game-changer, revolutionise, "elevate your", "unlock the", "in today's fast-paced", "ever-evolving", "navigate the landscape/complexities", and the "it's not just X, it's Y" construction. Use em-dashes sparingly — no more than one per thousand words.

Return the piece as clean markdown: a byline line, a credential line if one is warranted, a dateline, then the content. No preamble, no explanation of what you have written, no closing offer to revise.`);

  return parts.join("\n\n");
}
