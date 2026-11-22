-- Whole-week submission in one transaction.
--
-- The archive validates completeness in the browser, but a later plan can
-- still be refused by the server (stale status, payload change, session
-- expiry). This function validates every selected plan before writing any of
-- them and rolls back all of them on the first refusal.

create or replace function erph.submit_rph_batch(p_documents uuid[])
returns jsonb language plpgsql security definer set search_path = erph, public as $$
declare
  v_actor uuid := erph.actor();
  v_ids uuid[];
  v_count int;
  v_doc erph.rph_document%rowtype;
  v_pct smallint;
  v_require boolean;
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
    insert into erph.rph_revision (document_id, version, payload, completeness,
                                   actor_id, reason)
    values (v_doc.id, v_doc.version, v_doc.payload, v_pct, v_actor, 'resubmit')
    on conflict (document_id, version) do nothing;

    insert into erph.audit_log (school_id, actor_id, entity, entity_id, action, after)
    values (v_doc.school_id, v_actor, 'rph_document', v_doc.id, 'submit',
            jsonb_build_object('completeness', v_pct, 'status', 'submitted',
                               'batch', true));

    v_items := v_items || jsonb_build_array(
      jsonb_build_object('id', v_doc.id, 'version', v_doc.version));
  end loop;

  return jsonb_build_object('ok', true, 'count', array_length(v_ids, 1),
                            'items', v_items);
end $$;
