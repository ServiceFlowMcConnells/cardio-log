create table if not exists public.daily_activity (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  steps integer check (steps >= 0),
  sleep_minutes integer check (sleep_minutes >= 0),
  in_bed_minutes integer check (in_bed_minutes >= 0),
  deep_minutes integer, rem_minutes integer, light_minutes integer, awake_minutes integer,
  sleep_start timestamptz, sleep_end timestamptz,
  source text not null default 'health_connect',
  synced_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.daily_activity enable row level security;
create policy "own daily activity" on public.daily_activity for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter table public.user_settings add column if not exists step_target integer not null default 15000 check (step_target between 1000 and 60000);
