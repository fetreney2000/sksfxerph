-- Submitted plans are read-only, and only a working copy may be filed.
--
-- 1. The review guard now covers every non-owner transition to `submitted`,
--    not only a draft. A GPK resubmitting a returned plan outside their
--    supervision used to slip past both the scope check and the past-week rule.
-- 2. submit_rph refuses an already submitted plan. Re-submitting reset
--    submitted_at, which is what the on-time figure is measured from.
-- 3. A non-owner submission must pass may_supervise for every status.

create or replace function erph.guard_past_week_review()
returns trigger language plpgsql security definer set search_path = erph, public as $$
begin
  if (old.status = 'submitted' and new.status in ('approved', 'returned'))
     or (new.status = 'submitted' and old.status is distinct from 'submitted'
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

create or replace function erph.submit_rph(p_document uuid, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = erph, public as $$
declare
  v_doc erph.rph_document%rowtype;
  v_pct smallint;
  v_require boolean;
begin
  perform set_config('app.rpc', '1', true);

  select * into v_doc from erph.rph_document
   where id = p_document and deleted_at is null for update;
  if not found then raise exception 'RPH tidak dijumpai'; end if;

  if erph.actor() is null then
    raise exception 'Belum log masuk';
  end if;

  -- Owner, or a reviewer who actually supervises that teacher.
  if v_doc.owner_id is distinct from erph.actor() then
    if not erph.has_role(v_doc.school_id, array['gpk','guru_besar']::erph.member_role[]) then
      raise exception 'Tidak dibenarkan';
    end if;
    if not erph.may_supervise(v_doc.school_id, v_doc.owner_id) then
      raise exception 'RPH di luar bidang penyeliaan anda';
    end if;
  end if;

  -- Only a working copy may be filed.
  if v_doc.status not in ('draft','returned') then
    if v_doc.status = 'approved' then raise exception 'Telah disahkan lengkap'; end if;
    if v_doc.status = 'forwarded' then raise exception 'Sedang menunggu kelulusan Guru Besar'; end if;
    raise exception 'RPH sudah dihantar untuk semakan';
  end if;

  v_pct := erph.rph_completeness(v_doc.payload);

  select coalesce(
           (select require_complete from erph.school_setting
             where school_id = v_doc.school_id),
           true)
    into v_require;

  -- p_force is retained for controlled fixtures; no HTTP route exposes it.
  if v_pct < 100 and v_require and not p_force then
    return jsonb_build_object('ok', false, 'completeness', v_pct,
      'error', 'RPH belum lengkap - lengkapkan setiap seksyen wajib');
  end if;

  update erph.rph_document
     set status = 'submitted', submitted_at = now(),
         grade = null, reviewed_by = null, reviewed_at = null,
         version = version + 1, client_updated_at = now()
   where id = p_document
  returning * into v_doc;

  insert into erph.rph_revision (document_id, version, payload, completeness, actor_id, reason)
  values (v_doc.id, v_doc.version, v_doc.payload, v_pct, erph.actor(), 'resubmit')
  on conflict (document_id, version) do nothing;

  insert into erph.audit_log (school_id, actor_id, entity, entity_id, action, after)
  values (v_doc.school_id, erph.actor(), 'rph_document', v_doc.id, 'submit',
          jsonb_build_object('completeness', v_pct, 'status', 'submitted'));

  return jsonb_build_object('ok', true, 'status', 'submitted', 'completeness', v_pct,
                            'version', v_doc.version);
end $$;
