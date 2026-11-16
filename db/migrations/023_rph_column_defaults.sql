-- ============================================================================
-- eRPH ▸ MIGRATION 023 - defaults the direct-write API relies on
-- ============================================================================
-- Run AFTER 022. Safe to run more than once.
--
-- 022 added columns that were entirely missing, but its ADD COLUMN IF NOT
-- EXISTS leaves columns that already exist untouched - including ones created
-- NOT NULL without a default. The old `sync_rph` sent `client_updated_at`
-- explicitly on every write, so a default-less column never bit; the direct
-- POST omits it and the first save dies with 23502 `not_null_violation`.
--
-- Belt (the route now sends the timestamp explicitly) and suspenders (the
-- defaults below, so no future writer trips on the same gap).

alter table erph.rph_document
  alter column client_updated_at set default now(),
  alter column version set default 1,
  alter column status set default 'draft',
  alter column payload set default '{}'::jsonb,
  alter column payload_version set default 1,
  alter column slot_time set default '07:30',
  alter column slot_time_end set default '12:40',
  alter column created_at set default now(),
  alter column updated_at set default now();
