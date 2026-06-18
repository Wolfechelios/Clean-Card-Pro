drop policy if exists "Authenticated users can upload card images" on storage.objects;
drop policy if exists "Public can read card images" on storage.objects;

create policy "Authenticated users can upload card images"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'card-images');

create policy "Public can read card images"
on storage.objects
for select
to public
using (bucket_id = 'card-images');