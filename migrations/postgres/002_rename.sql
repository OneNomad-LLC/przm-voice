-- Migration 002: rename persona_state → voice_state and
-- persona_signals → voice_signals to match the adapter and package name.
--
-- Safe to apply against databases created from the original 001_init.sql
-- (which used persona_* names) and also against fresh installs that
-- already used the corrected 001_init.sql (IF EXISTS guards make every
-- statement a no-op when the old name is absent).

ALTER TABLE IF EXISTS persona_state RENAME TO voice_state;
ALTER TABLE IF EXISTS persona_signals RENAME TO voice_signals;
ALTER INDEX IF EXISTS persona_signals_tenant_created_idx
  RENAME TO voice_signals_tenant_created_idx;

-- V-007: add (tenant_id, id DESC) index required for the offset-based
-- FIFO trim DELETE.  The original 001_init.sql only had (tenant_id,
-- created_at DESC); fresh installs get this index from 001_init.sql
-- directly, so IF NOT EXISTS keeps this idempotent.
CREATE INDEX IF NOT EXISTS voice_signals_tenant_id_idx
  ON voice_signals (tenant_id, id DESC);
