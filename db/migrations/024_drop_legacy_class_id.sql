-- ============================================================================
-- eRPH ▸ MIGRATION 024 - finish the class_id → class_ids swap (020's tail)
-- ============================================================================
-- Run AFTER 022/023. Safe to run more than once.
--
-- 020 converts the single-class column to the array form and drops the old
-- one, but a database that never ran 020 (or stopped partway) still carries
-- `class_id ... not null` beside a nullable `class_ids`. The old sync RPC
-- wrote the singular column, so it never noticed; the direct POST sends only
-- `class_ids`, and every insert dies with 23502 `not_null_violation` on the
-- legacy column. 022 backfilled rows but left the column in place - this file
-- removes it, after carrying any stragglers across first.
--
-- Every step is guarded: on a database 020 already converted, the whole file
-- is a no-op.

-- ▸ 1 ▸ carry stragglers across (020 §1, guarded on the column it reads) ─────
do $$ begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'erph' and table_name = 'rph_document'
       and column_name = 'class_id'
  ) then
    update erph.rph_document
       set class_ids = array[class_id]
     where class_ids is null and class_id is not null;
  end if;
end $$;

-- ▸ 2 ▸ the array form is the real one: not null, 1–30 classes ────────────────
alter table erph.rph_document drop constraint if exists rph_document_class_ids_check;
alter table erph.rph_document alter column class_ids set not null;
alter table erph.rph_document add constraint rph_document_class_ids_check
  check (cardinality(class_ids) between 1 and 30);

-- ▸ 3 ▸ defuse the legacy column ─────────────────────────────────────────────
-- It cannot simply be dropped: the pre-020 RLS policies
-- (`rph_owner_insert`, `rph_owner_update`) still name `class_id`, so
-- DROP COLUMN aborts with 2BP01 unless the policies are rebuilt first - and
-- rebuilding needs functions this database may also predate. That rebuild is
-- out of scope here: the server holds the secret key and bypasses RLS, so the
-- stale policies gate nothing in the app's path. Making the column nullable
-- is enough - nothing writes it any more, and no insert can trip on it.
do $$ begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'erph' and table_name = 'rph_document'
       and column_name = 'class_id' and is_nullable = 'NO'
  ) then
    alter table erph.rph_document alter column class_id drop not null;
  end if;
end $$;
