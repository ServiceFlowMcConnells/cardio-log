-- One-off macro targets for single days (refeeds, events). They replace the plan's target on that day only.
create table if not exists public.nutrition_day_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  kcal integer not null check (kcal between 500 and 10000),
  protein integer check (protein >= 0),
  carbs integer check (carbs >= 0),
  fat integer check (fat >= 0),
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, day)
);
alter table public.nutrition_day_targets enable row level security;
create policy "day targets select own" on public.nutrition_day_targets for select using ((select auth.uid()) = user_id);
create policy "day targets insert own" on public.nutrition_day_targets for insert with check ((select auth.uid()) = user_id);
create policy "day targets update own" on public.nutrition_day_targets for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "day targets delete own" on public.nutrition_day_targets for delete using ((select auth.uid()) = user_id);
