-- ============================================================================
-- eRPH · OPS · FRESH START
-- ============================================================================
--
--         ██  NOT A MIGRATION. DO NOT ADD IT TO db/migrations/  ██
--
-- Every file in db/migrations/ is idempotent and safe to run twice. This one
-- destroys data irreversibly. Nothing globs db/*.sql — the schema runner and
-- the migration test both name their files — so this sits inert beside them
-- until somebody pastes it into an editor.
--
-- ── KEEPS ──────────────────────────────────────────────────────────────────
--
--   erph.school          the whole row: kod_sekolah (XCA1043), nama, level,
--                        ppd, jpn, motto, logo_url, is_active
--   erph.school_setting  session 2026/2027, Friday 16:00, require_complete
--   erph.user            the Administrator, renamed pentadbir.sk → pentadbir
--                        (password unchanged — it is the same row, not a new one)
--   erph.school_member   that account's membership, because the others cascade
--                        away with their users
--
-- school_setting is kept deliberately, and it is not a judgement call:
-- `erph.admin_set_setting` only ever issues UPDATE … WHERE school_id = …. With
-- no row there is nothing to update, the app would silently fall back to the
-- build-time default, and the "Sesi & tarikh akhir" tab could not put it back.
-- Clearing it would be the one deletion you could not undo from inside the app.
--
-- ── CLEARS ─────────────────────────────────────────────────────────────────
--
--   accounts        4   everything whose role is not pentadbir
--   memberships     3   school_member            (cascade)
--   classes         3   class
--   subjects        3   subject
--   eRPH            2   rph_document             (cascade → revision, review)
--   revisions       2   rph_revision             (append-only guard lifted)
--   reviews         1   rph_review               (append-only guard lifted)
--   templates       0   rph_template
--   notifications   1   notification             (cascade)
--   sync queue      2   sync_op                  (cascade)
--   audit log       1   audit_log                (append-only guard lifted)
--   exports         0   export_file
--   DSKP             0   dskp_standard
--   calendar         0   academic_calendar
--   assignments      0   teaching_assignment     (cascade)
--
--   (counts at the time of writing — the file does not depend on them.)
--
-- ── Why app.purge has to be set ───────────────────────────────────────────
--
-- rph_revision, rph_review and audit_log carry `tr_*_appendonly`: a BEFORE
-- UPDATE OR DELETE trigger that raises unless app.purge = '1'. It is the
-- statutory-record guarantee (Akta 550 / Peraturan 8 — never rewrite history),
-- and it fires on cascaded rows too: deleting a document cascades into its
-- revisions and each of those DELETEs meets the guard. There is no RPC that
-- sets app.purge, which is why this cannot be done through the app's API.
-- It is set session-scoped and switched off at the end, so a later statement
-- in the same session still cannot rewrite history.
--
-- ── Why the order is not a style choice ────────────────────────────────────
--
-- Four foreign keys have NO ON DELETE, so they are RESTRICT by default —
-- deliberately, because a statutory record must not vanish when a person row
-- does:   rph_document.owner_id · rph_document.reviewed_by
--         rph_review.reviewer_id · export_file.created_by
-- plus rph_document.class_id / .subject_code, dskp_standard.subject_code,
-- rph_template.subject_code and teaching_assignment.subject_code — all
-- RESTRICT on reference data.
--
-- So documents, templates, exports, DSKP and accounts all have to go *before*
-- classes and subjects. Get that backwards and the transaction aborts with a
-- foreign-key error and nothing changes — which is the safe failure, and it is
-- why the whole thing is wrapped in begin/commit.
-- ============================================================================

begin;

-- ── 1 · lift the append-only guard for this transaction ─────────────────────
select set_config('app.purge', '1', false);

-- ── 2 · saved eRPH ─────────────────────────────────────────────────────────
-- First, because owner_id, reviewed_by, class_id and subject_code are all
-- RESTRICT. Cascades into rph_revision and rph_review — that is what step 1
-- exists for — and into export_file.document_id.
delete from erph.rph_document;

-- ── 3 · templates (subject_code is RESTRICT) ────────────────────────────────
delete from erph.rph_template;

-- ── 4 · exports (document_id already cascaded; created_by is RESTRICT) ──────
delete from erph.export_file;

-- ── 5 · history (no foreign keys; append-only, so purge must be set) ────────
delete from erph.audit_log;

-- ── 6 · DSKP (subject_code is RESTRICT) ─────────────────────────────────────
delete from erph.dskp_standard;

-- ── 7 · calendar — nothing references it ────────────────────────────────────
delete from erph.academic_calendar;

-- ── 8 · classes (cascades teaching_assignment) ──────────────────────────────
delete from erph.class;

-- ── 9 · every account except the Administrator ──────────────────────────────
-- Cascades school_member, teaching_assignment, notification and sync_op —
-- and clears teaching_assignment.subject_code, the last RESTRICT row blocking
-- step 10.
delete from erph.user where role <> 'pentadbir';

-- ── 10 · subjects — every referencer is gone by now ─────────────────────────
delete from erph.subject;

-- ── 11 · the account you keep, under the name you want ──────────────────────
-- Same row, so password_hash, full_name and email are untouched: this is a
-- rename, not a new account. user_username_uniq is on lower(username), and by
-- now every other username has been deleted, so it cannot collide.
update erph.user set username = 'pentadbir' where role = 'pentadbir';

-- ── 12 · re-arm the guard ───────────────────────────────────────────────────
select set_config('app.purge', '0', false);

commit;


-- ============================================================================
-- VERIFY — every line should return what is in the bracket
-- ============================================================================
--
-- select 'accounts'        as what, count(*) as n from erph.user            -- 1
-- union all select 'memberships',  count(*) from erph.school_member         -- 1
-- union all select 'classes',      count(*) from erph.class                 -- 0
-- union all select 'subjects',     count(*) from erph.subject               -- 0
-- union all select 'eRPH',         count(*) from erph.rph_document          -- 0
-- union all select 'revisions',    count(*) from erph.rph_revision          -- 0
-- union all select 'reviews',      count(*) from erph.rph_review            -- 0
-- union all select 'templates',    count(*) from erph.rph_template          -- 0
-- union all select 'audit log',    count(*) from erph.audit_log             -- 0
-- union all select 'school (kept)',count(*) from erph.school                -- 1
-- union all select 'settings (kept)', count(*) from erph.school_setting;    -- 1
--
-- select username, role from erph.user;   -- one row: pentadbir / pentadbir
--
-- select kod_sekolah, nama, motto, logo_url from erph.school;
-- select current_session, submit_time from erph.school_setting;
--
-- ── After this, the app is genuinely empty ──────────────────────────────────
--
-- The Administrator can sign in as  pentadbir  (same password), edit the
-- school identity and the session, and add classes and subjects from
-- Urus eRPH. Nothing else exists — which is the point of a fresh start.
--
-- ── Two things this does not touch ──────────────────────────────────────────
--
-- 1. Browsers still signed in as a removed account hold IndexedDB drafts
--    locally. They are unreachable — the account is gone — but clearing site
--    data on those machines is the tidy finish.
-- 2. db/seed.sql creates 5 accounts, 3 classes, 3 subjects and a demo lesson
--    plan. Re-running the seed undoes this. Don't, unless you want it back.
