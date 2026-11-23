-- ============================================================================
-- eRPH · MIGRATION 034 - allow feedback during the current week
-- ============================================================================
-- Run AFTER 033. Safe to run more than once.
--
-- Approval remains gated until the plan's week has ended. Returning a plan is
-- feedback, not approval, so it is allowed during the current week: the
-- teacher can read the comment and correct the RPH before the week closes.

create or replace function erph.guard_past_week_review()
returns trigger language plpgsql security definer set search_path = erph, public as $$
begin
  if (old.status = 'submitted' and new.status = 'approved')
     -- forwarded -> submitted is the legacy normalization in migration 032,
     -- not a reviewer filing a current-week plan on someone's behalf.
     or (new.status = 'submitted' and old.status not in ('submitted', 'forwarded')
         and old.owner_id is distinct from erph.actor()) then
    if old.plan_date >= date_trunc('week', (now() at time zone 'UTC') + interval '8 hours')::date then
      if new.status = 'approved' then
        raise exception 'RPH hanya boleh disahkan selepas minggu tersebut tamat';
      else
        raise exception 'RPH hanya boleh dihantar selepas minggu tersebut tamat';
      end if;
    end if;
    if old.owner_id is distinct from erph.actor()
       and not erph.may_supervise(old.school_id, old.owner_id) then
      raise exception 'RPH di luar bidang penyeliaan anda';
    end if;
  end if;
  return new;
end $$;
