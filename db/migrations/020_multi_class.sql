-- ============================================================================
-- eRPH ▸ MIGRATION 020 — one plan may cover several classes
-- ============================================================================
-- Run AFTER 001a/001b/002/…/019. Safe to run more than once.
--
-- ▸ 1 ▸ the column, backfilled from the scalar it replaces ───────────────────
-- The backfill is guarded on the column it reads: on a re-run (or on a
-- database 020 already converted) `class_id` is gone, and naming it would
-- abort the whole file even though everything else is idempotent.
do $$ begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'erph' and table_name = 'rph_document'
       and column_name = 'class_id'
  ) then
    update erph.rph_document set class_ids = array[class_id] where class_ids is null;
  end if;
end $$;

alter table erph.rph_document drop constraint if exists rph_document_class_ids_check;
alter table erph.rph_document alter column class_ids set not null;
alter table erph.rph_document add constraint rph_document_class_ids_check
  check (cardinality(class_ids) between 1 and 30);

-- ▸ 2 ▸ the functions, before anything that depends on them ─────────────────
create or replace function erph.classes_in_school(p_ids uuid[], p_school uuid)
returns boolean language sql stable security definer set search_path = erph, public as $$
  select not exists (
    select 1 from unnest(p_ids) u(id)
     where not exists (
       select 1 from erph.class c where c.id = u.id and c.school_id = p_school));
$$;

create or replace function erph.teaches_classes(p_ids uuid[])
returns boolean language sql stable security definer set search_path = erph, public as $$
  select not exists (
    select 1 from unnest(p_ids) u(id)
     where not erph.teaches_class(u.id));
$$;

create or replace function erph.sync_rph(p_ops jsonb)
returns jsonb language plpgsql security definer set search_path = erph, public as $$
declare
  v_op jsonb; v_op_id uuid; v_id uuid; v_uid uuid := erph.actor();
  v_school uuid; v_doc_id uuid; v_ver int; v_status erph.rph_status;
  v_rows int; v_pct smallint; v_client_ts timestamptz;
  v_class_ids uuid[]; v_by_id boolean;
  v_out jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'Belum log masuk'; end if;
  perform set_config('app.rpc', '1', true);

  -- resolve caller's school once (all ops must belong to it)
  select school_id into v_school
    from erph.school_member where user_id = v_uid and is_active
   order by invited_at limit 1;
  if v_school is null then raise exception 'Tiada keahlian sekolah aktif'; end if;

  for v_op in select * from jsonb_array_elements(p_ops) loop
    -- One malformed op must not take the batch with it: the other
    -- twenty-four are the teacher's real work, and they were not malformed.
    -- So each op is applied inside its own block and a failure is reported
    -- rather than raised.
    --
    -- `retryable` is the distinction the client acts on. A rejection the
    -- server decided on — a class that is not in this school — will be
    -- rejected forever, so the client drops the op and tells the teacher. A
    -- failure the server did not expect may well succeed next time, so the
    -- client keeps the op and tries again, which is only possible because the
    -- block is a subtransaction: everything this op did, including the claim
    -- on its op id, has been rolled back by the time the handler runs.
    v_op_id := null;
    v_id := null;
    v_doc_id := null;
    begin
      v_op_id := (v_op->>'op_id')::uuid;
      v_id    := coalesce((v_op->>'id')::uuid, gen_random_uuid());
      v_pct    := erph.rph_completeness(v_op->'payload');
      v_client_ts := coalesce((v_op->>'client_updated_at')::timestamptz, now());

      -- 1) idempotency: replayed ops are no-ops
      insert into erph.sync_op (op_id, user_id, entity, entity_id)
      values (v_op_id, v_uid, 'rph', v_id)
      on conflict (op_id) do nothing;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        v_out := v_out || jsonb_build_array(
          jsonb_build_object('op_id', v_op_id, 'result', 'duplicate'));
        continue;
      end if;

      -- 2) the classes this op writes to. `class_ids` is the wire format now —
      -- one plan may cover several classes. A lone `class_id` is what the first
      -- release sent, and is still honoured as a one-element set: an installed
      -- PWA keeps running the app shell it precached, and refusing it would
      -- strand every queued plan on that device.
      --
      -- Canonical order is decided here, not at the client: sorted and
      -- de-duplicated, so the btree under rph_document_uniq compares equal sets
      -- as equal and the unique index keeps catching an exact-duplicate race.
      v_class_ids :=
        coalesce(
          (select array_agg(distinct x::uuid order by x::uuid)
             from jsonb_array_elements_text(v_op->'class_ids') t(x)),
          (select array[(v_op->>'class_id')::uuid]));
      if v_class_ids is null
         or exists (select 1 from unnest(v_class_ids) u(id) where u.id is null) then
        v_out := v_out || jsonb_build_array(
          jsonb_build_object('op_id', v_op_id, 'result', 'rejected', 'retryable', false,
                             'error', 'Sekurang-kurangnya satu kelas diperlukan'));
        continue;
      end if;

      -- 2b) validate every class belongs to caller's school + session
      if exists (
           select 1 from unnest(v_class_ids) u(id)
            where not exists (
              select 1 from erph.class c
               where c.id = u.id
                 and c.school_id = v_school
                 and c.session = v_op->>'session'
                 and c.is_active))
      then
        v_out := v_out || jsonb_build_array(
          jsonb_build_object('op_id', v_op_id, 'result', 'rejected', 'retryable', false,
                             'error', 'Kelas ini bukan milik sekolah atau sesi anda'));
        continue;
      end if;
      if not exists (select 1 from erph.subject where code = v_op->>'subject_code') then
        v_out := v_out || jsonb_build_array(
          jsonb_build_object('op_id', v_op_id, 'result', 'rejected', 'retryable', false,
                             'error', 'mata pelajaran tidak dikenali'));
        continue;
      end if;

      -- 3) resolve canonical row: by id, else by natural key (merge duplicates).
      --
      -- The class half of the natural key is now an *overlap* (`&&`): the same
      -- lesson written twice collides only when both claim a shared class.
      -- Disjoint sets are two different lessons and may coexist.
      --
      -- Which branch resolved the row decides how the class list merges below.
      -- An op that names its own row (by id) is authoritative and the list may
      -- shrink — that is the editor's "untick a class" doing its job. An op
      -- resolved by key is an offline duplicate, and its classes union *in*
      -- rather than overwriting, so two devices that split the classes of one
      -- lesson between them lose nothing when they finally reach the server.
      v_by_id := false;
      select id, version, status into v_doc_id, v_ver, v_status
        from erph.rph_document
       where owner_id = v_uid and deleted_at is null
         and id = v_id;
      if found then
        v_by_id := true;
      else
        select id, version, status into v_doc_id, v_ver, v_status
          from erph.rph_document
         where owner_id = v_uid and deleted_at is null
           and subject_code = v_op->>'subject_code'
           and session = v_op->>'session'
           and week_no = (v_op->>'week_no')::smallint
           and plan_date = (v_op->>'plan_date')::date
           and class_ids && v_class_ids
         limit 1;
      end if;

      if v_doc_id is not null then
        begin
        update erph.rph_document
           set -- The class list. An op that named its own row (v_by_id) is
               -- authoritative, so the set may shrink: that is the editor's
               -- "untick a class" doing its job. An op resolved by natural key
               -- is an offline duplicate, so its classes union *in* rather than
               -- overwrite, and two devices that split one lesson's classes
               -- between them lose nothing when they reach the server.
               class_ids = case when v_by_id
                                then v_class_ids
                                else (select array_agg(distinct x order by x)
                                        from unnest(erph.rph_document.class_ids
                                                    || v_class_ids) t(x))
                           end,
               -- A plan a reviewer is reading is not editable. The editor already
               -- locks a plan once it has been submitted (`weekLocked`), and the
               -- server now says the same: only a draft, or a returned plan the
               -- teacher is fixing, may be rewritten. Without this a client that
               -- bypassed the editor could change the content of a plan sitting
               -- in a reviewer's queue — and the version would move under the
               -- signature that reviewer is about to make.
               payload = case when status in ('draft','returned')
                              then v_op->'payload' else payload end,
               version = version + case when status in ('draft','returned')
                              then 1 else 0 end,
               client_updated_at = v_client_ts,
               slot_time = coalesce((v_op->>'slot_time')::time, slot_time),
               slot_time_end = coalesce((v_op->>'slot_time_end')::time, slot_time_end),
               content_hash = case when status in ('draft','returned')
                              then coalesce(v_op->>'content_hash', content_hash)
                              else content_hash end,
               -- Status is server-managed. The client may request only:
               --   • nothing (null)     → keep current state
               --   • 'submitted'        → allowed ONLY when 100% complete
               -- Everything else (including leaving approved/returned) is dropped,
               -- so sync can never bypass submit_rph()'s completeness gate or
               -- let a teacher self-approve their own plan.
               status = case
                          when v_op->>'status' is null then status
                          when status in ('approved', 'returned')
                               and v_op->>'status' <> 'submitted' then status
                          when v_op->>'status' = 'submitted' and v_pct = 100
                            then 'submitted'::erph.rph_status
                          when v_op->>'status' = 'submitted' then status
                          -- Dropped, as the comment above says: an unrecognised
                          -- status leaves the plan where it is. It used to become
                          -- 'draft', which let a client withdraw its own plan
                          -- from a reviewer's queue without going through
                          -- submit_rph() at all.
                          else status
                        end,
               submitted_at = case when v_op->>'status' = 'submitted' and v_pct = 100
                                   and submitted_at is null
                                   then now() else submitted_at end
         where id = v_doc_id and owner_id = v_uid
        returning version, status into v_ver, v_status;
        exception when unique_violation then
          -- The by-id rewrite claimed a class set that collides with another
          -- live plan on the same subject, week and date — a teacher unticking
          -- one class while a second plan still claims another. Refusing would
          -- leave the op retryable and the queue stuck behind it, so instead
          -- the lists union and the teacher resolves the overlap in the editor.
          update erph.rph_document
             set class_ids = (select array_agg(distinct x order by x)
                                from unnest(erph.rph_document.class_ids
                                            || v_class_ids) t(x)),
                payload = case when status in ('draft','returned')
                               then v_op->'payload' else payload end,
                version = version + case when status in ('draft','returned')
                               then 1 else 0 end,
                client_updated_at = v_client_ts,
                slot_time = coalesce((v_op->>'slot_time')::time, slot_time),
                slot_time_end = coalesce((v_op->>'slot_time_end')::time, slot_time_end),
                content_hash = case when status in ('draft','returned')
                               then coalesce(v_op->>'content_hash', content_hash)
                               else content_hash end,
                status = case
                          when v_op->>'status' is null then status
                          when status in ('approved', 'returned')
                               and v_op->>'status' <> 'submitted' then status
                          when v_op->>'status' = 'submitted' and v_pct = 100
                            then 'submitted'::erph.rph_status
                          else status
                        end,
                submitted_at = case when v_op->>'status' = 'submitted' and v_pct = 100
                                    and submitted_at is null
                                    then now() else submitted_at end
          where id = v_doc_id and owner_id = v_uid
        returning version, status into v_ver, v_status;
        end;
      else
        begin
          insert into erph.rph_document
            (id, school_id, owner_id, class_ids, subject_code, session, week_no, plan_date,
             slot_time, slot_time_end, payload, status, version, client_updated_at, content_hash, submitted_at)
          values
            (v_id, v_school, v_uid, v_class_ids, v_op->>'subject_code',
             v_op->>'session', (v_op->>'week_no')::smallint, (v_op->>'plan_date')::date,
             coalesce((v_op->>'slot_time')::time, '07:30'::time),
             coalesce((v_op->>'slot_time_end')::time, '12:40'::time),
             v_op->'payload',
             -- New documents are always drafts: submitting is an explicit act
             -- through submit_rph(), and the same 100% gate applies here.
             case when v_op->>'status' = 'submitted' and v_pct = 100
                  then 'submitted'::erph.rph_status
                  else 'draft'::erph.rph_status end,
             1, v_client_ts, v_op->>'content_hash',
             case when v_op->>'status' = 'submitted' and v_pct = 100 then now() end)
          returning id, version, status into v_doc_id, v_ver, v_status;
        exception when unique_violation then
          -- race: another request created the same logical plan → merge into it.
          -- The class lists union: the racing op may have arrived with a wider
          -- set than the row that won the insert, and dropping a class here
          -- would strand a lesson a device already filed.
          update erph.rph_document
             set class_ids = (select array_agg(distinct x order by x)
                                from unnest(erph.rph_document.class_ids
                                            || v_class_ids) t(x)),
                 -- Same rule as the branch above: a plan under review is not
                 -- rewritten, and its version does not move either.
                 payload = case when status in ('draft','returned')
                                then v_op->'payload' else payload end,
                 version = version + case when status in ('draft','returned')
                                then 1 else 0 end,
                 client_updated_at = v_client_ts,
                 slot_time = coalesce((v_op->>'slot_time')::time, slot_time),
                 slot_time_end = coalesce((v_op->>'slot_time_end')::time, slot_time_end)
           where owner_id = v_uid
             and class_ids && v_class_ids
             and subject_code = v_op->>'subject_code'
             and session = v_op->>'session'
             and week_no = (v_op->>'week_no')::smallint
             and plan_date = (v_op->>'plan_date')::date
             and deleted_at is null
          returning id, version, status into v_doc_id, v_ver, v_status;
        end;
      end if;

      if v_doc_id is null then
        v_out := v_out || jsonb_build_array(
          jsonb_build_object('op_id', v_op_id, 'result', 'rejected', 'retryable', false,
                             'error', 'tidak dapat mengenal pasti rujukan dokumen'));
        continue;
      end if;

      insert into erph.rph_revision (document_id, version, payload, completeness, actor_id, reason)
      values (v_doc_id, v_ver, v_op->'payload', v_pct, v_uid, 'sync')
      on conflict (document_id, version) do nothing;

      update erph.sync_op set result = jsonb_build_object('id', v_doc_id, 'version', v_ver)
       where op_id = v_op_id;

      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'op_id', v_op_id, 'result', 'applied', 'id', v_doc_id,
        'version', v_ver, 'status', v_status, 'completeness', v_pct));
    exception when others then
      -- The block is a subtransaction, so everything this op did — the claim on
      -- its op id included — has been rolled back by the time the handler
      -- runs. The op id is therefore still free and the client can retry the
      -- very same op. Burnt, it would come back as 'duplicate' and the
      -- client's queue would drop it: the teacher's edit, gone, because the
      -- server had a bad minute.
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('op_id', coalesce(v_op_id::text, v_op->>'op_id'),
                           'result', 'rejected', 'retryable', true,
                           'error', left(sqlerrm, 160)));
    end;
  end loop;

  return v_out;
end $$;

create or replace function erph.pantau_teachers(p_school uuid, p_session text,
                                                p_first_week smallint,
                                                p_last_week smallint)
returns table (user_id uuid, full_name text, role erph.member_role,
               week_total bigint, week_done bigint,
               session_total bigint, session_done bigint,
               returned_total bigint, fixed_total bigint,
               last_reviewed_at timestamptz,
               classes text)
language sql stable security definer set search_path = erph, public as $$
  select m.user_id, u.full_name, m.role,
         count(d.id) filter (where d.week_no between p_first_week and p_last_week),
         count(d.id) filter (where d.week_no between p_first_week and p_last_week
                             and d.status = 'approved'),
         count(d.id),
         count(d.id) filter (where d.status = 'approved'),
         -- Of the plans this teacher has had sent back, and how many are
         -- approved now. This is the pair that separates a teacher who acts on
         -- feedback from one who does not: `returned_t` alone counts who is
         -- *currently* returned, so a teacher who fixes everything and one who
         -- ignores every return look identical once the first is caught up.
         --
         -- Read from rph_review rather than the document, because the document
         -- only ever carries the latest decision — the history of a plan that
         -- was returned and then approved is exactly what makes it "fixed".
         (select count(*) from erph.rph_document d2
           where d2.owner_id = m.user_id and d2.school_id = p_school
             and d2.session = p_session and d2.deleted_at is null
             and exists (select 1 from erph.rph_review r
                          where r.document_id = d2.id and r.grade = 0)),
         (select count(*) from erph.rph_document d2
           where d2.owner_id = m.user_id and d2.school_id = p_school
             and d2.session = p_session and d2.deleted_at is null
             and exists (select 1 from erph.rph_review r
                          where r.document_id = d2.id and r.grade = 0)
             and exists (select 1 from erph.rph_review r
                          where r.document_id = d2.id and r.grade = 1)),
         max(d.reviewed_at),
         -- Classes per teacher, as a self-contained subquery rather than a
         -- join: a plan now covers several classes, so joining class onto the
         -- document would multiply every row of it and inflate the counts
         -- above — and the function body is SQL with a GROUP BY on the
         -- teacher, which an outer reference to d.class_ids cannot survive.
         (select string_agg(distinct c.nama, ', ' order by c.nama)
            from erph.rph_document d2
            join erph.class c on c.id = any(d2.class_ids)
           where d2.owner_id = m.user_id
             and d2.school_id = p_school
             and d2.session = p_session
             and d2.deleted_at is null)
    from erph.school_member m
    join erph.user u on u.id = m.user_id
    left join erph.rph_document d
           on d.owner_id = m.user_id
          and d.school_id = m.school_id
          and d.session = p_session
          and d.deleted_at is null
   where m.school_id = p_school
     and m.is_active
     and m.role in ('guru_biasa','gpk','guru_besar')
     -- The scope, applied to the *result* rather than to a join: the pentadbir
     -- passes only for their own row, a GPK for themselves and their assigned
     -- teachers, a Guru Besar for everyone. `system` never reaches here at all.
     and erph.may_supervise(p_school, m.user_id)
   group by m.user_id, u.full_name, m.role
   order by u.full_name;
$$;

create or replace function erph.admin_list_classes(p_school uuid, p_session text)
returns table (id uuid, nama text, tahun smallint, tingkatan smallint,
               is_active boolean, doc_count bigint)
language sql stable security definer set search_path = erph, public as $$
  select c.id, c.nama, c.tahun, c.tingkatan, c.is_active,
         (select count(*) from erph.rph_document d
           where c.id = any(d.class_ids) and d.deleted_at is null)
    from erph.class c
   where c.school_id = p_school and c.session = p_session
     and erph.has_role(p_school, array['pentadbir']::erph.member_role[])
   order by c.is_active desc, c.nama;
$$;

-- ▸ 3 ▸ the policies, rebuilt on the array forms ────────────────────────────
drop policy if exists rph_owner_insert on erph.rph_document;
drop policy if exists rph_owner_update on erph.rph_document;

create policy rph_owner_insert on erph.rph_document
  for insert with check (
    owner_id = erph.actor()
    and school_id in (select unnest(erph.my_schools()))
    and erph.classes_in_school(class_ids, school_id)
    and erph.teaches_classes(class_ids)
  );
create policy rph_owner_update on erph.rph_document
  for update using (owner_id = erph.actor() and deleted_at is null)
  with check (
    owner_id = erph.actor()
    and school_id in (select unnest(erph.my_schools()))
    and erph.classes_in_school(class_ids, school_id)
  );
-- ▸ 4 ▸ the idempotency key, and then the column itself ─────────────────────
drop index if exists erph.rph_document_uniq;

create unique index if not exists rph_document_uniq
  on erph.rph_document (owner_id, class_ids, subject_code, session, week_no, plan_date)
  where deleted_at is null;

alter table erph.rph_document drop column if exists class_id;
