-- Nutrition tracking and bodyweight log

-- Reference foods (McCance & Widdowson CoFID 2021): readable by any signed-in user, written only by the importer.
create table if not exists public.food_db (
  id text primary key,
  source text not null default 'cofid',
  name text not null,
  food_group text,
  kcal numeric not null,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  fibre numeric
);
alter table public.food_db enable row level security;
create policy "read reference foods" on public.food_db for select to authenticated using (true);

-- Your foods. Values are per 100 g (or 100 ml); serving_g makes "1 slice" style servings.
create table if not exists public.foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  brand text,
  source text not null default 'custom' check (source in ('custom', 'cofid', 'off')),
  source_ref text,
  barcode text,
  kcal numeric not null check (kcal >= 0),
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  fibre numeric,
  serving_g numeric check (serving_g is null or serving_g > 0),
  serving_label text,
  favorite boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists foods_user_source_ref on public.foods (user_id, source, source_ref) where source_ref is not null;
create index if not exists foods_user on public.foods (user_id);
alter table public.foods enable row level security;
create policy "own foods" on public.foods for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  servings numeric not null default 1 check (servings > 0),
  notes text,
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recipes_user on public.recipes (user_id);
alter table public.recipes enable row level security;
create policy "own recipes" on public.recipes for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  food_id uuid not null references public.foods(id) on delete cascade,
  grams numeric not null check (grams > 0),
  position int not null default 0
);
create index if not exists recipe_items_recipe on public.recipe_items (recipe_id);
create index if not exists recipe_items_food on public.recipe_items (food_id);
create index if not exists recipe_items_user on public.recipe_items (user_id);
alter table public.recipe_items enable row level security;
create policy "own recipe items" on public.recipe_items for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id
    and exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = (select auth.uid()))
    and exists (select 1 from public.foods f where f.id = food_id and f.user_id = (select auth.uid())));

-- What you ate. Totals are stored with the entry, so editing a food later doesn't rewrite history.
create table if not exists public.food_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  eaten_on date not null,
  meal smallint not null default 0 check (meal between 0 and 3),
  kind text not null check (kind in ('food', 'recipe', 'quick')),
  food_id uuid references public.foods(id) on delete set null,
  recipe_id uuid references public.recipes(id) on delete set null,
  name text not null,
  amount numeric not null default 1 check (amount > 0),
  unit text not null default 'g' check (unit in ('g', 'serving')),
  kcal numeric not null default 0,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists food_log_user_day on public.food_log (user_id, eaten_on);
create index if not exists food_log_food on public.food_log (food_id);
create index if not exists food_log_recipe on public.food_log (recipe_id);
alter table public.food_log enable row level security;
create policy "own food log" on public.food_log for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Targets from your coach. Each row applies from its date until the next one.
create table if not exists public.nutrition_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  effective_from date not null,
  kcal int not null check (kcal > 0),
  protein int,
  carbs int,
  fat int,
  created_at timestamptz not null default now(),
  unique (user_id, effective_from)
);
alter table public.nutrition_targets enable row level security;
create policy "own nutrition targets" on public.nutrition_targets for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Scale weights, one per day.
create table if not exists public.body_weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  measured_on date not null,
  weight_kg numeric not null check (weight_kg > 20 and weight_kg < 400),
  created_at timestamptz not null default now(),
  unique (user_id, measured_on)
);
alter table public.body_weights enable row level security;
create policy "own body weights" on public.body_weights for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Bring across weigh-ins already recorded in readiness scans (latest per Irish calendar day).
insert into public.body_weights (user_id, measured_on, weight_kg, created_at)
select distinct on (user_id, (checked_at at time zone 'Europe/Dublin')::date)
  user_id, (checked_at at time zone 'Europe/Dublin')::date, bodyweight_kg, checked_at
from public.readiness_checkins
where bodyweight_kg is not null
order by user_id, (checked_at at time zone 'Europe/Dublin')::date, checked_at desc
on conflict (user_id, measured_on) do nothing;
