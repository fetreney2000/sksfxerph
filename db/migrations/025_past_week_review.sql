-- Refuse current/future-week decisions even when an RPC is called directly.
-- Teachers can still submit their own plans in advance.
create or replace function erph.guard_past_week_review()
returns trigger language plpgsql security definer set search_path = erph, public as $$
begin
  if (old.status = 'submitted' and new.status in ('approved', 'returned'))
     or (old.status = 'draft' and new.status = 'submitted'
         and old.owner_id is distinct from erph.actor()) then
    if old.plan_date >= date_trunc('week', (now() at time zone 'UTC') + interval '8 hours')::date then
      raise exception 'RPH hanya boleh disemak selepas minggu tersebut tamat';
    end if;
    if old.owner_id is distinct from erph.actor()
       and not erph.may_supervise(old.school_id, old.owner_id) then
      raise exception 'RPH di luar bidang penyeliaan anda';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_past_week_review on erph.rph_document;
create trigger guard_past_week_review before update on erph.rph_document
for each row execute function erph.guard_past_week_review();
