/**
 * The live deck, written into the system prompt so an edit request has the
 * deck to edit.
 *
 * WHY IT IS A FUNCTION AND NOT A TEMPLATE IN THE ROUTE. It used to be built
 * inline in app/api/ai/conversations/[id]/messages/route.ts and appended to the
 * assembled prompt, which put it out of reach of any check: the block is part
 * of the string the model is sent, and a check that reads buildSystemPrompt
 * alone cannot see what the route staples to the end of it. That is not a
 * hypothetical. For a while the two disagreed outright — buildSystemPrompt
 * said generate_slides was "not loaded this turn" and four hundred words later
 * this block ordered a generate_slides call — and nothing could see it,
 * because the contradiction only existed in the concatenation.
 *
 * IT USED TO TAKE A SECOND FRAMING, for the turns where the capability was
 * switched off: read the deck, quote it, write the revised slide out in full,
 * do not claim a change. That framing is gone with the switch. The five
 * generation tools are now registered on every chat turn, and this block is
 * built on chat turns only, so a deck in the conversation and no generate_slides
 * to change it with is no longer a state the product can reach.
 *
 * The module stays because the reason it exists never was the two framings:
 * scripts/verify-incident-fixes.ts §17 assembles buildSystemPrompt and then
 * this, the way the route does, and holds its invariants on the WHOLE string.
 */

/** The heading the route appends this under. Exported so the check appends the
 *  same one rather than a copy that can drift from it. */
export const DECK_CONTEXT_HEADING = "## The deck in this conversation";

export interface DeckDraft {
  title?: string | null;
  slides?: any[] | null;
  published?: { presentationId?: string | null } | null;
}

/**
 * @param draft   the newest `ai_messages.slides_draft` row, or anything falsy
 * @returns the block, or null when there is no deck to describe
 */
export function buildDeckContext(draft: DeckDraft | null | undefined): string | null {
  if (!draft || !draft.slides || !draft.slides.length) return null;

  // The spec only — not the rendered preview, which the model does not need
  // and which is large. resolvedImage URLs are KEPT so that a slide the model
  // is not changing resends with its exact picture intact.
  const spec = draft.slides.map((sl: any) => {
    const { preview, ...rest } = sl || {};
    return rest;
  });
  const presentationId = draft.published?.presentationId;
  const head = `[THE DECK CURRENTLY IN THIS CONVERSATION — "${draft.title || "Presentation"}", ${spec.length} slides. `;

  const body =
    `This is the live slide spec. When the user asks to change a slide, call generate_slides with the ` +
    `COMPLETE slides array below, changed ONLY where they asked and every other slide byte-for-byte as ` +
    `it is here — including its resolvedImage, so unchanged pictures are kept. To change a slide's ` +
    `PICTURE, set that slide's image.query to the new subject and REMOVE its resolvedImage so a fresh ` +
    `one is fetched; leave the others' resolvedImage untouched. ` +
    (presentationId
      ? `This deck is already in Drive — pass presentationId "${presentationId}" so the edit updates that file in place. `
      : `This deck is still a preview (not yet in Drive) — omit presentationId. `) +
    `Do not ask the user to paste the deck back; it is right here. Do not refuse an ordinary picture ` +
    `request — depicting a public place, building or landmark is fine.]`;

  return head + body + "\n\n```json\n" + JSON.stringify({ title: draft.title, slides: spec }, null, 1) + "\n```";
}
