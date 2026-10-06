-- Studio expenses (rent, teacher pay, instruments, ...), shown on the Payments tab next to the money coming in.
-- Super admins only. Like payments, an expense is never deleted: it is voided with a reason and stays on record.
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  amount numeric(10,3) not null check (amount > 0),
  category text not null default 'other',
  payee text not null default '',
  teacher_id text references public.teachers(id) on delete set null,
  method text not null default '',
  spent_on date not null default ((now() at time zone 'Asia/Kuwait')::date),
  note text not null default '',
  status text not null default 'paid' check (status in ('paid','void')),
  void_reason text not null default '',
  created_at timestamptz not null default now()
);
create index expenses_spent_on_idx on public.expenses(spent_on);
alter table public.expenses enable row level security;
create policy expenses_admin_read on public.expenses for select to authenticated using (private.is_admin());
create policy expenses_admin_insert on public.expenses for insert to authenticated with check (private.is_admin());
create policy expenses_admin_update on public.expenses for update to authenticated using (private.is_admin()) with check (private.is_admin());
revoke all on public.expenses from anon;
revoke delete, truncate on public.expenses from authenticated;
create trigger audit_expenses after insert or update or delete on public.expenses for each row execute function private.audit_row();
alter publication supabase_realtime add table public.expenses;
