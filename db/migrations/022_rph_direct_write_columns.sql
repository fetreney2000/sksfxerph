-- ============================================================================
-- eRPH ▸ MIGRATION 022 - columns the direct-write API reads on rph_document
-- ============================================================================
-- Run AFTER 001a/001b/002/…/021. Safe to run more than once.
--
-- The offline sync RPC never selected these through PostgREST, so a database
-- that skipped a migration kept working: the old editor read its own Dexie
-- copy and `sync_rph` carried the columns inside its function body. The
-- direct routes (`GET/POST /api/rph`, `PATCH /api/rph/[id]`) select the table
-- itself, and a missing column fails every one of them with PostgREST 42703
-- `undefined_column` - the list loads nothing and no save goes through.
--
-- Every statement below is IF NOT EXISTS (or guarded), so running it on a
-- database that already has the columns changes nothing. Run the whole file
-- once in the Supabase SQL editor, then retry the app.

-- ▸ 1 ▸ every column the direct routes touch ──────────────────────────────────
alter table erph.rph_document
  add column if not exists class_ids uuid[],
  add column if not exists slot_time time not null default '07:30',
  add column if not exists slot_time_end time not null default '12:40',
  add column if not exists version int not null default 1,
  add column if not exists client_updated_at timestamptz not null default now(),
  add column if not exists content_hash text,
  add column if not exists submitted_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists grade smallint,
  add column if not exists reviewed_by uuid references erph.user(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- ▸ 2 ▸ carry the pre-multi-class rows across ─────────────────────────────────
-- A database from before 001b filed one class per plan in `class_id`. Those
-- rows would otherwise come back with no classes at all; where that column
-- exists, fold it into the array form the app reads. Where it never existed,
-- the guard skips the whole step.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'erph'
       and table_name = 'rph_document'
       and column_name = 'class_id'
  ) then
    execute
      'update erph.rph_document set class_ids = array[class_id] ' ||
      'where class_ids is null and class_id is not null';
  end if;
end $$;

-- ▸ 3 ▸ the one-live-plan-per-slot index ──────────────────────────────────────
-- The editor's clash check assumes this: without it two presses can file the
-- same slot twice instead of the second one finding the first. If this
-- statement reports existing duplicates, leave it out and deduplicate first -
-- the app works without it, it just cannot catch a double-submit by itself.
create unique index if not exists rph_document_uniq
  on erph.rph_document (owner_id, class_ids, subject_code, session, week_no, plan_date)
  where deleted_at is null;
