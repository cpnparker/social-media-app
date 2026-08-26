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
    out.push({ role, content, at: typeof t.at === "string" ? t.at : "" });
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
}): string {
  return (
    `You are Engine AI, working with a writer on a piece they are drafting. ` +
    `You are looking at the draft with them.\n\n` +
    `# How to be useful here\n` +
    `Answer the question actually asked. If they ask what is wrong with a paragraph, say what is wrong ` +
    `with it — do not rewrite it unasked. If they ask for a rewrite, give the rewrite.\n` +
    `Be specific to THIS draft: quote the line you mean. General writing advice is worthless to someone ` +
    `who has a real paragraph in front of them.\n` +
    `Disagree when you disagree. A writer asking "is this opening any good?" is better served by "no, and ` +
    `here is why" than by encouragement.\n` +
    `Keep commentary short. You are a voice beside the page, not an essay about it.\n\n` +
    `# Text meant FOR the draft\n` +
    `When you offer words to go INTO the piece — a rewritten sentence, a new paragraph, a better heading — ` +
    `put exactly those words inside a fenced block marked \`\`\`draft, and nothing else inside it. ` +
    `No preamble, no "here's a version:", no commentary. The writer's editor inserts that block verbatim ` +
    `at one click, so anything in it that is not the piece ends up in the piece.\n` +
    `Everything else — your reasoning, options, questions back — goes outside the fence as ordinary prose.\n` +
    `Offer replacement text only for the passage under discussion. Do not restate the whole piece unless ` +
    `you are explicitly asked to rewrite the whole piece.\n` +
    `If your answer is only commentary, use no fence at all. A fence is a button in their interface, ` +
    `and a button that inserts an explanation into an article is worse than no button.\n\n` +
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
  type: "text" | "draft";
  text: string;
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
    const open = src.indexOf("```draft", i);
    if (open < 0) {
      pushText(src.slice(i));
      break;
    }
    pushText(src.slice(i, open));
    let bodyStart = open + "```draft".length;
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
    if (body) segments.push({ type: "draft", text: body });
    i = close + 3;
  }

  const drafts: string[] = [];
  const proseParts: string[] = [];
  for (let j = 0; j < segments.length; j++) {
    if (segments[j].type === "draft") drafts.push(segments[j].text);
    else proseParts.push(segments[j].text);
  }

  return { segments, commentary: proseParts.join("\n\n"), drafts };
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
