-- Package end dates, a payments ledger, and import labels in the change history.
alter table public.packages add column end_date date;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  student_id text not null references public.students(id) on delete restrict,
  package_id text references public.packages(id) on delete set null,
  amount numeric(10,3) not null check (amount >= 0),
  method text not null default '' ,
  status text not null default 'paid' check (status in ('paid','pending')),
  kind text not null default 'package' check (kind in ('package','book','trial','single','other')),
  paid_on date,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index payments_student_idx on public.payments(student_id);
create index payments_package_idx on public.payments(package_id);
alter table public.payments enable row level security;
create policy payments_admin on public.payments for all to authenticated using (private.is_admin()) with check (private.is_admin());
revoke all on public.payments from anon;
create trigger audit_payments after insert or update or delete on public.payments for each row execute function private.audit_row();
alter publication supabase_realtime add table public.payments;

-- Lets an import label its changes in the history (e.g. "Import: Registration sheet").
create or replace function private.actor_email() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select email from public.profiles where user_id = auth.uid()),
    auth.jwt()->>'email',
    nullif(current_setting('app.change_source', true), ''),
    case when auth.uid() is null then 'System (database)' else '' end)
$$;
