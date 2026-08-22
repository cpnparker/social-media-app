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

export interface OptimizerBrief {
  targetQueries: string[];
  audience: string;
  goal: string;
  lengthBand: string;
  voice: string;
}

export interface GenerationContext {
  title: string;
  format: string;
  platform: string;
  brief: OptimizerBrief;
  canon: ClientCanon | null;
}

const PLATFORM_NOTES: { [k: string]: string } = {
  chatgpt:
    "Target platform: ChatGPT. It leans on definitional, encyclopaedic writing and often answers without searching at all, so entity clarity and a clean, quotable definition matter more here than freshness.",
  aio: "Target platform: Google AI Overviews. It retains substantial overlap with classic organic ranking, so query-aligned headings and conventional on-page structure carry more weight here.",
  perplexity:
    "Target platform: Perplexity. It cites fresher and structurally rougher pages than the others, so recency signals and specific, current data matter more than polish.",
  balanced: "Target platform: balanced across ChatGPT, AI Overviews and Perplexity.",
};

export function buildGenerationPrompt(ctx: GenerationContext): string {
  const parts: string[] = [];

  parts.push(
    `You are writing a piece of content for The Content Engine that is optimised to be retrieved and cited by AI assistants — ChatGPT, Perplexity, Google's AI Overviews — as well as read by a person.`
  );

  parts.push(`## The piece\n\nWorking title: ${ctx.title}\nFormat: ${ctx.format}\nLength: roughly ${ctx.brief.lengthBand} words.`);

  if (ctx.brief.targetQueries.length > 0) {
    parts.push(
      `## The questions this must answer\n\nThese are the queries a buyer types into an AI assistant before they know the brand exists. The piece has to be the best available answer to them:\n` +
        ctx.brief.targetQueries.map((q) => `- ${q}`).join("\n")
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

  if (ctx.brief.voice) parts.push(`## Voice\n\n${ctx.brief.voice}`);

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
