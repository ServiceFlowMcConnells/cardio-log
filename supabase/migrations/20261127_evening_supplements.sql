-- Your own supplement list (retired, never deleted, so history keeps its names) and the evening check-in.
create table if not exists public.supplement_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slot text not null check (slot in ('waking', 'breakfast', 'lunch', 'dinner', 'bed')),
  name text not null check (char_length(name) between 1 and 80),
  dose text not null default '' check (char_length(dose) <= 120),
  benefit text check (char_length(benefit) <= 400),
  evidence text check (evidence in ('strong', 'moderate', 'limited')),
  position integer not null default 0,
  retired_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists supplement_items_user on public.supplement_items (user_id, slot, position);
alter table public.supplement_items enable row level security;
create policy "supplement items select own" on public.supplement_items for select to authenticated using ((select auth.uid()) = user_id);
create policy "supplement items insert own" on public.supplement_items for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "supplement items update own" on public.supplement_items for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "supplement items delete own" on public.supplement_items for delete to authenticated using ((select auth.uid()) = user_id);

-- One evening check-in per day. `stack` is a snapshot of the list that day: [{id, name, dose, slot, taken}],
-- so later edits to the list never change past days.
create table if not exists public.evening_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  stack jsonb not null default '[]'::jsonb,
  stress smallint check (stress between 1 and 5),
  day_rating smallint check (day_rating between 1 and 5),
  screens_before_bed boolean,
  gratitude text[] not null default '{}' check (array_length(gratitude, 1) is null or array_length(gratitude, 1) <= 3),
  note text check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);
alter table public.evening_checkins enable row level security;
create policy "evening select own" on public.evening_checkins for select to authenticated using ((select auth.uid()) = user_id);
create policy "evening insert own" on public.evening_checkins for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "evening update own" on public.evening_checkins for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "evening delete own" on public.evening_checkins for delete to authenticated using ((select auth.uid()) = user_id);
