-- A payment can name its teacher directly, for trial lessons and single sessions paid before
-- the student has a package. A payment on a package still takes its teacher from the package.
alter table public.payments add column if not exists teacher_id text references public.teachers(id) on delete set null;
create index if not exists payments_teacher_idx on public.payments(teacher_id);
