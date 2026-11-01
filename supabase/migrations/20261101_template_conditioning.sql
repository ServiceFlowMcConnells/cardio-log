-- Conditioning templates: done as rounds (one set of each exercise back to back, then a rest), not counted in weekly sets
alter table public.workout_templates
  add column if not exists kind text not null default 'strength' check (kind in ('strength', 'conditioning')),
  add column if not exists rounds integer check (rounds between 1 and 30),
  add column if not exists round_rest_sec integer check (round_rest_sec between 0 and 900);
