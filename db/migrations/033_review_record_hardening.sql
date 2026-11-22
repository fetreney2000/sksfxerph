-- ============================================================================
-- eRPH · MIGRATION 033 - review record hardening
-- ============================================================================
-- Run AFTER 032. Safe to run more than once.
--
--   · signature rows snapshot the signer's printed name and office, so a later
--     promotion or name change cannot rewrite an old sealed record;
--   · the approval/signature check validates the envelope fields, not merely
--     that a row exists;
--   · `hantar_balik_rph` refuses a reasonless return even when called directly;
--   · `rph_review.checklist` stores the six section booleans, not only the
--     completeness percentage;
--   · `submitted_at` keeps the first filing time across a return/resubmission,
--     matching `sync_rph`, so on-time figures do not flip late.
--
-- The function bodies are copied from db/schema.sql.

alter table erph.rph_signature
  add column if not exists signer_name text,
  add column if not exists signer_title text;

create or replace function erph.review_checklist(p_payload jsonb, p_stage text,
                                                  p_completeness smallint)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'stage', p_stage,
    'completeness', p_completeness,
    'standard_kandungan',
      nullif(trim(coalesce(p_payload->>'standard_kandungan','')), '') is not null,
    'standard_pembelajaran',
      nullif(trim(coalesce(p_payload->>'standard_pembelajaran','')), '') is not null,
    'objektif',
      nullif(trim(coalesce(p_payload->>'objektif','')), '') is not null,
    'kriteria_kejayaan',
      nullif(trim(coalesce(p_payload->>'kriteria_kejayaan','')), '') is not null,
    'aktiviti',
      (jsonb_typeof(coalesce(p_payload->'aktiviti', '[]'::jsonb)) = 'array'
       and exists (
         select 1 from jsonb_array_elements(coalesce(p_payload->'aktiviti', '[]'::jsonb)) e
          where nullif(trim(coalesce(e->>'nama','')), '') is not null)),
    'refleksi',
      nullif(trim(coalesce(p_payload->>'refleksi','')), '') is not null
  );
$$;

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
     -- `submitted_at` is the *first* filing. A return and resubmission must not
     -- erase the original hand-in time, or an on-time plan turns late through
     -- no fault of the teacher. `sync_rph` has always preserved it this way.
     set status = 'submitted', submitted_at = coalesce(submitted_at, now()),
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
     -- First filing, same as `submit_rph`: a whole-week resubmission must not
     -- rewrite every plan's on-time timestamp.
     set status = 'submitted', submitted_at = coalesce(submitted_at, now()),
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

create or replace function erph.hantar_balik_rph(p_document uuid,
                                                 p_comment text default null)
returns jsonb language plpgsql security definer set search_path = erph, public as $$
declare
  v_doc erph.rph_document%rowtype;
  v_pct smallint;
  v_label text;
  v_body text;
begin
  perform set_config('app.rpc', '1', true);

  select * into v_doc from erph.rph_document
   where id = p_document and deleted_at is null for update;
  if not found then raise exception 'RPH tidak dijumpai'; end if;
  v_pct := erph.rph_completeness(v_doc.payload);
  v_label := erph.plan_label(v_doc.class_ids, v_doc.subject_code, v_doc.plan_date);
  v_body := v_label || E'\n' || trim(p_comment);

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

  -- A return without a reason is not actionable. The API enforces this too;
  -- the SQL is the last line for any other caller.
  if nullif(trim(p_comment), '') is null then
    raise exception 'Sebab pengembalian diperlukan';
  end if;

  insert into erph.rph_review (document_id, document_version, reviewer_id, grade, comment, checklist)
  values (v_doc.id, v_doc.version, erph.actor(), 0, trim(p_comment),
          erph.review_checklist(v_doc.payload, 'hantar_balik', v_pct));

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
          jsonb_build_object('status', 'returned', 'comment', trim(p_comment)));

  return jsonb_build_object('ok', true, 'grade', 0, 'status', 'returned');
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
  -- The server verified the ECDSA signature before inserting the row; this
  -- second pass checks that the row *describes this decision*. It catches a
  -- row written for another document/version/signer/decision, or with a key
  -- that does not match the envelope, even if it somehow reached the table.
  if not exists (
    select 1 from erph.rph_signature s
     where s.document_id = v_doc.id
       and s.document_version = v_doc.version
       and s.signer_id = erph.actor()
       and s.alg = 'ES256'
       and length(s.signature) > 0
       and s.envelope->>'v' = '1'
       and s.envelope->>'alg' = 'ES256'
       and s.envelope->>'kid' = s.public_key
       and s.envelope->>'doc' = v_doc.id::text
       and s.envelope->>'ver' = v_doc.version::text
       and s.envelope->>'signer' = erph.actor()::text
       and s.envelope->>'decision' = 'sahkan'
  ) then
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
  values (v_doc.id, v_doc.version, erph.actor(), 1, trim(p_comment),
          erph.review_checklist(v_doc.payload, 'sahkan', v_pct));

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

create or replace function erph.batal_sahkan_rph(p_document uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = erph, public as $$
declare
  v_doc erph.rph_document%rowtype;
  v_pct smallint;
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

  v_pct := erph.rph_completeness(v_doc.payload);
  v_label := erph.plan_label(v_doc.class_ids, v_doc.subject_code, v_doc.plan_date);

  insert into erph.rph_review (document_id, document_version, reviewer_id, grade,
                               comment, checklist)
  values (v_doc.id, v_doc.version, erph.actor(), 0, v_reason,
          erph.review_checklist(v_doc.payload, 'batal_sahkan', v_pct));

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
