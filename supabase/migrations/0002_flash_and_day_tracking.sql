-- ClinicFlow migration 0002
-- Additive only — does not touch supabase/schema.sql or any existing data.
-- Run this once in the Supabase SQL editor for the red-berry project.

-- ------------------------------------------------------------- bug fix --
-- `staff` was created but never added to the realtime publication (only
-- rooms/calls were, back in schema.sql). That means every add/rename/
-- remove in Admin > Providers and nurses was silently succeeding in the
-- database the whole time — the roster just never refreshed on screen
-- without a manual page reload, which is why "Add provider" looked broken.
alter publication supabase_realtime add table staff;

-- --------------------------------------------------------- room flashing --
-- Whole-box flash toggle a nurse/provider can fire from their room tablet
-- to get the hallway board's attention, independent of the urgent-request
-- flash that already exists for chaperone/nurse-call.
alter table rooms add column if not exists flashing boolean not null default false;

create or replace function toggle_room_flash(p_room_id uuid, p_on boolean)
returns void language plpgsql as $$
begin
  update rooms set flashing = p_on, updated_at = now() where id = p_room_id;
end;
$$;

-- ------------------------------------------------------------ clinic_days --
-- One row per operating day. Start/End Day buttons in Admin stamp
-- opened_at/closed_at; ending a day snapshots that day's stage averages so
-- history survives even after room_history ages out of the 30-day window.
create table if not exists clinic_days (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  day_date date not null,
  scheduled_start time not null default '09:00',
  scheduled_end time not null default '17:00',
  opened_at timestamptz,
  closed_at timestamptz,
  total_visits int,
  avg_ready_for_nurse_ms bigint,
  avg_prepping_ms bigint,
  avg_ready_for_doctor_ms bigint,
  avg_with_doctor_ms bigint,
  avg_needs_cleanup_ms bigint,
  created_at timestamptz not null default now(),
  unique (clinic_id, day_date)
);

alter table clinic_days enable row level security;
create policy "public read clinic_days" on clinic_days for select using (true);
create policy "public write clinic_days" on clinic_days for all using (true) with check (true);

alter publication supabase_realtime add table clinic_days;

-- Idempotent: pressing Start Day twice in one day just no-ops the second time.
create or replace function start_clinic_day(p_clinic_id uuid)
returns uuid language plpgsql as $$
declare
  v_id uuid;
  v_today date := current_date;
begin
  insert into clinic_days (clinic_id, day_date, opened_at)
  values (p_clinic_id, v_today, now())
  on conflict (clinic_id, day_date) do update set
    opened_at = coalesce(clinic_days.opened_at, excluded.opened_at)
  returning id into v_id;
  return v_id;
end;
$$;

-- Snapshots averages since the day's opened_at (falls back to midnight if
-- End Day is pressed without a matching Start Day) so the daily record is
-- self-contained even once room_history rolls off.
create or replace function end_clinic_day(p_clinic_id uuid)
returns void language plpgsql as $$
declare
  v_today date := current_date;
  v_since timestamptz;
begin
  select opened_at into v_since from clinic_days where clinic_id = p_clinic_id and day_date = v_today;
  if v_since is null then
    v_since := date_trunc('day', now());
    insert into clinic_days (clinic_id, day_date, opened_at) values (p_clinic_id, v_today, v_since)
    on conflict (clinic_id, day_date) do nothing;
  end if;

  update clinic_days set
    closed_at = now(),
    total_visits = (
      select count(*) from room_history
      where clinic_id = p_clinic_id and stage = 'needs_cleanup' and ended_at >= v_since
    ),
    avg_ready_for_nurse_ms = (
      select avg(duration_ms) from room_history
      where clinic_id = p_clinic_id and stage = 'ready_for_nurse' and ended_at >= v_since
    ),
    avg_prepping_ms = (
      select avg(duration_ms) from room_history
      where clinic_id = p_clinic_id and stage = 'prepping' and ended_at >= v_since
    ),
    avg_ready_for_doctor_ms = (
      select avg(duration_ms) from room_history
      where clinic_id = p_clinic_id and stage = 'ready_for_doctor' and ended_at >= v_since
    ),
    avg_with_doctor_ms = (
      select avg(duration_ms) from room_history
      where clinic_id = p_clinic_id and stage = 'with_doctor' and ended_at >= v_since
    ),
    avg_needs_cleanup_ms = (
      select avg(duration_ms) from room_history
      where clinic_id = p_clinic_id and stage = 'needs_cleanup' and ended_at >= v_since
    )
  where clinic_id = p_clinic_id and day_date = v_today;
end;
$$;
