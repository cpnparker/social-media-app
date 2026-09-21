/**
 * The live deck, written into the system prompt so an edit request has the
 * deck to edit.
 *
 * WHY IT IS A FUNCTION AND NOT A TEMPLATE IN THE ROUTE. It used to be built
 * inline in app/api/ai/conversations/[id]/messages/route.ts and appended to the
 * assembled prompt unconditionally, ordering a generate_slides call in every
 * turn that held a deck. Once the capability could be switched off, that made
 * the prompt contradict itself: buildSystemPrompt said generate_slides was
 * "not loaded this turn", and four hundred words later this block told the
 * model to call it. One click on the Image switch in any thread already
 * holding a deck reached that state.
 *
 * A new rule beside a contradicting old one changes nothing — the same
 * doctrine the voice check is built on — so the contradiction had to go, and
 * the check that proves it gone has to read the ASSEMBLED prompt, route
 * appends and all. It cannot do that while the block is a template literal in
 * a route handler it has no way to call. Hence this file:
 * scripts/verify-incident-fixes.ts §17 assembles buildSystemPrompt and then
 * this, the way the route does, and asserts the two never disagree.
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
 * @param opts.generationTools whether generate_slides is REGISTERED this turn
 * @returns the block, or null when there is no deck to describe
 */
export function buildDeckContext(
  draft: DeckDraft | null | undefined,
  opts: { generationTools: boolean }
): string | null {
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

  // TWO FRAMINGS, ONE SPEC. The spec itself STAYS when the switch is off: the
  // off-branch's whole instruction is to do the part that can still be done —
  // the revised slide, written out in the reply — and it cannot do that
  // without the deck in front of it. What is dropped is the order to call a
  // tool that is not there.
  const body = opts.generationTools
    ? `This is the live slide spec. When the user asks to change a slide, call generate_slides with the ` +
      `COMPLETE slides array below, changed ONLY where they asked and every other slide byte-for-byte as ` +
      `it is here — including its resolvedImage, so unchanged pictures are kept. To change a slide's ` +
      `PICTURE, set that slide's image.query to the new subject and REMOVE its resolvedImage so a fresh ` +
      `one is fetched; leave the others' resolvedImage untouched. ` +
      (presentationId
        ? `This deck is already in Drive — pass presentationId "${presentationId}" so the edit updates that file in place. `
        : `This deck is still a preview (not yet in Drive) — omit presentationId. `) +
      `Do not ask the user to paste the deck back; it is right here. Do not refuse an ordinary picture ` +
      `request — depicting a public place, building or landmark is fine.]`
    : `This is the live slide spec, here so you can READ it — quote a slide, answer a question about the ` +
      `deck, or write a replacement slide out in full. Changing the deck is switched off for this ` +
      `conversation (the section above names the switch), so there is nothing to call this turn: do not ` +
      `say the deck has been changed, and do not ask the user to paste it back — it is right here. Write ` +
      `the new or revised slide out in full in your reply, and close with the one line about the switch.]`;

  return head + body + "\n\n```json\n" + JSON.stringify({ title: draft.title, slides: spec }, null, 1) + "\n```";
}
