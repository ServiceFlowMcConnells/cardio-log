alter table public.food_log drop constraint if exists food_log_kind_check;
alter table public.food_log add constraint food_log_kind_check check (kind in ('food', 'recipe', 'quick', 'import'));
