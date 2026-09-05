-- Client email domains — the identity join for meetings.
--
-- Target: the EngineAI Supabase project. Run in the SQL Editor.
--
-- WHY. A MeetingBrain meeting carries no client id. The only link between a
-- meeting and a client is the attendee's email DOMAIN, and until now the only
-- domain→client mapping was app_clients.link_website — a MARKETING url being
-- used as an identity key. That fails three ways, all of them live in the data:
--
--   * 5 clients have no website at all, so their meetings can never be matched.
--   * 3 more parse to a subdomain or a path (cybathlon.ethz.ch,
--     alumni.ethz.ch, temasek.com.sg/en/index) that will never equal a plain
--     address domain.
--   * A company mails from domains its website does not mention. VARO Energy's
--     meetings show varoenergy.com AND varopreem.com; one field cannot hold
--     both.
--
-- It has already been patched twice by editing source and deploying — see
-- CLIENT_DOMAIN_ALIASES in lib/ai/providers.ts, which hardcodes hiscox.com and
-- beonemed.com. Three occurrences make it a missing feature, not three
-- data-entry oversights.
--
-- Supabase's linter will flag CREATE TABLE. Purely additive: one new table,
-- nothing altered, nothing backfilled.

CREATE TABLE IF NOT EXISTS intelligence.client_email_domains (
  id_domain       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_client       integer NOT NULL,          -- public.app_clients(id_client)
  domain          text    NOT NULL,          -- lowercase, no scheme, no www, no path

  -- How this row came to exist. 'inferred' rows are PROPOSALS and are ignored
  -- by the join until someone confirms them; see flag_confirmed.
  type_source     text    NOT NULL DEFAULT 'manual'
                    CHECK (type_source IN ('manual', 'inferred', 'alias_migration')),

  -- THE SAFETY GATE. Inference is genuinely useful and genuinely unsafe: the
  -- token "zurich" matches Zurich Instruments, ETH Zurich AND Zurich
  -- Insurance, and the top inferred domain for the first two is zurich.com,
  -- which belongs to the third. Attributing one client's meetings to another
  -- shows confidential material to the wrong account team. So nothing counts
  -- until a person says so.
  flag_confirmed  smallint NOT NULL DEFAULT 0 CHECK (flag_confirmed IN (0, 1)),

  -- Evidence carried alongside the proposal, so confirming is a judgement made
  -- with the reasoning visible rather than a yes/no on a bare string.
  count_evidence  integer,                   -- meetings whose title named this client
  information_note text,                     -- competing candidates, ambiguity warnings

  user_created    integer,
  date_created    timestamptz NOT NULL DEFAULT now(),
  date_confirmed  timestamptz,

  -- One row per client/domain pair. A domain legitimately belonging to two
  -- clients (a shared parent, an agency) is possible, so the uniqueness is on
  -- the PAIR — but the read path treats a domain claimed by more than one
  -- client as AMBIGUOUS and attributes it to neither, exactly as
  -- loadClientDomainMap already does for duplicate websites.
  CONSTRAINT client_email_domains_unique UNIQUE (id_client, domain)
);

CREATE INDEX IF NOT EXISTS idx_client_email_domains_confirmed
  ON intelligence.client_email_domains (domain)
  WHERE flag_confirmed = 1;

COMMENT ON TABLE intelligence.client_email_domains IS
  'Email domains that identify a client, for attributing meetings. Separate from app_clients.link_website, which is a marketing URL and a poor identity key. Rows with flag_confirmed = 0 are PROPOSALS from inference and are ignored by the join until a person confirms them — inference collides on tokens like "zurich" and would otherwise attribute one client''s meetings to another.';


-- ── Sanity check ──
SELECT
  count(*)                                          AS rows_total,
  count(*) FILTER (WHERE flag_confirmed = 1)        AS confirmed,
  count(*) FILTER (WHERE flag_confirmed = 0)        AS awaiting_confirmation,
  count(DISTINCT id_client)                         AS clients_covered
FROM intelligence.client_email_domains;

-- Expect all zeros on a fresh install. Nothing is backfilled: the two
-- hardcoded aliases and any inferred proposals are inserted deliberately,
-- reviewed, and confirmed one at a time.
