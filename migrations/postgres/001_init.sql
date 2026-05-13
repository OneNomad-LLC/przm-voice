-- Persona MCP — initial schema for Postgres-backed storage.
--
-- All tables are tenant-scoped via tenant_id. The MCP server selects a
-- single tenant_id from the TENANT_ID env var at startup; queries never
-- run unscoped.

CREATE TABLE IF NOT EXISTS persona_state (
  tenant_id    text PRIMARY KEY,
  profile      jsonb,
  trait_state  jsonb,
  proposals    jsonb,
  active_role  text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS persona_signals (
  id          bigserial PRIMARY KEY,
  tenant_id   text NOT NULL,
  signal_type text NOT NULL,
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS persona_signals_tenant_created_idx
  ON persona_signals (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS persona_sessions (
  id          bigserial PRIMARY KEY,
  tenant_id   text NOT NULL,
  summary     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS persona_sessions_tenant_created_idx
  ON persona_sessions (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS persona_soul (
  tenant_id text NOT NULL,
  name      text NOT NULL,
  content   text NOT NULL,
  PRIMARY KEY (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS persona_journal (
  tenant_id  text NOT NULL,
  name       text NOT NULL,
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS persona_roles (
  tenant_id text NOT NULL,
  name      text NOT NULL,
  content   text NOT NULL,
  PRIMARY KEY (tenant_id, name)
);
