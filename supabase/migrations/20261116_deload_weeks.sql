-- Deload weeks flagged in the week planner: the 7 days from week_start
create table if not exists public.deload_weeks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start date not null,
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);
alter table public.deload_weeks enable row level security;
create policy "deload select own" on public.deload_weeks for select using ((select auth.uid()) = user_id);
create policy "deload insert own" on public.deload_weeks for insert with check ((select auth.uid()) = user_id);
create policy "deload delete own" on public.deload_weeks for delete using ((select auth.uid()) = user_id);
