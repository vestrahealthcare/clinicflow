-- ClinicFlow update, 2026-10-27
-- Run this whole file once in the Supabase SQL editor (project > SQL Editor > New query).
-- It is safe to run more than once. It does NOT delete rooms, history or staff.
--
-- What it does:
--   * renames the Red Berry rooms (Ocean, Dinosaurs, Space, ...)
--   * adds the "Shots" and "Other" room stages
--   * adds the DLO pickup reminder list (throat culture, strep culture, viral panel, send out lab)
--   * adds the "call with results" list for patients who leave with tests pending
--   * removes the old Chaperone and ECG request flags from any room that still has them
-- Run this BEFORE deploying the new app code.

-- ---- Time zone per clinic (used to decide what "today" means for DLO pickup) --
alter table clinics add column if not exists timezone text not null default 'America/Chicago';

-- ---- Room stages: adds 'shots' and 'other' (nurse tasks during the visit) --
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.rooms'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%stage%'
  loop
    execute format('alter table public.rooms drop constraint %I', c.conname);
  end loop;
  alter table public.rooms add constraint rooms_stage_check
    check (stage in ('vacant','ready_for_nurse','prepping','ready_for_doctor','with_doctor','shots','other','needs_cleanup'));
end $$;

-- ---- Lab samples waiting for DLO pickup -----------------------------------
-- No patient names or phone numbers anywhere: ticket number + room only.
create table if not exists lab_samples (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  room_id uuid references rooms(id) on delete set null,
  room_name text,
  ticket text,
  sample_type text not null check (sample_type in ('throat_culture','strep_culture','viral_panel','sendout_lab')),
  pickup_date date not null,
  requested_at timestamptz not null default now(),
  boxed_at timestamptz
);
create index if not exists idx_lab_samples_clinic_date on lab_samples(clinic_id, pickup_date);

-- One row per clinic per day: has someone called DLO for pickup yet?
create table if not exists lab_pickups (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  pickup_date date not null,
  dlo_called_at timestamptz,
  unique (clinic_id, pickup_date)
);

-- ---- Patients who left with tests still running: call them with results ----
create table if not exists result_callbacks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  room_id uuid references rooms(id) on delete set null,
  room_name text,
  ticket text,
  tests text[] not null default '{}',
  status text not null default 'waiting' check (status in ('waiting','ready','called')),
  departed_at timestamptz not null default now(),
  ready_at timestamptz,
  called_at timestamptz
);
create index if not exists idx_callbacks_clinic on result_callbacks(clinic_id, departed_at desc);

alter table lab_samples enable row level security;
alter table lab_pickups enable row level security;
alter table result_callbacks enable row level security;

drop policy if exists "public all lab_samples" on lab_samples;
drop policy if exists "public all lab_pickups" on lab_pickups;
drop policy if exists "public all result_callbacks" on result_callbacks;
create policy "public all lab_samples" on lab_samples for all using (true) with check (true);
create policy "public all lab_pickups" on lab_pickups for all using (true) with check (true);
create policy "public all result_callbacks" on result_callbacks for all using (true) with check (true);

do $$
begin
  begin alter publication supabase_realtime add table lab_samples; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table lab_pickups; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table result_callbacks; exception when duplicate_object then null; end;
end $$;

-- ---- Functions -------------------------------------------------------------

-- Replaces the one argument version. Extra arguments are optional, so an older
-- copy of the app that calls advance_room_stage(room_id) keeps working.
--   p_target          from 'with_doctor' only: 'shots', 'other' or 'needs_cleanup'
--   p_expected_stage  ignore the tap if the room already moved on (double taps,
--                     two tablets pressing at once)
--   p_add_callback    on departure, put the patient on the "call with results" list
--                     if RSV / Flu / Strep / COVID are still marked as pending
drop function if exists advance_room_stage(uuid);
create or replace function advance_room_stage(
  p_room_id uuid,
  p_target text default null,
  p_expected_stage text default null,
  p_add_callback boolean default false
)
returns void language plpgsql as $$
declare
  v_room rooms%rowtype;
  v_next text;
  v_elapsed_ms bigint;
  v_provider_name text;
  v_tests text[];
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found or v_room.contaminated or v_room.stage = 'vacant' then
    return;
  end if;

  if p_expected_stage is not null and p_expected_stage <> v_room.stage then
    return;
  end if;

  v_next := case v_room.stage
    when 'ready_for_nurse' then 'prepping'
    when 'prepping' then 'ready_for_doctor'
    when 'ready_for_doctor' then 'with_doctor'
    when 'with_doctor' then coalesce(p_target, 'needs_cleanup')
    when 'shots' then 'needs_cleanup'
    when 'other' then 'needs_cleanup'
    when 'needs_cleanup' then 'vacant'
  end;

  -- A target is only honored where it is a legal next step; anything else is ignored.
  if p_target is not null and p_target <> v_next then
    return;
  end if;
  if v_room.stage = 'with_doctor' and v_next not in ('shots', 'other', 'needs_cleanup') then
    return;
  end if;

  v_elapsed_ms := extract(epoch from (now() - v_room.stage_started_at)) * 1000;

  v_provider_name := null;
  if v_room.stage = 'with_doctor' then
    select name into v_provider_name from staff where id = v_room.assigned_doctor_id;
  end if;

  insert into room_history (clinic_id, room_id, stage, duration_ms, provider_name)
  values (v_room.clinic_id, v_room.id, v_room.stage, v_elapsed_ms, v_provider_name);

  if p_add_callback and v_next = 'needs_cleanup' then
    select coalesce(array_agg(k order by k), '{}') into v_tests
    from unnest(array['covid','flu','rsv','strep']) as k
    where coalesce((v_room.requests->>k)::boolean, false);

    if array_length(v_tests, 1) > 0
       and not exists (
         select 1 from result_callbacks
         where room_id = v_room.id and coalesce(ticket, '') = coalesce(v_room.ticket, '')
       ) then
      insert into result_callbacks (clinic_id, room_id, room_name, ticket, tests)
      values (v_room.clinic_id, v_room.id, v_room.name, v_room.ticket, v_tests);
    end if;
  end if;

  update rooms set
    stage = v_next,
    stage_started_at = now(),
    ticket = case when v_next = 'vacant' then null else ticket end,
    note = case when v_next = 'vacant' then null else note end,
    requests = case when v_next = 'vacant' then '{}'::jsonb else requests end,
    updated_at = now()
  where id = p_room_id;
end;
$$;

-- Toggle one boolean flag inside the requests jsonb column. Turning on a
-- throat culture, strep culture, viral panel or send out lab also adds a
-- sample to today's DLO pickup list (once per patient and sample type).
create or replace function toggle_request(p_room_id uuid, p_key text)
returns void language plpgsql as $$
declare
  v_room rooms%rowtype;
  v_new boolean;
  v_tz text;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found then
    return;
  end if;

  v_new := not coalesce((v_room.requests->>p_key)::boolean, false);

  update rooms set
    requests = jsonb_set(coalesce(requests, '{}'::jsonb), array[p_key], to_jsonb(v_new), true),
    updated_at = now()
  where id = p_room_id;

  if v_new and p_key in ('throat_culture', 'strep_culture', 'viral_panel', 'sendout_lab') then
    select coalesce(timezone, 'America/Chicago') into v_tz from clinics where id = v_room.clinic_id;
    if not exists (
      select 1 from lab_samples
      where room_id = v_room.id and coalesce(ticket, '') = coalesce(v_room.ticket, '')
        and sample_type = p_key
    ) then
      insert into lab_samples (clinic_id, room_id, room_name, ticket, sample_type, pickup_date)
      values (v_room.clinic_id, v_room.id, v_room.name, v_room.ticket, p_key,
              (now() at time zone coalesce(v_tz, 'America/Chicago'))::date);
    end if;
  end if;
end;
$$;

create or replace function set_sample_boxed(p_sample_id uuid, p_boxed boolean)
returns void language plpgsql as $$
begin
  update lab_samples
  set boxed_at = case when p_boxed then coalesce(boxed_at, now()) else null end
  where id = p_sample_id;
end;
$$;

create or replace function remove_lab_sample(p_sample_id uuid)
returns void language plpgsql as $$
begin
  delete from lab_samples where id = p_sample_id;
end;
$$;

create or replace function set_dlo_called(p_clinic_id uuid, p_called boolean)
returns void language plpgsql as $$
declare
  v_tz text;
  v_today date;
begin
  select coalesce(timezone, 'America/Chicago') into v_tz from clinics where id = p_clinic_id;
  if not found then
    return;
  end if;
  v_today := (now() at time zone v_tz)::date;

  insert into lab_pickups (clinic_id, pickup_date, dlo_called_at)
  values (p_clinic_id, v_today, case when p_called then now() else null end)
  on conflict (clinic_id, pickup_date) do update
    set dlo_called_at = case when p_called then coalesce(lab_pickups.dlo_called_at, now()) else null end;
end;
$$;

create or replace function set_callback_status(p_callback_id uuid, p_status text)
returns void language plpgsql as $$
begin
  if p_status not in ('waiting', 'ready', 'called') then
    return;
  end if;
  update result_callbacks set
    status = p_status,
    ready_at = case when p_status = 'ready' then coalesce(ready_at, now())
                    when p_status = 'waiting' then null
                    else ready_at end,
    called_at = case when p_status = 'called' then now() else null end
  where id = p_callback_id;
end;
$$;

create or replace function remove_callback(p_callback_id uuid)
returns void language plpgsql as $$
begin
  delete from result_callbacks where id = p_callback_id;
end;
$$;

-- ---- Room names for Red Berry ----------------------------------------------
update rooms r set name = v.name
from (values
  (1, 'Ocean'), (2, 'Dinosaurs'), (3, 'Space'), (4, 'Harry Potter'),
  (5, 'Monsters Inc'), (6, 'Princess'), (7, 'Farm'), (8, 'Cars'),
  (9, 'Room 9'), (10, 'Room 10'), (11, 'Room 11'), (12, 'Room 12')
) as v(room_number, name)
where r.room_number = v.room_number
  and r.clinic_id = (select id from clinics where slug = 'red-berry');

-- ---- Remove flags for buttons that no longer exist -------------------------
update rooms set requests = requests - 'chaperone' - 'ecg'
where requests ? 'chaperone' or requests ? 'ecg';

-- ---- Grants (new tables and functions need them, see README) ----------------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

notify pgrst, 'reload schema';
