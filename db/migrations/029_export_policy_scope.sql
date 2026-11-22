-- Export metadata follows the same supervision scope as the plan it describes.
--
-- The previous policy granted every GPK access to every export row in the
-- school. A GPK is only accountable for their assigned teachers, and the
-- document, review and signature policies already use may_supervise.

drop policy if exists export_read on erph.export_file;
create policy export_read on erph.export_file
  for select using (
    created_by = erph.actor()
    or exists (
      select 1 from erph.rph_document d
       where d.id = erph.export_file.document_id
         and erph.may_supervise(d.school_id, d.owner_id)
    )
  );
