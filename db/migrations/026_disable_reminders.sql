-- Remove the ability to send reminders through PostgREST, not just the UI.
revoke execute on function erph.remind_teachers(uuid, text, smallint, uuid[])
  from public, anon, authenticated, service_role;
