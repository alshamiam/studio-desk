-- Studio Desk schema: teachers, students, packages, lessons, weekly slots, settings, profiles.
-- Helpers live in the non-exposed `private` schema. Every table has row-level security:
--   admin   -> everything
--   teacher -> their own packages, lessons and timetable (and the students in them)
--   pending -> nothing until an admin approves the account
create schema if not exists private;
grant usage on schema private to authenticated;

create table public.teachers (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  subjects text not null default '',
  color text not null default '#2f6f8f',
  notes text not null default '',
  sort_order int not null default 99,
  created_at timestamptz not null default now()
);
create table public.students (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  guardian text not null default '',
  phone text not null default '',
  reg_form text not null default 'none' check (reg_form in ('none','sent','signed')),
  notes text not null default '',
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.packages (
  id text primary key default gen_random_uuid()::text,
  student_id text not null references public.students(id) on delete restrict,
  teacher_id text not null references public.teachers(id) on delete restrict,
  subject text not null default '',
  kind text not null default 'semester' check (kind in ('semester','monthly','trial','custom')),
  sessions int not null check (sessions > 0),
  per_week int not null default 1 check (per_week between 1 and 7),
  start_date date,
  term text not null default '',
  payment text not null default 'unpaid' check (payment in ('paid','partial','unpaid')),
  paid_note text not null default '',
  price numeric(10,3),
  notes text not null default '',
  closed boolean not null default false,
  created_at timestamptz not null default now()
);
create index packages_student_idx on public.packages(student_id);
create index packages_teacher_idx on public.packages(teacher_id);
create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  package_id text not null references public.packages(id) on delete cascade,
  lesson_date date not null,
  status text not null check (status in ('present','absent','noshow','cancelled','makeup')),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (package_id, lesson_date)
);
create table public.slots (
  id text primary key default gen_random_uuid()::text,
  teacher_id text not null references public.teachers(id) on delete cascade,
  day smallint not null check (day between 0 and 6),
  start_time text not null check (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  dur int not null default 45 check (dur between 5 and 240),
  student_id text references public.students(id) on delete set null,
  label text not null default '',
  status text not null default 'confirmed' check (status in ('confirmed','tentative','blocked')),
  note text not null default ''
);
create index slots_teacher_idx on public.slots(teacher_id);
create index slots_student_idx on public.slots(student_id);
create table public.settings (
  id int primary key default 1 check (id = 1),
  school_name text not null default 'Studio Desk',
  term text not null default '',
  low_threshold int not null default 2
);
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  role text not null default 'pending' check (role in ('admin','teacher','pending')),
  teacher_id text references public.teachers(id) on delete set null,
  created_at timestamptz not null default now()
);
-- Emails listed here become admin when they sign up.
create table public.app_admins (email text primary key);

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and role = 'admin')
$$;
create or replace function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and role in ('admin','teacher'))
$$;
create or replace function private.my_teacher() returns text
language sql stable security definer set search_path = '' as $$
  select teacher_id from public.profiles where user_id = auth.uid() and role in ('admin','teacher')
$$;
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email, role)
  values (new.id, coalesce(new.email, ''),
    case when exists (select 1 from public.app_admins a where lower(a.email) = lower(new.email)) then 'admin' else 'pending' end);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();
revoke execute on function private.handle_new_user() from public, anon, authenticated;
revoke execute on function private.is_admin(), private.is_member(), private.my_teacher() from public, anon;
grant execute on function private.is_admin(), private.is_member(), private.my_teacher() to authenticated;

alter table public.teachers enable row level security;
alter table public.students enable row level security;
alter table public.packages enable row level security;
alter table public.lessons enable row level security;
alter table public.slots enable row level security;
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.app_admins enable row level security;

create policy teachers_read on public.teachers for select to authenticated using (private.is_member());
create policy teachers_admin on public.teachers for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy teachers_own_update on public.teachers for update to authenticated using (id = private.my_teacher()) with check (id = private.my_teacher());

create policy students_read on public.students for select to authenticated using (
  private.is_admin()
  or exists (select 1 from public.packages p where p.student_id = students.id and p.teacher_id = private.my_teacher())
  or exists (select 1 from public.slots s where s.student_id = students.id and s.teacher_id = private.my_teacher()));
create policy students_admin on public.students for all to authenticated using (private.is_admin()) with check (private.is_admin());

create policy packages_read on public.packages for select to authenticated using (private.is_admin() or teacher_id = private.my_teacher());
create policy packages_admin on public.packages for all to authenticated using (private.is_admin()) with check (private.is_admin());

create policy lessons_rw on public.lessons for all to authenticated
  using (private.is_admin() or exists (select 1 from public.packages p where p.id = lessons.package_id and p.teacher_id = private.my_teacher()))
  with check (private.is_admin() or exists (select 1 from public.packages p where p.id = lessons.package_id and p.teacher_id = private.my_teacher()));

create policy slots_read on public.slots for select to authenticated using (private.is_admin() or teacher_id = private.my_teacher());
create policy slots_write on public.slots for all to authenticated
  using (private.is_admin() or teacher_id = private.my_teacher())
  with check (private.is_admin() or teacher_id = private.my_teacher());

create policy settings_read on public.settings for select to authenticated using (private.is_member());
create policy settings_admin on public.settings for all to authenticated using (private.is_admin()) with check (private.is_admin());

create policy profiles_read on public.profiles for select to authenticated using (user_id = auth.uid() or private.is_admin());
create policy profiles_admin on public.profiles for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy profiles_admin_delete on public.profiles for delete to authenticated using (private.is_admin() and user_id <> auth.uid());
create policy app_admins_none on public.app_admins for select to authenticated using (false);

revoke all on public.teachers, public.students, public.packages, public.lessons, public.slots, public.settings, public.profiles, public.app_admins from anon;
revoke all on public.app_admins from authenticated;

alter publication supabase_realtime add table public.teachers, public.students, public.packages, public.lessons, public.slots, public.settings, public.profiles;
