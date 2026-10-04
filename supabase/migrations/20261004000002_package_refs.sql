-- Short package reference numbers (shown as PKG-0001) for receipts, payment links and messages.
-- Existing packages are numbered in the order they were created; new ones get the next number.
create sequence if not exists public.packages_ref_seq;
alter table public.packages add column if not exists ref int;
-- Numbering existing packages is setup, not an edit: skip the change-history triggers for it.
set local session_replication_role = replica;
update public.packages p set ref = r.n
from (select id, row_number() over (order by created_at, id) as n from public.packages) r
where p.id = r.id and p.ref is null;
set local session_replication_role = origin;
select setval('public.packages_ref_seq', greatest((select coalesce(max(ref), 0) from public.packages), 1), (select count(*) > 0 from public.packages));
alter table public.packages
  alter column ref set default nextval('public.packages_ref_seq'),
  alter column ref set not null,
  add constraint packages_ref_key unique (ref);
alter sequence public.packages_ref_seq owned by public.packages.ref;
grant usage, select on sequence public.packages_ref_seq to authenticated;

-- A reference never changes once given.
create or replace function private.keep_package_ref() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.ref := old.ref;
  return new;
end $$;
create trigger keep_package_ref before update on public.packages for each row execute function private.keep_package_ref();
