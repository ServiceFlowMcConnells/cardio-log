-- Hydration: one row per drink logged. client_id makes inserts idempotent (the Android widget queues taps
-- offline and retries; the app may flush the same queue), so a retried insert never duplicates.
create table if not exists public.water_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  logged_at timestamptz not null default now(),
  local_date date not null,
  ml integer not null check (ml > 0 and ml <= 5000),
  source text not null default 'app' check (source in ('app', 'widget', 'web')),
  client_id uuid not null unique,
  created_at timestamptz not null default now()
);
create index if not exists water_log_user_date on public.water_log (user_id, local_date);
alter table public.water_log enable row level security;
create policy "water select own" on public.water_log for select using ((select auth.uid()) = user_id);
create policy "water insert own" on public.water_log for insert with check ((select auth.uid()) = user_id);
create policy "water update own" on public.water_log for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "water delete own" on public.water_log for delete using ((select auth.uid()) = user_id);

alter table public.user_settings
  add column if not exists water_target_ml integer not null default 3000 check (water_target_ml between 1000 and 6000),
  add column if not exists water_increment_ml integer not null default 250 check (water_increment_ml between 10 and 2000);
