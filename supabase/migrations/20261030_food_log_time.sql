-- Log food by time of day rather than fixed meals. `meal` stays as a derived, coarse label.
alter table public.food_log add column if not exists eaten_time time;
update public.food_log set eaten_time = case meal when 0 then time '08:00' when 1 then time '13:00' when 2 then time '19:00' else time '16:00' end where eaten_time is null;
alter table public.food_log alter column eaten_time set default time '12:00';
alter table public.food_log alter column eaten_time set not null;
