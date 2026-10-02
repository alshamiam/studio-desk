-- Full change history: every insert, update and delete on every studio table,
-- with who did it, when, the full before/after row and the list of changed fields.
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_email text not null default '',
  action text not null,
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  changed text[] not null default '{}'
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_record_idx on public.audit_log (table_name, record_id);
create index audit_log_actor_idx on public.audit_log (actor, at desc);
create index audit_log_pkg_new_idx on public.audit_log ((new_data->>'package_id'));
create index audit_log_pkg_old_idx on public.audit_log ((old_data->>'package_id'));
create index audit_log_stu_new_idx on public.audit_log ((new_data->>'student_id'));
create index audit_log_stu_old_idx on public.audit_log ((old_data->>'student_id'));

create or replace function private.actor_email() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select email from public.profiles where user_id = auth.uid()),
    auth.jwt()->>'email',
    case when auth.uid() is null then 'System (database)' else '' end)
$$;

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
    if cardinality(ch) = 0 then return new; end if;  -- nothing actually changed
  elsif tg_op = 'INSERT' then
    select coalesce(array_agg(k order by k), '{}') into ch from jsonb_object_keys(n) k;
  end if;
  insert into public.audit_log (actor, actor_email, action, table_name, record_id, old_data, new_data, changed)
  values (auth.uid(), private.actor_email(), tg_op, tg_table_name,
          coalesce(n->>'id', n->>'user_id', o->>'id', o->>'user_id', n->>'email', o->>'email'),
          o, n, ch);
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['teachers','students','packages','lessons','slots','settings','profiles','app_admins'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.audit_row()', t);
  end loop;
end $$;

-- App events that are not row changes (sign-in, sign-out, Excel export). Users can only log as themselves.
create or replace function public.log_event(p_action text, p_detail jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  if p_action not in ('SIGN_IN','SIGN_OUT','EXPORT') then raise exception 'unknown event'; end if;
  insert into public.audit_log (actor, actor_email, action, table_name, record_id, new_data)
  values (auth.uid(), private.actor_email(), p_action, 'session', auth.uid()::text, coalesce(p_detail, '{}'::jsonb) - 'actor');
end $$;
revoke execute on function public.log_event(text, jsonb) from public, anon;
grant execute on function public.log_event(text, jsonb) to authenticated;
revoke execute on function private.audit_row(), private.actor_email() from public, anon, authenticated;

-- Read-only, super admins only. Nobody can edit or delete history through the API.
alter table public.audit_log enable row level security;
create policy audit_read on public.audit_log for select to authenticated using (private.is_admin());
revoke all on public.audit_log from anon;
revoke insert, update, delete, truncate on public.audit_log from authenticated;
alter publication supabase_realtime add table public.audit_log;
