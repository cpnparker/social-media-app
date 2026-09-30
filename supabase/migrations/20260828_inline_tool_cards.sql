-- Cards drawn by inline tools live on the assistant message that drew them.
--
-- The score, the page audit and the writer draft each render a card beside the
-- reply, and the reply is deliberately written NOT to repeat what the card
-- says. Held only in the browser, that pairing breaks on reload: the numbers
-- vanish and the surviving sentence refers to a card nobody can see.
--
-- One generic column rather than one per tool. All three produce at most one
-- card per turn, all three want the same fate on reload, and a third
-- `*_draft` column would mean a third save site and a third hydrate site to
-- keep in step. `slides_draft` stays as it is: it is edited and published
-- after the fact, so it is state, not a record of what was shown.
--
-- Shape: { kind, data }. `kind` names the tool ("content_score"); `data` is
-- that card's own payload, versioned by nothing — a card whose shape has moved
-- on should be dropped by the reader rather than migrated, because it is a
-- record of what was on screen that day.

alter table intelligence.ai_messages
  add column if not exists tool_card jsonb;

comment on column intelligence.ai_messages.tool_card is
  'Card drawn beside this reply by an inline tool: { kind, data }. Null for every message that drew none.';
