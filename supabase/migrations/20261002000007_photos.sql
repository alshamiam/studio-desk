-- Private photos for teachers and students (signed URLs only; nothing public).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
alter table public.teachers add column if not exists photo text;
alter table public.students add column if not exists photo text;
-- Read: super admins all; members see teacher photos; student photos only for students the viewer can see (RLS on students).
create policy photos_read on storage.objects for select to authenticated using (
  bucket_id = 'photos' and (
    private.is_admin()
    or ((storage.foldername(name))[1] = 'teachers' and private.is_member())
    or ((storage.foldername(name))[1] = 'students' and exists (select 1 from public.students s where s.id = (storage.foldername(name))[2]))
  ));
-- Upload: super admins anything; a teacher only their own photo. No update/delete policies: old photos are kept.
create policy photos_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'photos' and (
    private.is_admin()
    or ((storage.foldername(name))[1] = 'teachers' and (storage.foldername(name))[2] = private.my_teacher())
  ));
