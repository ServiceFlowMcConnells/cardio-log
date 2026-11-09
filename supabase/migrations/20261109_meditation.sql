-- Meditation: one row per session logged (minutes on a day)
create table if not exists public.meditation_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  minutes integer not null check (minutes between 1 and 600),
  created_at timestamptz not null default now()
);
create index if not exists meditation_sessions_user_day on public.meditation_sessions (user_id, day);
alter table public.meditation_sessions enable row level security;
create policy "meditation select own" on public.meditation_sessions for select using ((select auth.uid()) = user_id);
create policy "meditation insert own" on public.meditation_sessions for insert with check ((select auth.uid()) = user_id);
create policy "meditation update own" on public.meditation_sessions for update using ((select auth.uid()) = user_id);
create policy "meditation delete own" on public.meditation_sessions for delete using ((select auth.uid()) = user_id);
