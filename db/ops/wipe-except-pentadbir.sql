-- ============================================================================
-- eRPH · OPS · WIPE — remove every account except the Administrator, plus
--                     every saved eRPH and every template
-- ============================================================================
--
--         ██  NOT A MIGRATION. DO NOT ADD IT TO db/migrations/  ██
--
-- Every file in db/migrations/ is idempotent and safe to run twice. This one
-- is neither: it destroys data irreversibly. Nothing globs db/*.sql — the
-- migration test and the schema runner both name their files — so this file
-- sitting beside them is inert until somebody pastes it into an editor.
--
-- ── What it removes (counts as of the date this was written) ──────────────
--
--   accounts      4   nurul.aisyah (guru_biasa), ramlan.yusof (gpk),
--                     zulkifli.rahman (guru_besar), sistem.erph (system)
--                     → every row whose role is not 'pentadbir'
--   memberships   4   school_member            (on delete cascade)
--   notifications 1   notification             (on delete cascade)
--   sync queue    2   sync_op                  (on delete cascade)
--   eRPH          2   rph_document             (deleted directly)
--   revisions     2   rph_revision             (cascade + append-only guard)
--   reviews       1   rph_review               (cascade + append-only guard)
--   templates     0   rph_template             (was already empty)
--   exports       0   export_file
--
-- ── What it keeps ─────────────────────────────────────────────────────────
--
--   pentadbir.sk — the one account that stays
--   the school row, school_setting, all 3 classes, all 3 subjects, DSKP,
--   academic_calendar
--   the audit log: it is history, it is append-only by design, and neither an
--   account nor an eRPH nor a template — so it is out of scope for this
--   request. See the optional line at the bottom if you want it too.
--
-- ── Why app.purge has to be set ───────────────────────────────────────────
--
-- rph_revision, rph_review and audit_log carry `tr_*_appendonly`, a
-- BEFORE UPDATE OR DELETE trigger that raises unless app.purge = '1'. It is
-- the statutory-record guarantee (Akta 550 / Peraturan 8 — never rewrite
-- history), and it fires on cascaded rows too: deleting a document cascades
-- into its revisions, and each of those DELETEs meets the guard.
--
-- This is the same switch the retention job uses. It is set session-scoped and
-- switched off again at the end, so a later statement in the same session
-- cannot quietly rewrite history either.
--
-- ── Order matters ─────────────────────────────────────────────────────────
--
-- rph_document.owner_id, rph_document.reviewed_by, rph_review.reviewer_id and
-- export_file.created_by all have NO ON DELETE — they are RESTRICT by default,
-- which is deliberate: a statutory record must not vanish when a person row
-- does. So the documents (and their reviews) have to go *before* the accounts.
-- Everything else points the other way and cascades.
-- ============================================================================

begin;

-- ── 1 · lift the append-only guard for this transaction ─────────────────────
select set_config('app.purge', '1', false);

-- ── 2 · saved eRPH ─────────────────────────────────────────────────────────
-- Deleting the document cascades into rph_revision and rph_review; those
-- cascaded DELETEs are what step 1 exists for.
delete from erph.rph_document;

-- ── 3 · templates ──────────────────────────────────────────────────────────
-- owner_id and cloned_from are ON DELETE SET NULL, so this is safe in any
-- order — but it runs while the accounts are still present, so the "owner"
-- column is not the thing being chased.
delete from erph.rph_template;

-- ── 4 · exports ────────────────────────────────────────────────────────────
-- document_id already cascaded above; the remaining risk is a document-less
-- export whose created_by points at an account step 5 is about to remove,
-- and created_by has no cascade. Empty today — kept so this stays true later.
delete from erph.export_file;

-- ── 5 · accounts ───────────────────────────────────────────────────────────
-- Everything but the Administrator. school_member, teaching_assignment,
-- notification and sync_op all reference this table with ON DELETE CASCADE.
delete from erph.user where role <> 'pentadbir';

-- ── 6 · guard off ──────────────────────────────────────────────────────────
select set_config('app.purge', '0', false);

commit;


-- ============================================================================
-- VERIFY — run these afterwards; every line should say what is in brackets
-- ============================================================================
--
-- select 'accounts'        as what, count(*) as n from erph.user            -- 1
-- union all
-- select 'memberships',          count(*) from erph.school_member           -- 1
-- union all
-- select 'eRPH documents',       count(*) from erph.rph_document            -- 0
-- union all
-- select 'revisions',            count(*) from erph.rph_revision            -- 0
-- union all
-- select 'reviews',              count(*) from erph.rph_review              -- 0
-- union all
-- select 'templates',            count(*) from erph.rph_template            -- 0
-- union all
-- select 'classes (kept)',       count(*) from erph.class                   -- 3
-- union all
-- select 'subjects (kept)',      count(*) from erph.subject                 -- 3
-- union all
-- select 'audit log (kept)',     count(*) from erph.audit_log;              -- 1
--
-- select username, role from erph.user;         -- one row: pentadbir.sk
--
-- ── Optional, only if you also want the history gone ────────────────────────
-- The audit log is not an account, an eRPH or a template, so it is not in the
-- wipe above. It is append-only, so it needs the same switch:
--
--   begin;
--   select set_config('app.purge', '1', false);
--   delete from erph.audit_log;
--   select set_config('app.purge', '0', false);
--   commit;
--
-- ── Two things to know afterwards ───────────────────────────────────────────
--
-- 1. db/seed.sql inserts a demo lesson plan ("one submitted plan for the
--    reviewer screens"). Re-running the seed will bring one back. Don't, if
--    you want it to stay empty.
-- 2. This clears the *server*. Browsers that were signed in as a removed
--    account still hold their IndexedDB drafts locally, and the service worker
--    still caches. Those copies are unreachable — the account is gone — but
--    signing out of them, or clearing site data, is the tidy way to finish.
