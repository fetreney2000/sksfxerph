-- ============================================================================
-- eRPH · MIGRATION 035 - cap reviewer feedback in SQL
-- ============================================================================
-- Run AFTER 034. Safe to run more than once.
--
-- The API already caps comments at 2,000 characters. These functions are the
-- last line for service-role or direct RPC callers, so the same cap is applied
-- where the row is actually written.

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
  if p_comment is not null and length(trim(p_comment)) > 2000 then
    raise exception 'Komen terlalu panjang (maksimum 2000 aksara)';
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
  if length(trim(p_comment)) > 2000 then
    raise exception 'Komen terlalu panjang (maksimum 2000 aksara)';
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
  if length(v_reason) > 2000 then
    raise exception 'Sebab pembatalan terlalu panjang (maksimum 2000 aksara)';
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
