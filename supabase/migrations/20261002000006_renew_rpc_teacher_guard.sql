-- Atomic renewal (insert new package, move overrun lessons with an audit reason, close old), teacher self-edit guard, indexes.
create or replace function public.renew_package(p_old text, p_new jsonb, p_move uuid[]) returns text
language plpgsql security invoker set search_path = '' as $$
declare new_id text;
begin
  if not private.is_admin() then raise exception 'Only a super admin can renew packages.' using errcode = '42501'; end if;
  perform set_config('app.change_reason', 'Renewal: extra lessons moved to the new package', true);
  insert into public.packages (id, renewed_from, student_id, teacher_id, subject, kind, sessions, per_week, start_date, end_date, term, payment, price, notes, closed)
  select r.id, p_old, r.student_id, r.teacher_id, coalesce(r.subject,''), r.kind, r.sessions, r.per_week, r.start_date, r.end_date, coalesce(r.term,''), r.payment, r.price, coalesce(r.notes,''), false
  from jsonb_populate_record(null::public.packages, p_new) r
  returning id into new_id;
  if coalesce(array_length(p_move, 1), 0) > 0 then
    update public.lessons set package_id = new_id where package_id = p_old and id = any(p_move);
  end if;
  update public.packages set closed = true where id = p_old;
  return new_id;
end $$;
revoke execute on function public.renew_package(text, jsonb, uuid[]) from public, anon;
grant execute on function public.renew_package(text, jsonb, uuid[]) to authenticated;

-- Teachers may only edit their own notes; colours must be #rrggbb.
create or replace function private.guard_teacher_self_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not private.is_admin() then
    if (new.name, new.subjects, new.color, new.sort_order, new.id) is distinct from (old.name, old.subjects, old.color, old.sort_order, old.id) then
      raise exception 'Teachers can only edit their own notes.' using errcode = '42501';
    end if;
  end if;
  if new.color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Colour must look like #a1b2c3.' using errcode = '22023'; end if;
  return new;
end $$;
create trigger guard_teacher_self_edit before update on public.teachers for each row execute function private.guard_teacher_self_edit();

create index if not exists packages_renewed_from_idx on public.packages(renewed_from);
create index if not exists profiles_teacher_idx on public.profiles(teacher_id);
alter policy profiles_read on public.profiles using (user_id = (select auth.uid()) or private.is_admin());
