-- Progress photos: one per pose per day. Images live in a private bucket under the owner's folder.
create table if not exists public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  taken_on date not null,
  pose text not null check (pose in ('front', 'side', 'back')),
  path text not null,        -- full image (cropped, 4:5)
  thumb_path text not null,  -- small version for lists and the filmstrip
  tint text,                 -- average colour, for the viewer's background
  created_at timestamptz not null default now(),
  unique (user_id, taken_on, pose)
);
alter table public.progress_photos enable row level security;
create policy "own photos select" on public.progress_photos for select using ((select auth.uid()) = user_id);
create policy "own photos insert" on public.progress_photos for insert with check ((select auth.uid()) = user_id);
create policy "own photos update" on public.progress_photos for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own photos delete" on public.progress_photos for delete using ((select auth.uid()) = user_id);
create index if not exists progress_photos_user_day on public.progress_photos (user_id, taken_on desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 5242880, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "own progress photos read" on storage.objects for select to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own progress photos write" on storage.objects for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own progress photos update" on storage.objects for update to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own progress photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
