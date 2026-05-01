-- AI Control Centre: per-service model overrides.
--
-- Lets the Control Centre swap a service's model without a code change.
-- Each row says "for app X service Y when calling provider P, use model M
-- instead of the code default."

CREATE TABLE IF NOT EXISTS intelligence.model_overrides (
  app text NOT NULL,
  type_source text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (app, type_source, provider)
);
