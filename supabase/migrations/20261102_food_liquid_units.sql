-- Liquids: values per 100 ml, logged in ml / tbsp / tsp / fl oz / cup. Weight units: g / oz / lb.
alter table public.foods add column if not exists liquid boolean not null default false;
alter table public.food_db add column if not exists liquid boolean not null default false;

alter table public.food_log drop constraint if exists food_log_unit_check;
alter table public.food_log add constraint food_log_unit_check check (unit in ('g', 'oz', 'lb', 'ml', 'tsp', 'tbsp', 'floz', 'cup', 'serving'));

-- Reference foods (CoFID) that are drinks, milks and soups
update public.food_db set liquid = true
where name ~* '^(milk|.*\mjuice\M|.*\mdrinks?\M|.*smoothie|beer|lager|cider|wine|water|tea\M|coffee|cola|lemonade|squash|.*\msoup\M|kefir|buttermilk|.*milkshake)'
  and name !~* '(chocolate|powder|dried|granules|bread|biscuit|cake|crisps|instant, dry|butternut|acorn|in juice|in unsalted water|in salted water|in water)';

-- Your saved foods that are milks or drinks
update public.foods set liquid = true
where name ~* '(^milk\M|\mmilk$|\mjuice\M|\mdrinks?\M|smoothie|kefir|milkshake)' and name !~* '(chocolate|powder|bar\M)'
   or (brand ilike 'clonbawn%' or name ilike 'clonbawn%');

-- Entries for those foods logged "in grams" were really ml (values are per 100 ml): relabel, numbers unchanged
update public.food_log l set unit = 'ml' from public.foods f where l.food_id = f.id and f.liquid and l.unit = 'g';
