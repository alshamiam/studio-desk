-- Studio contact details shown on parent reports and receipts. Editable in Setup.
alter table public.settings
  add column if not exists phone text not null default '',
  add column if not exists instagram text not null default '';
update public.settings set instagram = 'ariamusicacademy.kw' where id = 1 and instagram = '';
