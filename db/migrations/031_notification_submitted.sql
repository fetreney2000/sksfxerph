-- ============================================================================
-- eRPH · MIGRATION 031 - add the `submitted` notification type
-- ============================================================================
-- Run AFTER 030. Safe to run more than once.
--
-- Kept separate from 032 because PostgreSQL will not let a transaction use a
-- new enum value until the transaction that added it has committed. Apply this
-- file first, then 032.

alter type erph.notification_type add value if not exists 'submitted';
