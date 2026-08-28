/**
 * Talking to Engine AI ABOUT a draft, beside the draft.
 *
 * ── WHY THIS IS NOT A CHAT THREAD ───────────────────────────────────────────
 *
 * Until now "Ask" navigated away to a conversation. That answered the question
 * and lost the point: the writer left the document to ask about the document,
 * came back with prose in another tab, and retyped it. The half of the Writer
 * described as best-in-class is the DISCUSSION, and a discussion you have
 * somewhere else is a different product.
 *
 * So this is a property of the draft, not a place you go. It is stored on the
 * session row, it dies with the document, and it is never listed among the
 * writer's conversations — twelve questions about one article would otherwise
 * bury every real thread they have.
 *
 * ── WHAT IS STABLE AND WHAT IS VOLATILE ─────────────────────────────────────
 *
 * The draft changes on every keystroke; the brief, the client canon, the house
 * style and the background material do not. That split decides the prompt
 * shape, and it is a spend decision rather than a tidiness one: the stable
 * material is the cacheable prefix, so it goes in the SYSTEM block, and the
 * draft rides in the current user turn. Putting the draft in the system block
 * would rewrite the prefix every turn and pay a full cache write each time —
 * the exact fault `lib/ai/prompt-cache` was built to stop.
 *
 * The corollary matters as much: the draft is attached to the CURRENT turn only
 * and stripped from history. A conversation that kept each turn's copy would
 * carry ten stale versions of the same article, growing the prompt by the
 * length of the piece per question asked, and inviting the model to answer
 * against a version the writer has since rewritten.
 *
 * ── TEXT FOR THE DRAFT IS MARKED, NOT GUESSED ───────────────────────────────
 *
 * A reply mixes two things: talk about the writing, and words meant to go IN
 * the writing. The panel has to tell them apart to offer an Insert button, and
 * inferring it from prose ("here's a suggestion:") is a guess that fails
 * silently in both directions. So the model marks the second kind with a
 * ```draft fence and everything else is commentary. If it marks nothing, the
 * panel offers nothing — no button is better than a button that pastes an
 * explanation into somebody's article.
 */

import { HOUSE_STYLE_RULE } from "./house-style";
import type { Lens } from "./mark-policy";

/** Kept in the prompt. Twelve messages is six exchanges — enough to hold a
 *  thread of argument, bounded because every turn is paid for on every later
 *  turn. */
export const DISCUSS_PROMPT_TURNS = 12;
/** Kept on the row. Longer than the prompt window on purpose: the writer can
 *  scroll back through a conversation the model has stopped being shown. */
export const DISCUSS_STORED_TURNS = 40;
/** The draft is sent whole each turn; past this it is sent in part, and said so. */
export const DISCUSS_MAX_DRAFT_CHARS = 24000;
/** One question. Long enough to paste a paragraph and ask about it. */
export const DISCUSS_MAX_QUESTION = 4000;

export interface DiscussTurn {
  role: "user" | "assistant";
  content: string;
  at: string;
  /**
   * Which ```draft blocks in this turn the writer has waved away, by their
   * index among the turn's segments.
   *
   * Persisted rather than held in the panel, because the point of dismissing a
   * suggestion is that it stays gone. Addressed by `at` from the client, since
   * the array position shifts every time the conversation passes its storage
   * cap and the oldest turn falls off the front.
   */
  dismissed?: number[];
}

/**
 * Coerce whatever is in config_chat into turns.
 *
 * Written defensively because the column is jsonb with a '[]' default and no
 * shape enforcement — a half-written row must degrade to an empty conversation
 * rather than throwing inside a render.
 */
export function readTurns(raw: any): DiscussTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: DiscussTurn[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (!t || typeof t !== "object") continue;
    const role = t.role === "assistant" ? "assistant" : t.role === "user" ? "user" : null;
    if (!role) continue;
    const content = typeof t.content === "string" ? t.content : "";
    if (!content) continue;
    // Validated, not trusted: this column has no shape enforcement, and a
    // non-integer here would index into the segment list and render nothing
    // while looking like a dismissal that failed.
    const dismissed = Array.isArray(t.dismissed)
      ? t.dismissed.filter((n: any) => typeof n === "number" && Number.isInteger(n) && n >= 0)
      : undefined;
    out.push({
      role,
      content,
      at: typeof t.at === "string" ? t.at : "",
      ...(dismissed && dismissed.length ? { dismissed } : {}),
    });
  }
  return out;
}

/**
 * Trim for storage, keeping the END.
 *
 * Slicing from the front would drop the most recent exchange, which is the one
 * the writer is reading.
 */
export function trimForStorage(turns: DiscussTurn[]): DiscussTurn[] {
  return turns.length <= DISCUSS_STORED_TURNS ? turns : turns.slice(turns.length - DISCUSS_STORED_TURNS);
}

/**
 * The turns that go in the prompt.
 *
 * Must begin with a USER turn: every provider this app routes to rejects or
 * mishandles a messages array that opens on an assistant turn, and a naive tail
 * slice produces one exactly half the time. The failure is a 400 on an
 * otherwise valid conversation, which reads to the writer as "the assistant is
 * broken" at a random point in a working session.
 */
export function trimForPrompt(turns: DiscussTurn[]): DiscussTurn[] {
  let out = turns.length <= DISCUSS_PROMPT_TURNS ? turns.slice() : turns.slice(turns.length - DISCUSS_PROMPT_TURNS);
  while (out.length > 0 && out[0].role !== "user") out = out.slice(1);
  return out;
}

/**
 * The stable, cacheable half: who the model is and what it is writing for.
 *
 * Deliberately takes the SAME grounding blocks the generation prompt uses,
 * built by the same functions. A second, hand-written description of the client
 * would drift from the one that produced the draft — and the writer would be
 * discussing their article with something that had been told a different story
 * about the audience.
 */
export function buildDiscussSystem(opts: {
  title: string;
  format: string;
  grounding: string;
  /**
   * WHICH MARKS THIS PIECE IS GETTING, told to the conversation.
   *
   * The marks layer has decided this for every piece since mark-policy.ts
   * landed: a cover letter, a CV or any piece whose writer switched the
   * answer-engine checks off is judged as writing, not as something an
   * assistant should cite. The conversation was never told, so it went on
   * talking about retrieval and citability over a private letter to one hiring
   * manager, and the model had to talk its way out of the frame the product had
   * given it. Observed on a real piece: "a 38 here isn't a verdict on the
   * writing, it's a mismatch of tool to task."
   *
   * Absent means engine, which is what every caller did before this existed.
   */
  lens?: Lens;
}): string {
  const plain = opts.lens === "plain";
  return (
    `You are Engine AI, working with a writer on a piece they are drafting. ` +
    `You are looking at the draft with them.\n\n` +
    (plain
      ? `# What this piece is being judged as\n` +
        `THIS PIECE IS NOT BEING OPTIMISED FOR AI ANSWER ENGINES. Either its kind rules that out, or ` +
        `the writer has switched those checks off. Judge it as writing, for the person who will actually ` +
        `read it.\n` +
        `Do not raise retrieval, citability, being quoted by an assistant, schema, target queries, ` +
        `answer-first openings or a TL;DR block. Do not quote or reason about an optimisation score: ` +
        `the number is not measuring this piece, and repeating it lends it an authority it does not have. ` +
        `If the writer asks about the score, say plainly that the rubric does not fit this kind of ` +
        `document and offer to read it on its own terms instead.\n` +
        `What DOES apply: whether it makes its case, whether the evidence is specific, whether the ` +
        `opening earns the reader's attention, whether it is clear, and whether anything in it is vague, ` +
        `unsupported or repeated.\n\n`
      : "") +
    `# How to be useful here\n` +
    `Answer the question actually asked. If they ask what is wrong with a paragraph, say what is wrong ` +
    `with it. Do not rewrite it unasked. If they ask for a rewrite, give the rewrite.\n` +
    `Be specific to THIS draft: quote the line you mean. General writing advice is worthless to someone ` +
    `who has a real paragraph in front of them.\n` +
    `Disagree when you disagree. A writer asking "is this opening any good?" is better served by "no, and ` +
    `here is why" than by encouragement.\n` +
    `Keep commentary short. You are a voice beside the page, not an essay about it.\n\n` +
    `# Pointing at a passage\n` +
    `When a point you make is ABOUT a particular passage, put that passage, verbatim from the draft, ` +
    `nothing else, no ellipsis, one or two sentences at most, in a fenced block marked \`\`\`anchor, ` +
    `immediately BEFORE the point it concerns. It becomes a link the writer can click to jump straight there.\n` +
    `Copy it exactly as it appears in the draft. A near-miss cannot be found and the link is dropped.\n` +
    `Only where you mean a specific passage. A point about the piece as a whole, its shape, what it is ` +
    `missing, the order of its argument, has nothing to underline, and inventing a passage for it would ` +
    `send the writer to the wrong place with a confident label on it. Say those as ordinary prose.\n\n` +
    `# Text meant FOR the draft\n` +
    `When you offer words to go INTO the piece, whether a rewritten sentence, a new paragraph or a better heading, ` +
    `put exactly those words inside a fenced block marked \`\`\`draft, and nothing else inside it. ` +
    `No preamble, no "here's a version:", no commentary. The writer's editor inserts that block verbatim ` +
    `at one click, so anything in it that is not the piece ends up in the piece.\n` +
    `Everything else, meaning your reasoning, your options and your questions back, goes outside the fence as ordinary prose.\n` +
    `Offer replacement text only for the passage under discussion. Do not restate the whole piece unless ` +
    `you are explicitly asked to rewrite the whole piece.\n` +
    `If your answer is only commentary, use no fence at all. A fence is a button in their interface, ` +
    `and a button that inserts an explanation into an article is worse than no button.\n\n` +
    `${HOUSE_STYLE_RULE}\n\n` +
    `# The piece\n` +
    `Title: ${opts.title || "Untitled"}\n` +
    `Format: ${opts.format || "article"}\n\n` +
    opts.grounding
  );
}

/**
 * The volatile half: the draft as it stands, and the passage they have selected.
 *
 * A selection is the difference between "this is vague" and "WHAT is vague".
 * It is quoted separately as well as being present in the draft, because a
 * model asked about "this paragraph" with no marker will pick one, and picking
 * the wrong paragraph produces a confident answer about the wrong text — the
 * failure mode that reads as the tool being stupid rather than uninformed.
 */
export function buildDiscussTurn(opts: {
  draftText: string;
  selection: string | null;
  question: string;
}): string {
  const draft = String(opts.draftText || "").trim();
  let draftPart: string;
  if (!draft) {
    draftPart = `The piece is empty so far — nothing has been written yet.`;
  } else if (draft.length > DISCUSS_MAX_DRAFT_CHARS) {
    // Said, not silent. A model answering about "the ending" when it was shown
    // only the first two-thirds gives an answer that is wrong in a way neither
    // party can see.
    draftPart =
      `# The draft so far (TRUNCATED — you are seeing the first ${DISCUSS_MAX_DRAFT_CHARS} characters ` +
      `of ${draft.length}. If the question is about a later part, say that you cannot see it.)\n` +
      draft.slice(0, DISCUSS_MAX_DRAFT_CHARS);
  } else {
    draftPart = `# The draft so far\n${draft}`;
  }

  const sel = String(opts.selection || "").trim();
  const selPart = sel
    ? `\n\n# The passage they have selected\nThey are asking about THIS text specifically:\n"""\n${sel.slice(0, 4000)}\n"""`
    : "";

  return `${draftPart}${selPart}\n\n# Their question\n${String(opts.question || "").trim()}`;
}

/** One piece of a reply, in the order the model wrote it. */
export interface DiscussSegment {
  type: "text" | "draft" | "anchor";
  text: string;
  /**
   * The passage this segment is about, verbatim from the draft.
   *
   * The model already quotes the line it means — the system prompt tells it to,
   * and it does. What it could not do was give that quote an ADDRESS: a reply
   * saying "the AuthorityOn.ai paragraph is buried sixth" is a precise,
   * actionable observation with no way to act on it. This carries the quote so
   * the panel can offer to jump to it, and so a rewrite can replace THAT
   * passage rather than whatever happens to be selected.
   *
   * Structured from what the model already writes — not generated. An anchor it
   * had to invent would be an anchor that points somewhere plausible and wrong.
   */
  anchor?: string;
}

export interface DiscussReply {
  /**
   * The reply IN ORDER. This is what a panel must render.
   *
   * The flat {commentary, drafts} shape below came first and was wrong on
   * screen in a way no assertion caught: a reply shaped
   * prose → block → prose rendered as all-prose-then-all-blocks, so a sentence
   * ending "delete the setup and you lose nothing:" pointed at nothing, and the
   * sentence after the block ("that's still a soft landing") referred back to
   * something the reader had not reached yet. Both of the obvious properties
   * held — the block was not duplicated in the prose, and the prose after it
   * survived — while the ORDER, which is the only thing that made the reply
   * readable, was silently destroyed. Found by reading the screen, not by a
   * check.
   */
  segments: DiscussSegment[];
  /** Prose only, fences removed. Derived — never a rendering order. */
  commentary: string;
  /** Text offered for the document, in order. Derived. */
  drafts: string[];
}

/**
 * Split a reply into what to read and what to insert.
 *
 * Only ```draft fences count. A model writing a ```json or ```html example is
 * illustrating something, not offering it for the article, and treating every
 * fence as insertable would put example code in somebody's blog post.
 *
 * An UNCLOSED fence is treated as commentary rather than as a draft block. That
 * case is not hypothetical: it is every partial reply mid-stream, and the
 * alternative is an Insert button that appears over half a sentence and moves
 * as the rest arrives.
 */
export function parseDiscussReply(text: string): DiscussReply {
  const src = String(text || "");
  const segments: DiscussSegment[] = [];
  let i = 0;

  const pushText = (t: string) => {
    if (t.trim()) segments.push({ type: "text", text: t.trim() });
  };

  while (i < src.length) {
    // Whichever fence comes first. Two kinds now, and scanning for one at a
    // time would silently swallow the other into commentary.
    const dOpen = src.indexOf("```draft", i);
    const aOpen = src.indexOf("```anchor", i);
    const open =
      dOpen < 0 ? aOpen : aOpen < 0 ? dOpen : Math.min(dOpen, aOpen);
    if (open < 0) {
      pushText(src.slice(i));
      break;
    }
    const isAnchor = open === aOpen && (dOpen < 0 || aOpen < dOpen);
    const marker = isAnchor ? "```anchor" : "```draft";
    pushText(src.slice(i, open));
    let bodyStart = open + marker.length;
    const nl = src.indexOf("\n", bodyStart);
    if (nl < 0) {
      // "```draft" with nothing after it: an unclosed fence at the very edge of
      // the stream. Commentary, for now.
      pushText(src.slice(open));
      break;
    }
    bodyStart = nl + 1;
    const close = src.indexOf("```", bodyStart);
    if (close < 0) {
      pushText(src.slice(open));
      break;
    }
    const body = src.slice(bodyStart, close).trim();
    if (body) segments.push({ type: isAnchor ? "anchor" : "draft", text: body });
    i = close + 3;
  }

  const linked = linkAnchors(segments);

  const drafts: string[] = [];
  const proseParts: string[] = [];
  for (let j = 0; j < linked.length; j++) {
    if (linked[j].type === "draft") drafts.push(linked[j].text);
    else proseParts.push(linked[j].text);
  }

  return { segments: linked, commentary: proseParts.join("\n\n"), drafts };
}

/**
 * Fold each anchor into everything it introduces, until the next anchor.
 *
 * An anchor binds FORWARD, because that is how the instruction is written and
 * how a person reads it: here is the passage, here is what I think about it.
 * Binding backwards would attach every anchor to the wrong point and do it
 * PLAUSIBLY — the reply still reads correctly while every Show me and every
 * replacement points one paragraph off.
 *
 * It binds to a RUN, not to one segment, and that is a correction made by
 * watching a real reply. Asked to quote a sentence and improve it, the model
 * wrote three segments: the anchor, its reasoning, then the rewrite. Binding to
 * the immediately-following segment alone gave the anchor to the REASONING and
 * left the rewrite unanchored — so the button offered "Add to the end" and
 * would have appended a replacement paragraph to the foot of the document. The
 * fixture missed it because I wrote the anchor directly before the draft block;
 * the model does not, and had no reason to.
 *
 * An anchor is therefore the SUBJECT of the points that follow it, and it holds
 * until another anchor changes the subject.
 *
 * A trailing anchor with nothing after it is DROPPED rather than kept as text.
 * It is a quote of the writer's own draft; rendering it as commentary shows them
 * their own sentence back with no observation attached to it.
 */
export function linkAnchors(segments: DiscussSegment[]): DiscussSegment[] {
  const out: DiscussSegment[] = [];
  let current: string | null = null;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === "anchor") {
      current = seg.text;
      continue;
    }
    out.push(current ? { ...seg, anchor: current } : seg);
  }
  return out;
}

/**
 * A draft block as HTML for the editor.
 *
 * Escaped first, then given paragraph structure. The order is the point: the
 * model's output is text, and any angle bracket in it — a quoted email address,
 * "<10%", a code sample — would otherwise reach the editor as markup.
 */
export function draftBlockToHtml(block: string): string {
  const escaped = String(block || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const paras = escaped.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return "";
  return paras.map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
}

/**
 * A draft block as INLINE html, for replacing a range inside one paragraph.
 *
 * draftBlockToHtml wraps everything in <p>, which is right when the replacement
 * is its own paragraph and wrong when it is a sentence inside one: Tiptap parses
 * the block-level tag as a block, SPLITS the host paragraph around it, and the
 * writer gets a line break before and after their replaced sentence. Reported
 * on a live cover letter, where replacing one clause broke the paragraph into
 * three.
 *
 * Same escaping discipline as its sibling — escape first, then structure — so a
 * quoted "<10%" cannot reach the editor as markup.
 */
export function draftBlockToInlineHtml(block: string): string {
  return String(block || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim()
    .replace(/\n/g, "<br>");
}
