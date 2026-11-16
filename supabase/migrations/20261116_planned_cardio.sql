-- Cardio planned in the week planner: a type and target minutes on a day (several per day allowed)
create table if not exists public.planned_cardio (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  planned_on date not null,
  machine text not null default 'any' check (machine in ('treadmill', 'bike', 'any')),
  minutes integer not null check (minutes between 5 and 300),
  created_at timestamptz not null default now()
);
create index if not exists planned_cardio_user_day on public.planned_cardio (user_id, planned_on);
alter table public.planned_cardio enable row level security;
create policy "planned cardio select own" on public.planned_cardio for select using ((select auth.uid()) = user_id);
create policy "planned cardio insert own" on public.planned_cardio for insert with check ((select auth.uid()) = user_id);
create policy "planned cardio delete own" on public.planned_cardio for delete using ((select auth.uid()) = user_id);
