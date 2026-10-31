-- Daily totals for nutrition trends (RLS of food_log applies through security_invoker)
create or replace view public.food_log_daily with (security_invoker = true) as
select user_id, eaten_on, count(*)::int as entries,
       round(sum(kcal))::int as kcal, round(sum(protein), 1) as protein, round(sum(carbs), 1) as carbs, round(sum(fat), 1) as fat
from public.food_log
group by user_id, eaten_on;
grant select on public.food_log_daily to authenticated;
