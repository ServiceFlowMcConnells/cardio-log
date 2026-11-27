-- Readiness scan: sickness (symptoms and what to do with today's session), daily mood and the fortnightly GAD-7.
alter table public.readiness_checkins
  add column if not exists sick boolean not null default false,
  add column if not exists symptoms text[] not null default '{}',
  add column if not exists sick_choice text check (sick_choice in ('normal', 'light', 'rest')),
  add column if not exists mood smallint check (mood between 1 and 5),
  add column if not exists gad7 smallint[] check (gad7 is null or (array_length(gad7, 1) = 7 and 0 <= all(gad7) and 3 >= all(gad7))),
  add column if not exists gad7_skipped boolean not null default false;
