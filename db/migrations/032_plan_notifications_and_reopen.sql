-- ============================================================================
-- eRPH · MIGRATION 032 - plan-aware notifications, forward conversion, reopen
-- ============================================================================
-- Run AFTER 031 (the `submitted` notification type must already be committed).
-- Safe to run more than once.
--
--   · submission notifications now name the class, subject and date and go to
--     the assigned GPK (or every active Guru Besar when nobody is assigned);
--   · approval and return notifications carry the same plan label;
--   · legacy `forwarded` plans are normalized to `submitted`, so the queue can
--     decide them again;
--   · `batal_sahkan_rph` gives a Guru Besar or pentadbir an audited way to
--     reopen an approval.
--
-- The function bodies are copied from db/schema.sql.

create or replace function erph.plan_label(p_class_ids uuid[], p_subject_code text,
                                            p_plan_date date)
returns text language sql stable security definer set search_path = erph, public as $$
  select coalesce(
           (select string_agg(c.nama, ', ' order by c.nama)
              from erph.class c where c.id = any(p_class_ids)),
           'Kelas')
         || ' · ' ||
         coalesce(
           (select s.nama from erph.subject s where s.code = p_subject_code),
           p_subject_code)
         || ' · ' ||
         to_char(p_plan_date, 'DD/MM/YYYY');
$$;

create or replace function erph.reviewers_for(p_school uuid, p_owner uuid)
returns table (user_id uuid)
language sql stable security definer set search_path = erph, public as $$
  with assigned as (
    select s.supervisor_id
      from erph.school_member s
      join erph.school_member sup
        on sup.school_id = s.school_id
       and sup.user_id = s.supervisor_id
       and sup.is_active
       and sup.role in ('gpk','guru_besar')
     where s.school_id = p_school
       and s.user_id = p_owner
       and s.is_active
       and s.supervisor_id is not null
  )
  select assigned.supervisor_id
    from assigned
  union
  select g.user_id
    from erph.school_member g
   where g.school_id = p_school
     and g.role = 'guru_besar'
     and g.is_active
     and not exists (select 1 from assigned);
$$;

create or replace function erph.guard_past_week_review()
returns trigger language plpgsql security definer set search_path = erph, public as $$
begin
  if (old.status = 'submitted' and new.status in ('approved', 'returned'))
     -- forwarded -> submitted is the legacy normalization in migration 032,
     -- not a reviewer filing a current-week plan on someone's behalf.
     or (new.status = 'submitted' and old.status not in ('submitted', 'forwarded')
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

create or replace function erph.submit_rph(p_document uuid, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = erph, public as $$
declare
  v_doc erph.rph_document%rowtype;
  v_pct smallint;
  v_require boolean;
  v_label text;
begin
  perform set_config('app.rpc', '1', true);              -- unlocks guard_review_fields

  select * into v_doc from erph.rph_document
   where id = p_document and deleted_at is null for update;
  if not found then raise exception 'RPH tidak dijumpai'; end if;
  v_label := erph.plan_label(v_doc.class_ids, v_doc.subject_code, v_doc.plan_date);

  -- NULL-actor guard, matching sync_rph's.
  --
  -- This is load-bearing: `owner_id <> erph.actor()` evaluates to NULL when no
  -- actor can be resolved, and PL/pgSQL treats NULL in IF as false - so the
  -- "Tidak dibenarkan" branch would be skipped and ANY caller (including one with
  -- just the publishable key, for whom actor() is always null) could submit
  -- another teacher's plan. `IS DISTINCT FROM` never yields NULL.
  if erph.actor() is null then
    raise exception 'Belum log masuk';
  end if;

  -- Owner, or a reviewer who actually supervises that teacher. Holding the
  -- GPK role is not enough: a GPK acting on a plan outside their assignment
  -- would be a second authorization path around may_supervise.
  if v_doc.owner_id is distinct from erph.actor() then
    if not erph.has_role(v_doc.school_id, array['gpk','guru_besar']::erph.member_role[]) then
      raise exception 'Tidak dibenarkan';
    end if;
    if not erph.may_supervise(v_doc.school_id, v_doc.owner_id) then
      raise exception 'RPH di luar bidang penyeliaan anda';
    end if;
  end if;

  -- Only a working copy may be filed. A submitted plan cannot be re-submitted:
  -- that would reset submitted_at (and the on-time figure built from it) and
  -- append a second audit row for the same filing.
  if v_doc.status not in ('draft','returned') then
    if v_doc.status = 'approved' then raise exception 'Telah disahkan lengkap'; end if;
    -- With the Guru Besar already: only the reviewer rung may move it from here.
    if v_doc.status = 'forwarded' then raise exception 'Sedang menunggu kelulusan Guru Besar'; end if;
    raise exception 'RPH sudah dihantar untuk semakan';
  end if;

  v_pct := erph.rph_completeness(v_doc.payload);

  -- The school's own rule, read rather than assumed.
  --
  -- `school_setting.require_complete` is what the administrator sets on
  -- /pentadbiran → Sesi & tarikh akhir ("Halang penghantaran sehingga
  -- kelengkapan 100%"). It used to be written by `admin_set_setting` and read
  -- by *nothing*: the gate below was hard-coded to 100%, so the switch in the
  -- console did nothing at all - a setting that looked like a control and was
  -- not one.
  --
  -- `p_force` is retained for controlled fixtures that need a submitted
  -- incomplete plan. No HTTP route exposes it: `/api/rpc/submit` always calls
  -- with the default, so a school's completeness rule cannot be bypassed by a
  -- crafted request.
  select coalesce(
           (select require_complete from erph.school_setting
             where school_id = v_doc.school_id),
           true)
    into v_require;

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

  -- The reviewer gets the plan's identity, not just "something was submitted".
  -- A GPK submitting on the teacher's behalf does not need to notify themself.
  insert into erph.notification (school_id, user_id, type, title, body, link_view)
  select v_doc.school_id, r.user_id, 'submitted'::erph.notification_type,
         'RPH dihantar untuk semakan', v_label, 'review'
    from erph.reviewers_for(v_doc.school_id, v_doc.owner_id) r
   where r.user_id <> erph.actor();

  return jsonb_build_object('ok', true, 'status', 'submitted', 'completeness', v_pct,
                            'version', v_doc.version);
end $$;

create or replace function erph.submit_rph_batch(p_documents uuid[])
returns jsonb language plpgsql security definer set search_path = erph, public as $$
declare
  v_actor uuid := erph.actor();
  v_ids uuid[];
  v_count int;
  v_doc erph.rph_document%rowtype;
  v_pct smallint;
  v_require boolean;
  v_label text;
  v_items jsonb := '[]'::jsonb;
begin
  perform set_config('app.rpc', '1', true);

  if v_actor is null then
    raise exception 'Belum log masuk';
  end if;
  if p_documents is null or coalesce(array_length(p_documents, 1), 0) = 0
     or array_length(p_documents, 1) > 50 then
    raise exception 'Senarai RPH tidak sah';
  end if;

  v_ids := array(select distinct unnest(p_documents) order by 1);

  -- Lock every row before validating, so two tabs cannot both pass the status
  -- check and then write the same set.
  perform 1 from erph.rph_document
   where id = any(v_ids) and deleted_at is null
   order by id
   for update;
  select count(*) into v_count
    from erph.rph_document
   where id = any(v_ids) and deleted_at is null;
  if v_count <> array_length(v_ids, 1) then
    raise exception 'Sebahagian RPH tidak dijumpai';
  end if;

  -- Validate every row before writing any of them.
  for v_doc in
    select * from erph.rph_document
     where id = any(v_ids)
     order by plan_date, id
  loop
    if v_doc.owner_id is distinct from v_actor then
      if not erph.has_role(v_doc.school_id,
                           array['gpk','guru_besar']::erph.member_role[]) then
        raise exception 'Tidak dibenarkan';
      end if;
      if not erph.may_supervise(v_doc.school_id, v_doc.owner_id) then
        raise exception 'RPH di luar bidang penyeliaan anda';
      end if;
    end if;

    if v_doc.status not in ('draft','returned') then
      raise exception 'RPH % (%) tidak boleh dihantar - sudah dihantar atau disahkan',
        v_doc.plan_date, v_doc.subject_code;
    end if;

    v_pct := erph.rph_completeness(v_doc.payload);
    select coalesce(
             (select require_complete from erph.school_setting
               where school_id = v_doc.school_id),
             true)
      into v_require;
    if v_pct < 100 and v_require then
      raise exception 'RPH % (%) belum lengkap - lengkapkan setiap seksyen wajib',
        v_doc.plan_date, v_doc.subject_code;
    end if;
  end loop;

  update erph.rph_document
     set status = 'submitted', submitted_at = now(),
         grade = null, reviewed_by = null, reviewed_at = null,
         version = version + 1, client_updated_at = now()
   where id = any(v_ids);

  for v_doc in
    select * from erph.rph_document
     where id = any(v_ids)
     order by plan_date, id
  loop
    v_pct := erph.rph_completeness(v_doc.payload);
    v_label := erph.plan_label(v_doc.class_ids, v_doc.subject_code, v_doc.plan_date);
    insert into erph.rph_revision (document_id, version, payload, completeness,
                                   actor_id, reason)
    values (v_doc.id, v_doc.version, v_doc.payload, v_pct, v_actor, 'resubmit')
    on conflict (document_id, version) do nothing;

    insert into erph.audit_log (school_id, actor_id, entity, entity_id, action, after)
    values (v_doc.school_id, v_actor, 'rph_document', v_doc.id, 'submit',
            jsonb_build_object('completeness', v_pct, 'status', 'submitted',
                               'batch', true));

    insert into erph.notification (school_id, user_id, type, title, body, link_view)
    select v_doc.school_id, r.user_id, 'submitted'::erph.notification_type,
           'RPH dihantar untuk semakan', v_label, 'review'
      from erph.reviewers_for(v_doc.school_id, v_doc.owner_id) r
     where r.user_id <> v_actor;

    v_items := v_items || jsonb_build_array(
      jsonb_build_object('id', v_doc.id, 'version', v_doc.version));
  end loop;

  return jsonb_build_object('ok', true, 'count', array_length(v_ids, 1),
                            'items', v_items);
end $$;

create or replace function erph.sahkan_rph(p_document uuid,
                                           p_comment text default null)
returns jsonb language plpgsql security definer set search_path = erph, public as $$
declare
  v_doc erph.rph_document%rowtype;
  v_pct smallint;
  v_require boolean;
  v_label text;
  v_body text;
begin
  perform set_config('app.rpc', '1', true);

  select * into v_doc from erph.rph_document
   where id = p_document and deleted_at is null for update;
  if not found then raise exception 'RPH tidak dijumpai'; end if;
  v_label := erph.plan_label(v_doc.class_ids, v_doc.subject_code, v_doc.plan_date);
  v_body := v_label || coalesce(E'\n' || nullif(trim(p_comment), ''), '');

  if not erph.has_role(v_doc.school_id, array['gpk','guru_besar']::erph.member_role[]) then
    raise exception 'Peranan Guru Penolong Kanan atau Guru Besar diperlukan';
  end if;
  if not erph.may_supervise(v_doc.school_id, v_doc.owner_id) then
    raise exception 'RPH di luar bidang penyeliaan anda';
  end if;
  if v_doc.owner_id = erph.actor() then
    raise exception 'Anda tidak boleh mengesahkan RPH sendiri';
  end if;
  if v_doc.status <> 'submitted' then
    raise exception 'RPH tidak dalam peringkat semakan';
  end if;
  if not exists (select 1 from erph.rph_signature
                  where document_id = v_doc.id
                    and document_version = v_doc.version
                    and signer_id = erph.actor()) then
    raise exception 'Tandatangan diperlukan';
  end if;

  -- The grade is a factual claim.
  --
  -- Lampiran 7 grades a plan 1 = lengkap, 0 = tidak lengkap. Recording 1 for
  -- a plan that is missing sections would put a false statement into a
  -- statutory record, and nothing downstream could tell it from a real one:
  -- the review row carries the completeness, but the *grade* is what the
  -- school's compliance figures are built from.
  --
  -- So an approval needs the same completeness the school asked for at
  -- submission. A school that has turned the requirement off may still approve
  -- an incomplete plan - that is its own policy, set by the administrator who
  -- answers for it.
  v_pct := erph.rph_completeness(v_doc.payload);
  select coalesce(
           (select require_complete from erph.school_setting
             where school_id = v_doc.school_id),
           true)
    into v_require;
  if v_pct < 100 and v_require then
    raise exception 'RPH belum lengkap untuk disahkan - kembalikan kepada guru';
  end if;

  insert into erph.rph_review (document_id, document_version, reviewer_id, grade, comment, checklist)
  values (v_doc.id, v_doc.version, erph.actor(), 1, p_comment,
          jsonb_build_object('stage', 'sahkan',
                             'completeness', erph.rph_completeness(v_doc.payload)));

  update erph.rph_document
     set status = 'approved'::erph.rph_status,
         grade = 1, reviewed_by = erph.actor(), reviewed_at = now(),
         version = version + 1
   where id = p_document;

  insert into erph.notification (school_id, user_id, type, title, body, link_view)
  values (v_doc.school_id, v_doc.owner_id, 'approved'::erph.notification_type,
          'RPH disahkan', v_body,
          'editor/' || v_doc.id::text);

  insert into erph.audit_log (school_id, actor_id, entity, entity_id, action, after)
  values (v_doc.school_id, erph.actor(), 'rph_document', v_doc.id, 'sahkan',
          jsonb_build_object('status', 'approved', 'comment', p_comment));

  return jsonb_build_object('ok', true, 'grade', 1, 'status', 'approved');
end $$;

create or replace function erph.hantar_balik_rph(p_document uuid,
                                                 p_comment text default null)
returns jsonb language plpgsql security definer set search_path = erph, public as $$
declare
  v_doc erph.rph_document%rowtype;
  v_label text;
  v_body text;
begin
  perform set_config('app.rpc', '1', true);

  select * into v_doc from erph.rph_document
   where id = p_document and deleted_at is null for update;
  if not found then raise exception 'RPH tidak dijumpai'; end if;
  v_label := erph.plan_label(v_doc.class_ids, v_doc.subject_code, v_doc.plan_date);
  v_body := v_label || coalesce(E'\n' || nullif(trim(p_comment), ''), '');

  if not erph.has_role(v_doc.school_id, array['gpk','guru_besar']::erph.member_role[]) then
    raise exception 'Peranan Guru Penolong Kanan atau Guru Besar diperlukan';
  end if;
  if not erph.may_supervise(v_doc.school_id, v_doc.owner_id) then
    raise exception 'RPH di luar bidang penyeliaan anda';
  end if;
  if v_doc.owner_id = erph.actor() then
    raise exception 'Anda tidak boleh mengembalikan RPH sendiri';
  end if;
  if v_doc.status <> 'submitted' then
    raise exception 'RPH tidak dalam peringkat semakan';
  end if;

  insert into erph.rph_review (document_id, document_version, reviewer_id, grade, comment, checklist)
  values (v_doc.id, v_doc.version, erph.actor(), 0, p_comment,
          jsonb_build_object('stage', 'hantar_balik',
                             'completeness', erph.rph_completeness(v_doc.payload)));

  update erph.rph_document
     set status = 'returned'::erph.rph_status,
         grade = 0, reviewed_by = erph.actor(), reviewed_at = now(),
         version = version + 1
   where id = p_document;

  insert into erph.notification (school_id, user_id, type, title, body, link_view)
  values (v_doc.school_id, v_doc.owner_id, 'returned'::erph.notification_type,
          'RPH perlu dibaiki', v_body,
          'editor/' || v_doc.id::text);

  insert into erph.audit_log (school_id, actor_id, entity, entity_id, action, after)
  values (v_doc.school_id, erph.actor(), 'rph_document', v_doc.id, 'hantar_balik',
          jsonb_build_object('status', 'returned', 'comment', p_comment));

  return jsonb_build_object('ok', true, 'grade', 0, 'status', 'returned');
end $$;

create or replace function erph.batal_sahkan_rph(p_document uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = erph, public as $$
declare
  v_doc erph.rph_document%rowtype;
  v_label text;
  v_reason text := nullif(trim(p_reason), '');
begin
  perform set_config('app.rpc', '1', true);

  if v_reason is null then
    raise exception 'Sebab pembatalan diperlukan';
  end if;

  select * into v_doc from erph.rph_document
   where id = p_document and deleted_at is null for update;
  if not found then raise exception 'RPH tidak dijumpai'; end if;

  if not erph.has_role(v_doc.school_id,
                       array['guru_besar','pentadbir']::erph.member_role[]) then
    raise exception 'Hanya Guru Besar atau pentadbir boleh membatalkan pengesahan';
  end if;
  if v_doc.status <> 'approved' then
    raise exception 'Hanya RPH yang telah disahkan boleh dibuka semula';
  end if;

  v_label := erph.plan_label(v_doc.class_ids, v_doc.subject_code, v_doc.plan_date);

  insert into erph.rph_review (document_id, document_version, reviewer_id, grade,
                               comment, checklist)
  values (v_doc.id, v_doc.version, erph.actor(), 0, v_reason,
          jsonb_build_object('stage', 'batal_sahkan',
                             'completeness', erph.rph_completeness(v_doc.payload)));

  update erph.rph_document
     set status = 'returned'::erph.rph_status,
         grade = 0, reviewed_by = erph.actor(), reviewed_at = now(),
         version = version + 1
   where id = p_document;

  insert into erph.notification (school_id, user_id, type, title, body, link_view)
  values (v_doc.school_id, v_doc.owner_id, 'returned'::erph.notification_type,
          'Pengesahan RPH dibatalkan', v_label || E'\n' || v_reason,
          'editor/' || v_doc.id::text);

  insert into erph.audit_log (school_id, actor_id, entity, entity_id, action, after)
  values (v_doc.school_id, erph.actor(), 'rph_document', v_doc.id, 'batal_sahkan',
          jsonb_build_object('status', 'returned', 'reason', v_reason));

  return jsonb_build_object('ok', true, 'status', 'returned');
end $$;
-- Legacy two-stage rows were left in `forwarded` when the hop was retired.
-- They are already in review; normalize them so `sahkan_rph`/`hantar_balik`
-- and the pending queue can reach them again. The trigger exemption above
-- makes this a data fix, not a reviewer filing on the owner's behalf.
do $$
begin
  perform set_config('app.rpc', '1', true);
  update erph.rph_document
     set status = 'submitted',
         grade = null,
         reviewed_by = null,
         reviewed_at = null
   where status = 'forwarded';
end $$;

grant execute on function erph.batal_sahkan_rph(uuid, text)
  to authenticated, service_role;
