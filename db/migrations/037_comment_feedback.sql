-- ============================================================================
-- eRPH · MIGRATION 037 - comment-only reviewer feedback
-- ============================================================================
-- Run AFTER 036. Safe to run more than once.
--
-- Reviewers can leave a note without returning or approving the plan. The note
-- lives in its own table so it cannot affect status, grade or compliance.

create table if not exists erph.rph_feedback (
  id          bigint generated always as identity primary key,
  document_id uuid not null references erph.rph_document(id) on delete cascade,
  author_id   uuid not null references erph.user(id),
  comment     text not null check (char_length(trim(comment)) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists rph_feedback_doc_idx
  on erph.rph_feedback (document_id, created_at desc);

alter table erph.rph_feedback enable row level security;

drop policy if exists rph_feedback_read on erph.rph_feedback;
create policy rph_feedback_read on erph.rph_feedback
  for select using (exists (select 1 from erph.rph_document d
                            where d.id = erph.rph_feedback.document_id
                              and erph.may_supervise(d.school_id, d.owner_id)));

grant select on erph.rph_feedback to authenticated, service_role;

create or replace function erph.comment_rph(p_document uuid, p_comment text)
returns jsonb language plpgsql security definer set search_path = erph, public as $$
declare
  v_doc erph.rph_document%rowtype;
  v_text text := nullif(trim(p_comment), '');
  v_label text;
begin
  perform set_config('app.rpc', '1', true);

  if v_text is null then
    raise exception 'Maklum balas diperlukan';
  end if;
  if length(v_text) > 2000 then
    raise exception 'Maklum balas terlalu panjang (maksimum 2000 aksara)';
  end if;

  select * into v_doc from erph.rph_document
   where id = p_document and deleted_at is null for update;
  if not found then raise exception 'RPH tidak dijumpai'; end if;

  if not erph.has_role(v_doc.school_id,
                       array['gpk','guru_besar']::erph.member_role[]) then
    raise exception 'Peranan Guru Penolong Kanan atau Guru Besar diperlukan';
  end if;
  if not erph.may_supervise(v_doc.school_id, v_doc.owner_id) then
    raise exception 'RPH di luar bidang penyeliaan anda';
  end if;
  if v_doc.owner_id = erph.actor() then
    raise exception 'Anda tidak boleh memberi maklum balas pada RPH sendiri';
  end if;

  v_label := erph.plan_label(v_doc.class_ids, v_doc.subject_code, v_doc.plan_date);

  insert into erph.rph_feedback (document_id, author_id, comment)
  values (v_doc.id, erph.actor(), v_text);

  insert into erph.notification (school_id, user_id, type, title, body, link_view)
  values (v_doc.school_id, v_doc.owner_id, 'comment'::erph.notification_type,
          'Maklum balas baharu', v_label || E'\n' || v_text,
          'editor/' || v_doc.id::text);

  insert into erph.audit_log (school_id, actor_id, entity, entity_id, action, after)
  values (v_doc.school_id, erph.actor(), 'rph_document', v_doc.id, 'comment',
          jsonb_build_object('comment', v_text));

  return jsonb_build_object('ok', true);
end $$;
