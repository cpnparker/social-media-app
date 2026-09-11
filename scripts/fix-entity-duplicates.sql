-- ============================================================================
-- Make the entity backfill safe to re-run, and clean up what re-running did.
--
-- entity_observation and entity_edge were written with plain INSERTs, so the
-- backfill was NOT idempotent: each run added a fresh copy of every sighting
-- and every works_at edge. After three runs observations stood at 67,856
-- against 33,928 real sightings, and edges at 1,299 against 433.
--
-- That matters beyond tidiness. count_evidence and sighting counts are how the
-- resolver will rank a match and how a brief says "seen 8 times" — inflated
-- counts are a confident wrong answer, which is the failure mode this whole
-- project exists to remove.
--
-- Run in the EngineAI Supabase project. Deletes duplicates only: every distinct
-- fact survives.
-- ============================================================================

-- 1. Observations: one row per (node, source system, source type, instant).
--    The same person on the same calendar event IS the same observation, no
--    matter how many times the backfill ran.
DELETE FROM intelligence.entity_observation a
USING intelligence.entity_observation b
WHERE a.ctid > b.ctid
  AND a.id_node IS NOT DISTINCT FROM b.id_node
  AND a.id_edge IS NOT DISTINCT FROM b.id_edge
  AND a.type_source = b.type_source
  AND a.id_source_system = b.id_source_system
  AND a.date_observed = b.date_observed;

-- 2. Edges: one row per (source, target, type). Keep the highest evidence
--    count and the earliest creation, then drop the rest.
DELETE FROM intelligence.entity_edge a
USING intelligence.entity_edge b
WHERE a.ctid > b.ctid
  AND a.id_source = b.id_source
  AND a.id_target = b.id_target
  AND a.type_edge = b.type_edge
  AND a.date_invalidated IS NULL AND b.date_invalidated IS NULL;

-- 3. Now enforce it, so no future run can do this again. Both are partial:
--    an invalidated edge is history and must not block its replacement.
-- TWO indexes, not one covering both columns. A unique index treats NULLs as
-- DISTINCT, and id_edge is NULL on every calendar sighting — so a single index
-- over (id_node, id_edge, ...) accepted duplicates happily. Verified: seeded a
-- duplicate against that version and Postgres took it without complaint.
--
-- Postgres 15+ has NULLS NOT DISTINCT, but these two partial indexes need no
-- version assumption: each one's key columns are non-null by its own predicate.
CREATE UNIQUE INDEX IF NOT EXISTS entity_observation_node_uq
  ON intelligence.entity_observation
     (id_node, type_source, id_source_system, date_observed)
  WHERE id_node IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS entity_observation_edge_uq
  ON intelligence.entity_observation
     (id_edge, type_source, id_source_system, date_observed)
  WHERE id_edge IS NOT NULL AND id_node IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS entity_edge_uq
  ON intelligence.entity_edge (id_source, id_target, type_edge)
  WHERE date_invalidated IS NULL;

-- 4. Verify. observations should equal the distinct sighting count (33,928 at
--    the time of writing) and edges the number of people with a known org.
SELECT
  (SELECT count(*) FROM intelligence.entity_observation) AS observations,
  (SELECT count(*) FROM intelligence.entity_edge)        AS edges,
  (SELECT count(*) FROM intelligence.entity_node)        AS nodes,
  (SELECT count(*) FROM intelligence.entity_alias)       AS aliases;
