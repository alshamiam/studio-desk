-- Past attendance is locked: once a lesson date has passed (Kuwait time), only a super admin can
-- change or remove its mark, and only with a reason. The reason is stored in the audit log.
alter table public.audit_log add column if not exists reason text not null default '';

create or replace function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  ch text[] := '{}';
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into ch
    from jsonb_object_keys(n) k
    where (o->k) is distinct from (n->k);
    if cardinality(ch) = 0 then return new; end if;
  elsif tg_op = 'INSERT' then
    select coalesce(array_agg(k order by k), '{}') into ch from jsonb_object_keys(n) k;
  end if;
  insert into public.audit_log (actor, actor_email, action, table_name, record_id, old_data, new_data, changed, reason)
  values (auth.uid(), private.actor_email(), tg_op, tg_table_name,
          coalesce(n->>'id', n->>'user_id', o->>'id', o->>'user_id', n->>'email', o->>'email'),
          o, n, ch, coalesce(current_setting('app.change_reason', true), ''));
  return coalesce(new, old);
end $$;

create or replace function private.guard_past_lessons() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Kuwait')::date;
  touches_past boolean := old.lesson_date < today or (tg_op = 'UPDATE' and new.lesson_date < today);
begin
  if touches_past and auth.uid() is not null then
    if not private.is_admin() then
      raise exception 'Past attendance is locked. Ask a super admin to correct it.' using errcode = '42501';
    end if;
    if coalesce(current_setting('app.change_reason', true), '') = '' then
      raise exception 'A reason is required to change past attendance.' using errcode = '22023';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger guard_past_lessons before update or delete on public.lessons for each row execute function private.guard_past_lessons();

create or replace function public.correct_lesson(p_id uuid, p_status text, p_note text, p_date date, p_reason text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', trim(p_reason), true);
  update public.lessons set status = coalesce(p_status, status), note = coalesce(p_note, note), lesson_date = coalesce(p_date, lesson_date) where id = p_id;
  if not found then raise exception 'Lesson not found or not allowed.' using errcode = '42501'; end if;
end $$;

create or replace function public.remove_lesson(p_id uuid, p_reason text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', trim(p_reason), true);
  delete from public.lessons where id = p_id;
  if not found then raise exception 'Lesson not found or not allowed.' using errcode = '42501'; end if;
end $$;

revoke execute on function public.correct_lesson(uuid,text,text,date,text), public.remove_lesson(uuid,text), private.guard_past_lessons() from public, anon;
grant execute on function public.correct_lesson(uuid,text,text,date,text), public.remove_lesson(uuid,text) to authenticated;
