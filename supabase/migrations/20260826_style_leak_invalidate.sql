-- Client style — invalidate every card derived before the visibility filter.
--
-- RUN BY HAND in the Supabase SQL editor for project dcwodczzdeltxlyepxmc.
-- Safe to run twice.
--
-- WHY. gatherStyleSamples read optimizer_sessions through the SERVICE-ROLE
-- client with no visibility filter, so a style card could be derived from any
-- document in the workspace for that client — including private drafts
-- belonging to somebody else, and documents born in a private conversation
-- (flag_private_source). The card is then shown to the caller and enters the
-- prompt of everything they write for that client.
--
-- The code is fixed. The cards already stored are not: nothing records which
-- documents a card was read from, so there is no way to tell a clean one from a
-- leaky one. The only honest move is to treat them all as suspect and make the
-- next derivation do the work again under the filter.
--
-- Clearing document_voice is not destructive in the way it looks: a card is a
-- DERIVED artefact, reproducible on demand from the client's own writing, and
-- the route re-derives on the next explicit request. The one thing worth losing
-- sleep over is a HAND-EDITED card, because that is a person's own words and
-- not reproducible — so those are preserved, and reported, for a human to
-- decide about.

-- ── 1. What is about to be cleared, and what is being kept ─────────────────
-- Run this FIRST and read it. edited_kept > 0 means somebody hand-wrote a card
-- that may have been seeded from a leaky derivation; those need a person's eye,
-- not a DELETE.
SELECT
  count(*) FILTER (WHERE document_voice <> '' AND document_voice NOT LIKE '%"edited":true%') AS derived_to_clear,
  count(*) FILTER (WHERE document_voice LIKE '%"edited":true%')                              AS edited_kept,
  count(*) FILTER (WHERE document_voice = '')                                                AS already_empty
FROM intelligence.optimizer_client_canon;

-- ── 2. Clear the derived ones ──────────────────────────────────────────────
UPDATE intelligence.optimizer_client_canon
   SET document_voice = '',
       date_refreshed = now(),
       date_updated   = now()
 WHERE document_voice <> ''
   AND document_voice NOT LIKE '%"edited":true%';

-- ── 3. Confirm ─────────────────────────────────────────────────────────────
-- Expect derived_to_clear = 0. Anything left in edited_kept is a hand-written
-- card, deliberately untouched.
SELECT
  count(*) FILTER (WHERE document_voice <> '' AND document_voice NOT LIKE '%"edited":true%') AS derived_to_clear,
  count(*) FILTER (WHERE document_voice LIKE '%"edited":true%')                              AS edited_kept
FROM intelligence.optimizer_client_canon;
