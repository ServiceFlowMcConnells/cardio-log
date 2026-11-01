alter table public.planned_workouts add column if not exists changes jsonb not null default '[]'::jsonb;
