-- ============================================================================
-- eRPH · MIGRATION 030 - supervisor hierarchy, lifecycle cleanup, plan links
-- ============================================================================
-- Run AFTER 029. Safe to run more than once.
--
--   · erph.admin_set_supervisor now enforces the hierarchy: a Guru Biasa may
--     point at a GPK or Guru Besar, a GPK only at a Guru Besar, and a Guru
--     Besar at another Guru Besar.
--   · erph.admin_set_member revalidates the member's own supervisor after a
--     role change, and clears assignments that can no longer be honoured when
--     a supervisor is demoted or deactivated.
--   · approval and return notifications link to the plan (`editor/<id>`)
--     instead of the generic dashboard.
--
-- The generated definitions live in db/schema.sql; this migration copies the
-- current bodies so an existing database receives the same behaviour.

-- Clear assignments that were already invalid before the guard existed. A peer
-- GPK or an inactive supervisor must not keep review scope simply because the
-- row was written under the old rule.
update erph.school_member m
   set supervisor_id = null
 where m.supervisor_id is not null
   and not exists (
     select 1
       from erph.school_member s
      where s.school_id = m.school_id
        and s.user_id = m.supervisor_id
        and s.user_id <> m.user_id
        and s.is_active
        and (
          (m.role = 'guru_biasa' and s.role in ('gpk','guru_besar'))
          or (m.role in ('gpk','guru_besar') and s.role = 'guru_besar')
        )
   );

create or replace function erph.admin_set_supervisor(p_school uuid, p_member uuid,
                                                     p_supervisor uuid)
returns void language plpgsql security definer set search_path = erph, public as $$
declare
  v_member_role erph.member_role;
  v_supervisor_role erph.member_role;
begin
  if not erph.has_role(p_school, array['pentadbir']::erph.member_role[]) then
    raise exception 'Peranan pentadbir diperlukan';
  end if;
  if p_member = p_supervisor then
    raise exception 'Anda tidak boleh menyelia diri sendiri';
  end if;

  select role into v_member_role
    from erph.school_member
   where school_id = p_school and user_id = p_member;
  if not found then
    raise exception 'Guru ini bukan ahli sekolah ini';
  end if;

  if v_member_role not in ('guru_biasa','gpk','guru_besar') then
    if p_supervisor is not null then
      raise exception 'Peranan ini tidak mempunyai penyelia';
    end if;
  elsif p_supervisor is not null then
    select role into v_supervisor_role
      from erph.school_member
     where school_id = p_school and user_id = p_supervisor
       and is_active;
    if not found or v_supervisor_role not in ('gpk','guru_besar') then
      raise exception 'Penyelia mesti GPK atau Guru Besar yang aktif';
    end if;
    if v_member_role = 'gpk' and v_supervisor_role <> 'guru_besar' then
      raise exception 'GPK hanya boleh diselia oleh Guru Besar';
    end if;
    if v_member_role = 'guru_besar' and v_supervisor_role <> 'guru_besar' then
      raise exception 'Guru Besar hanya boleh diselia oleh Guru Besar lain';
    end if;
  end if;

  update erph.school_member set supervisor_id = p_supervisor
   where school_id = p_school and user_id = p_member;
end $$;

create or replace function erph.admin_set_member(p_school uuid, p_user uuid,
                                                 p_role erph.member_role,
                                                 p_active boolean)
returns void language plpgsql security definer set search_path = erph, public as $$
begin
  if not erph.has_role(p_school, array['pentadbir']::erph.member_role[]) then
    raise exception 'Peranan pentadbir diperlukan';
  end if;
  if p_role = 'system' then
    raise exception 'Peranan sistem tidak boleh diberikan kepada akaun';
  end if;
  if not exists (select 1 from erph.school_member
                 where school_id = p_school and user_id = p_user) then
    raise exception 'Pemilik akaun ini bukan ahli sekolah ini';
  end if;

  update erph.school_member set role = p_role, is_active = p_active
   where school_id = p_school and user_id = p_user;
  update erph.user
     set is_active = p_active,
         role = p_role,
         jawatan = erph.jawatan_for(p_role, erph.user.jawatan)
   where id = p_user;

  -- A teacher promoted to GPK must not keep the GPK who used to supervise
  -- them; a role with no supervisor level must not keep one either.
  update erph.school_member m
     set supervisor_id = null
   where m.school_id = p_school
     and m.user_id = p_user
     and m.supervisor_id is not null
     and not exists (
       select 1
         from erph.school_member s
        where s.school_id = p_school
          and s.user_id = m.supervisor_id
          and s.user_id <> m.user_id
          and s.is_active
          and (
            (p_role = 'guru_biasa' and s.role in ('gpk','guru_besar'))
            or (p_role in ('gpk','guru_besar') and s.role = 'guru_besar')
          )
     );

  -- A member who stops being a GPK/Guru Besar, or is deactivated, can no
  -- longer supervise anyone.
  if not p_active or p_role not in ('gpk','guru_besar') then
    update erph.school_member
       set supervisor_id = null
     where school_id = p_school
       and supervisor_id = p_user;
  elsif p_role = 'gpk' then
    update erph.school_member m
       set supervisor_id = null
     where m.school_id = p_school
       and m.supervisor_id = p_user
       and exists (
         select 1
           from erph.school_member s
          where s.school_id = p_school
            and s.user_id = m.user_id
            and s.role <> 'guru_biasa'
       );
  end if;
end $$;

create or replace function erph.sahkan_rph(p_document uuid,
                                           p_comment text default null)
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
          'RPH disahkan', coalesce(p_comment, ''),
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
begin
  perform set_config('app.rpc', '1', true);

  select * into v_doc from erph.rph_document
   where id = p_document and deleted_at is null for update;
  if not found then raise exception 'RPH tidak dijumpai'; end if;

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
          'RPH perlu dibaiki', coalesce(p_comment, ''),
          'editor/' || v_doc.id::text);

  insert into erph.audit_log (school_id, actor_id, entity, entity_id, action, after)
  values (v_doc.school_id, erph.actor(), 'rph_document', v_doc.id, 'hantar_balik',
          jsonb_build_object('status', 'returned', 'comment', p_comment));

  return jsonb_build_object('ok', true, 'grade', 0, 'status', 'returned');
end $$;
