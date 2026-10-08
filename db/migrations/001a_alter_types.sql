-- ============================================================================
-- eRPH · MIGRATION 001a — role and status values (RUN ONE LINE AT A TIME)
-- ============================================================================
-- Run BEFORE 001b_schema_delta.sql, and run it by selecting a single line and
-- pressing Run each time. Two Postgres rules make that unavoidable:
--
--   · `alter type ... rename value` refuses to run inside a transaction block,
--     and the SQL editor wraps a pasted script in one.
--   · a value added inside a transaction cannot be used until it commits —
--     001b defines functions that reference `pentadbir` and views that
--     reference `forwarded`, so both must exist before it starts.
--
-- Six lines. Each should report "ALTER TYPE".
-- ============================================================================

alter type erph.member_role rename value 'teacher'     to 'guru_biasa';
alter type erph.member_role rename value 'coordinator' to 'gpk';
alter type erph.member_role rename value 'admin'       to 'guru_besar';
alter type erph.member_role add value if not exists 'pentadbir';
alter type erph.rph_status add value if not exists 'forwarded';
alter type erph.notification_type add value if not exists 'forwarded';
