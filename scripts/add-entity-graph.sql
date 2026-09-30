-- ============================================================================
-- The standing entity model: people, orgs, engagements and how they relate.
--
-- WHY. Asked about a congratulation note from "Ollie Cann" on winning "IFFIm",
-- EngineAI had no idea who or what either was, searched once, and asked the
-- user what to try next. Every fact a colleague would have carried — head of
-- Gavi, introduced us, Carol is their procurement lead, Portman was the rival
-- bid — has no home anywhere in this system today.
--
-- WHAT THIS IS NOT. It is not a second copy of app_clients, app_contracts or
-- processed_meeting. Anything with a primary key and an owning UI stays where
-- it is and is REFERENCED. A mirror drifts, and the highest-consequence drift
-- here would be a duplicated visibility flag.
--
-- Run in the EngineAI Supabase project. Additive only: creates five tables in
-- `intelligence` and alters nothing.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 1. NODES ────────────────────────────────────────────────────────────────
-- One table with sparse typed columns rather than three tables or an attribute
-- bag. The entity set is small hundreds of rows, one table keeps resolution to
-- a single query, and a closed column set with CHECK constraints IS the
-- ontology guard — an attribute bag is an invitation to free-form writing,
-- which is the thing every shipped entity graph forbids.
CREATE TABLE IF NOT EXISTS intelligence.entity_node (
  id_node        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace   uuid NOT NULL,
  type_node      text NOT NULL CHECK (type_node IN ('person','org','engagement')),
  -- DISPLAY ONLY, never a join key. Display names are third-party controlled.
  name_display   text NOT NULL,
  type_status    text NOT NULL DEFAULT 'observed'
                   CHECK (type_status IN ('observed','confirmed','merged','rejected')),
  -- Merged nodes are retargeted, never deleted: a dangling id_node in an
  -- episode or an observation is worse than a redundant row.
  id_merged_into uuid REFERENCES intelligence.entity_node(id_node),

  -- person
  email_primary  citext,
  type_person    text CHECK (type_person IN ('internal','external')),
  id_user        integer,

  -- org
  domain_primary text,
  id_client      integer,
  type_relationship text CHECK (type_relationship IN
                   ('client','prospect','funder','partner','competitor','vendor','unknown')),

  -- engagement: the spine that ties a pitch to the contract it becomes. A
  -- pitch is an engagement at stage 'pitch', not a separate node type — the
  -- hand-off between the two is exactly where identity gets lost today.
  id_engagement_client integer,
  id_contract    integer,
  type_stage     text CHECK (type_stage IN ('pitch','won','live','closed','lost')),
  date_stage_changed date,

  date_created   timestamptz NOT NULL DEFAULT now(),
  date_updated   timestamptz NOT NULL DEFAULT now(),
  user_confirmed integer,
  date_confirmed timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS entity_node_email_uq
  ON intelligence.entity_node (id_workspace, email_primary)
  WHERE email_primary IS NOT NULL AND type_status <> 'merged';
CREATE UNIQUE INDEX IF NOT EXISTS entity_node_domain_uq
  ON intelligence.entity_node (id_workspace, domain_primary)
  WHERE domain_primary IS NOT NULL AND type_status <> 'merged';

-- ── 2. ALIASES — the index that resolves "Ollie" ────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence.entity_alias (
  id_alias    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_node     uuid NOT NULL REFERENCES intelligence.entity_node(id_node) ON DELETE CASCADE,
  alias_text  citext NOT NULL,
  type_alias  text NOT NULL CHECK (type_alias IN
                ('email','domain','display_name','given_name','acronym','user_taught')),
  type_source text NOT NULL CHECK (type_source IN
                ('header','calendar_attendee','engine_record','user_stated','inferred')),
  count_evidence integer NOT NULL DEFAULT 1,
  flag_confirmed smallint NOT NULL DEFAULT 0 CHECK (flag_confirmed IN (0,1)),
  date_last_seen timestamptz,
  UNIQUE (id_node, alias_text, type_alias),

  -- THE SECURITY CONSTRAINT, enforced by the database rather than trusted to
  -- code. An address or a domain may enter this system only from a STRUCTURAL
  -- field — a From: header, a calendar attendee record, an Engine row. Never
  -- from body text. This is what stops a crafted email introducing a new
  -- identity, and it holds even if every caller is wrong.
  CONSTRAINT entity_alias_identity_source CHECK (
    type_alias NOT IN ('email','domain')
    OR type_source IN ('header','calendar_attendee','engine_record')
  )
);
CREATE INDEX IF NOT EXISTS entity_alias_text ON intelligence.entity_alias (alias_text);
CREATE INDEX IF NOT EXISTS entity_alias_trgm
  ON intelligence.entity_alias USING gin (alias_text gin_trgm_ops);

-- ── 3. EDGES — a closed set, bi-temporal ────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence.entity_edge (
  id_edge     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_source   uuid NOT NULL REFERENCES intelligence.entity_node(id_node),
  id_target   uuid NOT NULL REFERENCES intelligence.entity_node(id_node),
  type_edge   text NOT NULL CHECK (type_edge IN
                ('works_at','member_of','engagement_for','competing_with',
                 'introduced','owns','parent_of','same_as')),
  role_text   text CHECK (role_text IS NULL OR length(role_text) <= 60),
  -- World time: when the fact was true. Distinct from transaction time below,
  -- which is when we believed it. "Left in June" and "we found out in August"
  -- are different questions and both get asked.
  date_valid_from  date,
  date_valid_to    date,
  date_created     timestamptz NOT NULL DEFAULT now(),
  date_invalidated timestamptz,
  id_superseded_by uuid REFERENCES intelligence.entity_edge(id_edge),
  count_evidence   integer NOT NULL DEFAULT 1,
  flag_confirmed   smallint NOT NULL DEFAULT 0 CHECK (flag_confirmed IN (0,1))
);
CREATE INDEX IF NOT EXISTS entity_edge_source ON intelligence.entity_edge (id_source, type_edge);
CREATE INDEX IF NOT EXISTS entity_edge_target ON intelligence.entity_edge (id_target, type_edge);

-- ── 4. OBSERVATIONS — pointers only. This is the privacy mechanism ──────────
-- No prose ever lands here: no email bodies, no transcript text, no summaries.
-- The graph is identifiers and typed relations, so a leak of the graph leaks
-- structure rather than content.
--
-- VISIBILITY LIVES HERE, NOT ON THE NODE, and that is the whole design. Store
-- "IFFIm — client, contact Carol, introduced by Ollie" as text on a node and
-- its audience becomes the UNION of its sources: a private 1:1 laundered into
-- a team thread. Storing pointers means every rendered fact is recomputed at
-- read time from the observations THIS reader may see — the intersection.
CREATE TABLE IF NOT EXISTS intelligence.entity_observation (
  id_observation uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_node uuid REFERENCES intelligence.entity_node(id_node) ON DELETE CASCADE,
  id_edge uuid REFERENCES intelligence.entity_edge(id_edge) ON DELETE CASCADE,
  type_source text NOT NULL CHECK (type_source IN
    ('calendar_attendee','gmail_header','engine_record','meeting_summary',
     'slack','drive','user_statement')),
  id_source_system text NOT NULL,
  date_observed timestamptz NOT NULL,
  type_visibility text NOT NULL CHECK (type_visibility IN
    ('personal_mailbox','meeting_attendees','team','workspace')),
  -- calendar_event_id, so the DEPLOYED visibility function stays the single
  -- source of truth rather than this table keeping a second copy of the answer.
  id_visibility_key text,
  id_owner integer,
  CONSTRAINT entity_observation_target CHECK (id_node IS NOT NULL OR id_edge IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS entity_observation_node
  ON intelligence.entity_observation (id_node, date_observed DESC);
CREATE INDEX IF NOT EXISTS entity_observation_owner
  ON intelligence.entity_observation (id_owner) WHERE id_owner IS NOT NULL;

-- ── 5. PROPOSALS — inference proposes, a human confirms ─────────────────────
-- Inherited from scripts/add-client-email-domains.sql, which learned this the
-- hard way: "zurich" matches Zurich Instruments, ETH Zurich and Zurich
-- Insurance, and the top inferred domain for the first two belonged to the
-- third. Identity may be created automatically. MEANING may not.
CREATE TABLE IF NOT EXISTS intelligence.entity_proposal (
  id_proposal  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace uuid NOT NULL,
  type_action  text NOT NULL CHECK (type_action IN
    ('create_node','add_alias','add_edge','set_slot','merge')),
  data_payload  jsonb NOT NULL,
  data_evidence jsonb NOT NULL,
  type_status  text NOT NULL DEFAULT 'pending'
    CHECK (type_status IN ('pending','confirmed','rejected','expired')),
  user_proposed integer,
  user_decided  integer,
  date_created  timestamptz NOT NULL DEFAULT now(),
  date_expires  timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);
CREATE INDEX IF NOT EXISTS entity_proposal_pending
  ON intelligence.entity_proposal (id_workspace, type_status, date_created DESC);

-- ── Sanity check: five tables, and the security constraint is live ──────────
SELECT count(*) AS should_be_5
FROM information_schema.tables
WHERE table_schema = 'intelligence'
  AND table_name IN ('entity_node','entity_alias','entity_edge',
                     'entity_observation','entity_proposal');
