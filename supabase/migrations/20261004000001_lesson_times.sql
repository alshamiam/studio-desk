-- One-off lessons (makeups, extras) can carry their own time, so they show on the dated timetable and Today.
-- Regular lessons leave these empty and take their time from the weekly slot.
alter table public.lessons
  add column if not exists start_time text check (start_time is null or start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  add column if not exists dur int check (dur is null or dur between 5 and 240);
