-- The readiness load cut a workout was done under (1 = full plan), so the coach can progress from your last full session
alter table public.workouts add column if not exists load_factor numeric not null default 1 check (load_factor > 0 and load_factor <= 1);
update public.workouts w set load_factor = case when c.score >= 70 then 1 when c.score >= 55 then 0.95 when c.score >= 40 then 0.9 else 0.85 end
from public.readiness_checkins c where c.id = w.checkin_id;
