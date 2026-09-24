-- Slide drafts live on the assistant message that produced them.
--
-- Before this, a rendered deck existed only in the browser that generated it:
-- a reload lost it, and nobody the conversation was shared with could see the
-- deck they were meant to be reviewing before it was created in Drive.
--
-- Shape: { title, slides[], preview{...}, published?{url, presentationId,
-- slideCount, thumbnails[]} }. `published` is set once the user presses
-- "Create in Google Slides", so reopening the thread shows the created deck
-- rather than offering to create it a second time.

alter table intelligence.ai_messages
  add column if not exists slides_draft jsonb;

comment on column intelligence.ai_messages.slides_draft is
  'Rendered-but-unsaved slide deck, plus where it landed once published. Null for every message that is not a deck.';
