-- ============================================================================
-- eRPH · MIGRATION 036 - add the `comment` notification type
-- ============================================================================
-- Run AFTER 035. Safe to run more than once.
--
-- Kept separate because PostgreSQL will not use a new enum value in the same
-- transaction that adds it. Apply 036 before 037.

alter type erph.notification_type add value if not exists 'comment';
