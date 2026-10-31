create table if not exists public.body_fats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  measured_on date not null,
  body_fat_pct numeric not null check (body_fat_pct > 2 and body_fat_pct < 70),
  created_at timestamptz not null default now(),
  unique (user_id, measured_on)
);
alter table public.body_fats enable row level security;
create policy "own body fat" on public.body_fats for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
