-- Renewal chain, voidable payments, and no hard deletes.
alter table public.packages add column if not exists renewed_from text references public.packages(id) on delete set null;
alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check check (status in ('paid','pending','void'));
alter table public.payments add column if not exists void_reason text not null default '';

-- Admins insert and update; nobody signed in can delete students, packages, payments, teachers, settings or accounts.
-- (Students are archived, packages closed, payments voided.) Lessons and timetable slots can still be removed; both are audited.
create policy students_admin_insert on public.students for insert to authenticated with check (private.is_admin());
create policy students_admin_update on public.students for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy packages_admin_insert on public.packages for insert to authenticated with check (private.is_admin());
create policy packages_admin_update on public.packages for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy payments_admin_read on public.payments for select to authenticated using (private.is_admin());
create policy payments_admin_insert on public.payments for insert to authenticated with check (private.is_admin());
create policy payments_admin_update on public.payments for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy teachers_admin_insert on public.teachers for insert to authenticated with check (private.is_admin());
create policy teachers_admin_update on public.teachers for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy settings_admin_insert on public.settings for insert to authenticated with check (private.is_admin());
create policy settings_admin_update on public.settings for update to authenticated using (private.is_admin()) with check (private.is_admin());
revoke delete, truncate on public.students, public.packages, public.payments, public.teachers, public.settings, public.profiles from authenticated;
-- The older "for all" admin policies (students_admin, packages_admin, payments_admin, teachers_admin, settings_admin,
-- profiles_admin_delete) are still present but cannot grant DELETE without the table privilege revoked above.
