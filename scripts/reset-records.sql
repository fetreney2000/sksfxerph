-- ============================================================================
-- eRPH ▸ RESET — every plan, every account except the pentadbir's
-- ============================================================================
--
--   ⚠  TAKE A BACKUP FIRST. This cannot be undone.
--      Supabase → Database → Backups → Download snapshot.
--
-- WHAT GOES
--   · every RPH record: documents, revisions, reviews, signatures, exports,
--     templates, and the audit/notification/sync rows that describe them;
--   · every account except the pentadbir's, with their memberships,
--     teaching assignments, notifications and queued sync operations.
--
-- WHAT STAYS
--   · the school, its identity, settings and calendar;
--   · classes, subjects and DSKP standards;
--   · the pentadbir's own account, membership and jawatan.
--
-- WHAT TO CHANGE FIRST
--   · Want to keep the templates?  Comment out the `rph_template` line —
--     they are teacher-made content, not records of a school year.
--   · The account kept is identified by ROLE, not by username, so hold on to
--     whichever row `role = 'pentadbir'` names. Delete the section-3 select
--     and re-run if that is not the one you meant.
--
-- Peraturan 8 of the Akta Pendidikan 1996 makes these statutory records; this
-- script deletes them outright rather than soft-deleting. That is what "start
-- fresh" means, and it is your call — but the backup is not optional.
--
-- Safe to run twice: every statement below is a delete with no rows left to
-- remove the second time.
-- ============================================================================

begin;

-- ── 0 · unlock the append-only tables ───────────────────────────────────────
-- `rph_revision`, `rph_review` and `audit_log` are guarded against DELETE by
-- `erph.forbid_mutation()` — that is what makes them a record rather than a
-- log someone can edit. The guard honours this switch, which is how the
-- five-year retention job clears old rows: set for this transaction only, so
-- it cannot outlive the wipe it is here for. Without it, section 1 stops on
-- the first `delete from erph.audit_log`.
select set_config('app.purge', '1', true);

-- ── 1 · everything that hangs off a plan ─────────────────────────────────────
-- Order matters. `rph_review.reviewer_id` and `rph_signature.signer_id` point
-- at erph.user with no cascade, so a signature has to be gone before the
-- person who made it can be — and `rph_document.owner_id` is the same story.
delete from erph.export_file;    -- rows with document_id NULL are ad-hoc exports
delete from erph.audit_log;
delete from erph.notification;
delete from erph.sync_op;        -- pending sync for accounts that will not exist
delete from erph.rph_template;   -- owner_id is ON DELETE SET NULL, so these would outlive their authors
delete from erph.rph_signature;
delete from erph.rph_review;
delete from erph.rph_revision;
delete from erph.rph_document;   -- the four above also cascade off this

-- ── 2 · every account except the pentadbir ──────────────────────────────────
-- Cascades take school_member, teaching_assignment, notification and sync_op
-- with them; `school_member.supervisor_id` is ON DELETE SET NULL, so the
-- pentadbir's own row simply loses any supervisor pointer it carried.
delete from erph.user where role <> 'pentadbir';

commit;

-- ── 3 · what is left ────────────────────────────────────────────────────────
-- Run this before the deletes to see what *will* go:
--
--   select username, full_name, role from erph.user order by role, username;

select 'akaun tinggal'            as item, count(*)::text as bilangan from erph.user
union all select 'keahlian sekolah',       count(*)::text from erph.school_member
union all select 'rancangan',               count(*)::text from erph.rph_document
union all select 'semakan',                 count(*)::text from erph.rph_review
union all select 'tandatangan',             count(*)::text from erph.rph_signature
union all select 'templat',                 count(*)::text from erph.rph_template
union all select 'notifikasi',              count(*)::text from erph.notification
union all select 'log audit',               count(*)::text from erph.audit_log
union all select 'fail eksport',            count(*)::text from erph.export_file
union all select 'SEKOLAH (dikekalkan)',    count(*)::text from erph.school
union all select 'tetapan (dikekalkan)',    count(*)::text from erph.school_setting
union all select 'kelas (dikekalkan)',      count(*)::text from erph.class
union all select 'mata pelajaran (dikekalkan)', count(*)::text from erph.subject
union all select 'takwim (dikekalkan)',     count(*)::text from erph.academic_calendar;

-- The account you will sign in with.
select username, full_name, role, jawatan, is_active
  from erph.user
 order by role, username;
