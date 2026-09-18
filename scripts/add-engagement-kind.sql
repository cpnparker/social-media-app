-- ============================================================================
-- Engagements that are not client work, and facts a person simply states.
--
-- WHY. The engagement node was built commercial-shaped: its stage enum is
-- pitch | won | live | closed | lost, which is the life of a sale. "Rebuild the
-- clients page" is live or closed and never won, and forcing internal work to
-- masquerade as a sale would put fictional pipeline in a graph whose whole
-- purpose is being trustworthy.
--
-- Chris's framing: this is a knowledge graph of people, relationships,
-- contracts, clients, projects "and the relationship between everything" —
-- proposals with prospects, projects to improve the company internally, and
-- whatever else the work actually consists of. Engine is one source feeding it,
-- not its boundary.
--
-- Run in the EngineAI Supabase project. Additive: two columns and one widened
-- CHECK. No data is altered.
-- ============================================================================

-- 1. WHAT KIND OF THING this engagement is. Separate from its stage, because
--    the two answer different questions: kind is what it IS, stage is where it
--    has got to. Defaulting to client_work keeps all 237 existing rows correct.
ALTER TABLE intelligence.entity_node
  ADD COLUMN IF NOT EXISTS type_engagement_kind text;

ALTER TABLE intelligence.entity_node
  DROP CONSTRAINT IF EXISTS entity_node_engagement_kind_ck;
ALTER TABLE intelligence.entity_node
  ADD CONSTRAINT entity_node_engagement_kind_ck CHECK (
    type_engagement_kind IS NULL
    OR type_engagement_kind IN ('client_work','pitch','internal','partnership','research')
  );

UPDATE intelligence.entity_node
SET type_engagement_kind = 'client_work'
WHERE type_node = 'engagement' AND type_engagement_kind IS NULL AND id_contract IS NOT NULL;

-- 2. WHO SAID SO, for a fact a person stated rather than a system recorded.
--    entity_edge already carries evidence counts and confirmation, but not
--    authorship — and for a stated fact the author IS the evidence.
ALTER TABLE intelligence.entity_edge
  ADD COLUMN IF NOT EXISTS user_stated_by integer;

-- 3. A person or organisation may now be created because someone SAID they
--    exist. This is a real widening and worth being explicit about.
--
--    The existing constraint stays exactly as it was for identity: an email or
--    domain alias may still only come from a structural field, so a sentence
--    typed in chat cannot mint an address. What it may now do is create a node
--    carrying a NAME, which is a much weaker claim — it asserts that a person
--    called this exists and is relevant, not that any address belongs to them.
--
--    Nothing changes in SQL for this; it is recorded here because the rule is
--    the interesting part, and the next person reading this file will want to
--    know it was a decision rather than an oversight.

-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM intelligence.entity_node
    WHERE type_node = 'engagement' AND type_engagement_kind = 'client_work') AS client_work,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='intelligence' AND table_name='entity_edge'
      AND column_name='user_stated_by')                                       AS has_stated_by,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='intelligence' AND table_name='entity_node'
      AND column_name='type_engagement_kind')                                 AS has_kind;
