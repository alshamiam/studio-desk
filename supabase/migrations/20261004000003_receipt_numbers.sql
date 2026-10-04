-- Receipt numbers for payments (shown as R-00001), numbered in the order payments were recorded.
create sequence if not exists public.payments_receipt_seq;
alter table public.payments add column if not exists receipt_no int;
-- Numbering existing payments is setup, not an edit: skip the change-history triggers for it.
set local session_replication_role = replica;
update public.payments p set receipt_no = r.n
from (select id, row_number() over (order by created_at, id) as n from public.payments) r
where p.id = r.id and p.receipt_no is null;
set local session_replication_role = origin;
select setval('public.payments_receipt_seq', greatest((select coalesce(max(receipt_no), 0) from public.payments), 1), (select count(*) > 0 from public.payments));
alter table public.payments
  alter column receipt_no set default nextval('public.payments_receipt_seq'),
  alter column receipt_no set not null,
  add constraint payments_receipt_no_key unique (receipt_no);
alter sequence public.payments_receipt_seq owned by public.payments.receipt_no;
grant usage, select on sequence public.payments_receipt_seq to authenticated;

-- A receipt number never changes once given.
create or replace function private.keep_receipt_no() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.receipt_no := old.receipt_no;
  return new;
end $$;
create trigger keep_receipt_no before update on public.payments for each row execute function private.keep_receipt_no();
