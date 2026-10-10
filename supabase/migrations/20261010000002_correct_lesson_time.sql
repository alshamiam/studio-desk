-- Lets a super admin give a past lesson its time (e.g. an extra lesson imported without one), with a reason,
-- like any other correction to past attendance. An empty time clears it.
create or replace function public.correct_lesson_time(p_id uuid, p_time text, p_dur int, p_reason text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', trim(p_reason), true);
  update public.lessons set start_time = nullif(trim(p_time), ''), dur = case when nullif(trim(p_time), '') is null then null else p_dur end where id = p_id;
  if not found then raise exception 'Lesson not found or not allowed.' using errcode = '42501'; end if;
end $$;
revoke execute on function public.correct_lesson_time(uuid,text,int,text) from public, anon;
grant execute on function public.correct_lesson_time(uuid,text,int,text) to authenticated;
