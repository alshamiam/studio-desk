-- Renewal now also moves lessons marked on or after the new package's start date; say so in the audit reason.
create or replace function public.renew_package(p_old text, p_new jsonb, p_move uuid[]) returns text
language plpgsql security invoker set search_path = '' as $$
declare new_id text;
begin
  if not private.is_admin() then raise exception 'Only a super admin can renew packages.' using errcode = '42501'; end if;
  perform set_config('app.change_reason', 'Renewal: lessons from the new start date and extra lessons moved to the new package', true);
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
