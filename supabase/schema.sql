-- ClinicFlow schema
-- Multi-tenant: every table hangs off a `clinics` row via clinic_id, so adding
-- a second clinic (Gun Lake, Tunica, ...) is a data insert, never a code change.
--
-- Run this whole file once in the Supabase SQL editor for a fresh project.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- clinics --
create table if not exists clinics (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  room_count int not null default 12,
  next_ticket_num int not null default 1,
  timezone text not null default 'America/Chicago',
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------- hallways --
create table if not exists hallways (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  key text not null,
  label text not null,
  color text not null,
  sort_order int not null default 0,
  unique (clinic_id, key)
);

-- ------------------------------------------------------------------ staff --
-- `color` is kept for backward compatibility but the app no longer displays
-- it per person: room and board accents use a fixed role color instead
-- (every provider blue, every nurse green) so the color stays meaningful
-- regardless of roster size. Up to 6 nurses and 6 providers per clinic,
-- enforced in the app (Admin > Providers and nurses), not by the database.
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  role text not null check (role in ('nurse', 'doctor')),
  color text not null,
  sort_order int not null default 0
);

-- ------------------------------------------------------------------ rooms --
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  room_number int not null,
  name text not null,
  hallway_id uuid references hallways(id),
  side text not null check (side in ('left', 'right')),
  stage text not null default 'vacant'
    check (stage in ('vacant','ready_for_nurse','prepping','ready_for_doctor','with_doctor','shots','other','needs_cleanup')),
  stage_started_at timestamptz not null default now(),
  contaminated boolean not null default false,
  assigned_nurse_id uuid references staff(id) on delete set null,
  assigned_doctor_id uuid references staff(id) on delete set null,
  ticket text,
  note text,
  requests jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (clinic_id, room_number)
);

-- ------------------------------------------------------------ room_history --
-- One row per completed stage, used by the admin dashboard's averages.
create table if not exists room_history (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  stage text not null,
  duration_ms bigint not null,
  provider_name text,
  ended_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ calls --
-- Log of front-desk assignments, read by the waiting-room display.
create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  ticket text not null,
  called_at timestamptz not null default now()
);

create index if not exists idx_rooms_clinic on rooms(clinic_id);
create index if not exists idx_history_clinic on room_history(clinic_id);
create index if not exists idx_calls_clinic_time on calls(clinic_id, called_at desc);

-- ---------------------------------------------------------------- security --
-- No per-user login by design (open device access, per spec). RLS is enabled
-- and grants full read/write to anyone holding the anon key, which is the
-- same trust model as an unlocked kiosk tablet. See README "Security note"
-- before putting this on a network you don't control.
alter table clinics enable row level security;
alter table hallways enable row level security;
alter table staff enable row level security;
alter table rooms enable row level security;
alter table room_history enable row level security;
alter table calls enable row level security;

create policy "public read clinics" on clinics for select using (true);
create policy "public read hallways" on hallways for select using (true);
create policy "public read staff" on staff for select using (true);
create policy "public write staff" on staff for all using (true) with check (true);
create policy "public read rooms" on rooms for select using (true);
create policy "public write rooms" on rooms for update using (true) with check (true);
create policy "public read history" on room_history for select using (true);
create policy "public write history" on room_history for insert with check (true);
create policy "public read calls" on calls for select using (true);
create policy "public write calls" on calls for insert with check (true);
create policy "public write clinics" on clinics for update using (true) with check (true);

-- Realtime: tell Supabase to broadcast changes on the tables the UI subscribes to.
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table calls;

-- ============================================================== functions --

-- Set or clear contamination lockout. Clearing assumes the deep clean happened
-- and returns the room straight to vacant.
create or replace function set_lockout(p_room_id uuid, p_on boolean)
returns void language plpgsql as $$
begin
  if p_on then
    update rooms set contaminated = true, updated_at = now() where id = p_room_id;
  else
    update rooms set
      contaminated = false, stage = 'vacant', stage_started_at = now(),
      ticket = null, note = null, requests = '{}'::jsonb, updated_at = now()
    where id = p_room_id;
  end if;
end;
$$;

create or replace function set_room_note(p_room_id uuid, p_note text)
returns void language plpgsql as $$
begin
  update rooms set note = nullif(trim(p_note), ''), updated_at = now() where id = p_room_id;
end;
$$;

create or replace function set_room_staffing(p_room_id uuid, p_nurse_id uuid, p_doctor_id uuid)
returns void language plpgsql as $$
begin
  update rooms set assigned_nurse_id = p_nurse_id, assigned_doctor_id = p_doctor_id, updated_at = now()
  where id = p_room_id;
end;
$$;

create or replace function set_clinic_room_count(p_clinic_id uuid, p_count int)
returns void language plpgsql as $$
begin
  update clinics set room_count = p_count where id = p_clinic_id;
end;
$$;

-- Front desk: assign the next ticket number to a vacant room and mark it
-- "ready for nurse". Returns the ticket so the UI can show the self-rooming banner.
create or replace function assign_patient(p_room_id uuid)
returns text language plpgsql as $$
declare
  v_clinic_id uuid;
  v_ticket_num int;
  v_ticket text;
  v_updated int;
begin
  select clinic_id into v_clinic_id from rooms where id = p_room_id;

  update clinics set next_ticket_num = next_ticket_num + 1
  where id = v_clinic_id
  returning next_ticket_num - 1 into v_ticket_num;

  v_ticket := 'A-0' || v_ticket_num;

  update rooms set
    stage = 'ready_for_nurse', stage_started_at = now(), ticket = v_ticket, updated_at = now()
  where id = p_room_id and stage = 'vacant' and contaminated = false;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return null;
  end if;

  insert into calls (clinic_id, room_id, ticket) values (v_clinic_id, p_room_id, v_ticket);
  return v_ticket;
end;
$$;

-- ============================================ shots, lab pickup, callbacks --
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

-- ====================== initials, directions, I've got it, check-out --
-- ---- Patient initials, room directions, "I've got it" claims, follow up ------
-- Initials are a patient identifier. They live on the room only until
-- check-out, then on the waiting room list until "Pt departed" clears them.
alter table rooms add column if not exists initials text;
alter table rooms add column if not exists directions text;
alter table rooms add column if not exists claims jsonb not null default '{}'::jsonb;
alter table rooms add column if not exists followup jsonb;
alter table calls add column if not exists initials text;
alter table lab_samples add column if not exists initials text;
alter table result_callbacks add column if not exists initials text;

-- ---- Patients checked out and back in the waiting room ----------------------
create table if not exists checkouts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  room_name text,
  ticket text,
  initials text,
  followup_timeframe text check (followup_timeframe in ('1_week','3_months','6_months','other')),
  followup_reason text check (followup_reason in ('weight_check','asthma','medication_fu','generic')),
  followup_claimed_by text,
  checked_out_at timestamptz not null default now(),
  departed_at timestamptz
);
create index if not exists idx_checkouts_clinic on checkouts(clinic_id, checked_out_at desc);

alter table checkouts enable row level security;
drop policy if exists "public all checkouts" on checkouts;
create policy "public all checkouts" on checkouts for all using (true) with check (true);

do $$
begin
  begin alter publication supabase_realtime add table checkouts; exception when duplicate_object then null; end;
end $$;

-- ---- Front desk staff, WCC follow ups, follow up note, results note ----------------
-- Staff roles: add 'frontdesk' so front desk names can tap "I've got it" in one tap.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.staff'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.staff drop constraint %I', c.conname);
  end loop;
  alter table public.staff add constraint staff_role_check check (role in ('nurse', 'doctor', 'frontdesk'));
end $$;

-- Follow up reasons: add 'wcc' (well child check), and a free text note.
alter table checkouts add column if not exists followup_note text;
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.checkouts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%followup_reason%'
  loop
    execute format('alter table public.checkouts drop constraint %I', c.conname);
  end loop;
  alter table public.checkouts add constraint checkouts_followup_reason_check
    check (followup_reason in ('weight_check','asthma','medication_fu','wcc','generic'));
end $$;

-- Free text results on each "Call with results" task.
alter table result_callbacks add column if not exists result_note text;

-- ---- Functions ----------------------------------------------------------------

-- Front desk check in: takes the patient's initials (letters only, up to 4) and,
-- when p_set_doctor is true, the provider for this visit (null means any provider).
-- Remove every existing version of the functions below first, whatever their
-- argument names or counts. Postgres refuses to "replace" a function whose input
-- parameter names differ (for example an older assign_patient(p_room_id, p_label)),
-- so this makes the script work on any copy of the database.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'assign_patient', 'advance_room_stage', 'check_out_room', 'toggle_request',
        'set_room_note', 'set_lockout', 'set_followup', 'claim_request',
        'claim_checkout_followup', 'set_checkout_departed', 'set_room_directions',
        'set_callback_note', 'reset_day'
      )
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;
create or replace function assign_patient(
  p_room_id uuid,
  p_initials text default null,
  p_doctor_id uuid default null,
  p_set_doctor boolean default false
)
returns text language plpgsql as $$
declare
  v_clinic_id uuid;
  v_ticket_num int;
  v_ticket text;
  v_updated int;
  v_initials text;
begin
  select clinic_id into v_clinic_id from rooms where id = p_room_id;
  v_initials := nullif(upper(left(regexp_replace(coalesce(p_initials, ''), '[^A-Za-z]', '', 'g'), 4)), '');

  update clinics set next_ticket_num = next_ticket_num + 1
  where id = v_clinic_id
  returning next_ticket_num - 1 into v_ticket_num;

  v_ticket := 'A-0' || v_ticket_num;

  update rooms set
    stage = 'ready_for_nurse', stage_started_at = now(), ticket = v_ticket,
    initials = v_initials, claims = '{}'::jsonb, followup = null,
    assigned_doctor_id = case when p_set_doctor then p_doctor_id else assigned_doctor_id end,
    updated_at = now()
  where id = p_room_id and stage = 'vacant' and contaminated = false;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return null;
  end if;

  insert into calls (clinic_id, room_id, ticket, initials) values (v_clinic_id, p_room_id, v_ticket, v_initials);
  return v_ticket;
end;
$$;

-- Same signature as before. Adds: initials on call-with-results rows, a fresh
-- "I've got it" state when a room enters Shots, and a full reset when the room
-- goes back to vacant.
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
      insert into result_callbacks (clinic_id, room_id, room_name, ticket, initials, tests)
      values (v_room.clinic_id, v_room.id, v_room.name, v_room.ticket, v_room.initials, v_tests);
    end if;
  end if;

  update rooms set
    stage = v_next,
    stage_started_at = now(),
    ticket = case when v_next = 'vacant' then null else ticket end,
    initials = case when v_next = 'vacant' then null else initials end,
    note = case when v_next = 'vacant' then null else note end,
    requests = case when v_next = 'vacant' then '{}'::jsonb else requests end,
    claims = case when v_next = 'vacant' then '{}'::jsonb
                  when v_next = 'shots' then claims - 'shots'
                  else claims end,
    followup = case when v_next = 'vacant' then null else followup end,
    updated_at = now()
  where id = p_room_id;
end;
$$;

-- "Check-out": the room goes to cleanup, the patient goes to the waiting room
-- list (with any follow up request), and nothing patient specific stays on the room.
create or replace function check_out_room(
  p_room_id uuid,
  p_expected_stage text default null,
  p_add_callback boolean default false
)
returns void language plpgsql as $$
declare
  v_room rooms%rowtype;
  v_after text;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found or v_room.contaminated or v_room.stage not in ('with_doctor', 'shots', 'other') then
    return;
  end if;
  if p_expected_stage is not null and p_expected_stage <> v_room.stage then
    return;
  end if;

  perform advance_room_stage(p_room_id, 'needs_cleanup', v_room.stage, p_add_callback);

  select stage into v_after from rooms where id = p_room_id;
  if v_after <> 'needs_cleanup' then
    return;
  end if;

  insert into checkouts (clinic_id, room_name, ticket, initials, followup_timeframe, followup_reason, followup_note, followup_claimed_by)
  values (
    v_room.clinic_id, v_room.name, v_room.ticket, v_room.initials,
    v_room.followup->>'timeframe', v_room.followup->>'reason', v_room.followup->>'note',
    nullif(v_room.claims->>'followup', '')
  );

  update rooms set
    initials = null, followup = null, claims = '{}'::jsonb,
    requests = '{}'::jsonb, note = null, updated_at = now()
  where id = p_room_id;
end;
$$;

-- Tap a request on or off. A request turned on starts unclaimed (so the room
-- flashes until someone taps "I've got it"). Lab samples carry the initials.
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
    claims = coalesce(claims, '{}'::jsonb) - p_key,
    updated_at = now()
  where id = p_room_id;

  if v_new and p_key in ('throat_culture', 'strep_culture', 'viral_panel', 'sendout_lab') then
    select coalesce(timezone, 'America/Chicago') into v_tz from clinics where id = v_room.clinic_id;
    if not exists (
      select 1 from lab_samples
      where room_id = v_room.id and coalesce(ticket, '') = coalesce(v_room.ticket, '')
        and sample_type = p_key
    ) then
      insert into lab_samples (clinic_id, room_id, room_name, ticket, initials, sample_type, pickup_date)
      values (v_room.clinic_id, v_room.id, v_room.name, v_room.ticket, v_room.initials, p_key,
              (now() at time zone coalesce(v_tz, 'America/Chicago'))::date);
    end if;
  end if;
end;
$$;

-- A new or cleared message resets its "I've got it" state.
create or replace function set_room_note(p_room_id uuid, p_note text)
returns void language plpgsql as $$
begin
  update rooms set
    note = nullif(trim(p_note), ''),
    claims = coalesce(claims, '{}'::jsonb) - 'note',
    updated_at = now()
  where id = p_room_id;
end;
$$;

create or replace function set_lockout(p_room_id uuid, p_on boolean)
returns void language plpgsql as $$
begin
  if p_on then
    update rooms set contaminated = true, updated_at = now() where id = p_room_id;
  else
    update rooms set
      contaminated = false, stage = 'vacant', stage_started_at = now(),
      ticket = null, initials = null, note = null, requests = '{}'::jsonb,
      claims = '{}'::jsonb, followup = null, updated_at = now()
    where id = p_room_id;
  end if;
end;
$$;

-- Schedule a follow up (timeframe and reason, plus an optional free text note) or clear it (both null).
create or replace function set_followup(p_room_id uuid, p_timeframe text, p_reason text, p_note text default null)
returns void language plpgsql as $$
declare
  v_note text;
begin
  if p_timeframe is null and p_reason is null then
    update rooms set followup = null, claims = coalesce(claims, '{}'::jsonb) - 'followup', updated_at = now()
    where id = p_room_id;
    return;
  end if;
  if p_timeframe not in ('1_week', '3_months', '6_months', 'other')
     or p_reason not in ('weight_check', 'asthma', 'medication_fu', 'wcc', 'generic') then
    return;
  end if;
  v_note := nullif(left(trim(coalesce(p_note, '')), 300), '');
  update rooms set
    followup = jsonb_strip_nulls(jsonb_build_object('timeframe', p_timeframe, 'reason', p_reason, 'note', v_note)),
    claims = coalesce(claims, '{}'::jsonb) - 'followup',
    updated_at = now()
  where id = p_room_id;
end;
$$;

-- "I've got it": record who took a request, message, shots, or follow up.
-- An empty name undoes it.
create or replace function claim_request(p_room_id uuid, p_key text, p_name text)
returns void language plpgsql as $$
begin
  update rooms set
    claims = case
      when nullif(trim(coalesce(p_name, '')), '') is null then coalesce(claims, '{}'::jsonb) - p_key
      else jsonb_set(coalesce(claims, '{}'::jsonb), array[p_key], to_jsonb(left(trim(p_name), 40)), true)
    end,
    updated_at = now()
  where id = p_room_id;
end;
$$;

create or replace function claim_checkout_followup(p_checkout_id uuid, p_name text)
returns void language plpgsql as $$
begin
  update checkouts set followup_claimed_by = nullif(left(trim(coalesce(p_name, '')), 40), '')
  where id = p_checkout_id;
end;
$$;

-- "Pt departed" in the waiting room. Final: it also drops the initials.
create or replace function set_checkout_departed(p_checkout_id uuid)
returns void language plpgsql as $$
begin
  update checkouts set departed_at = coalesce(departed_at, now()), initials = null
  where id = p_checkout_id;
end;
$$;

create or replace function set_room_directions(p_room_id uuid, p_text text)
returns void language plpgsql as $$
begin
  update rooms set directions = nullif(trim(coalesce(p_text, '')), ''), updated_at = now()
  where id = p_room_id;
end;
$$;

-- Free text results typed on a "Call with results" task.
create or replace function set_callback_note(p_callback_id uuid, p_note text)
returns void language plpgsql as $$
begin
  update result_callbacks set result_note = nullif(left(trim(coalesce(p_note, '')), 500), '')
  where id = p_callback_id;
end;
$$;

-- Start of day: every room (except ones in contamination lockout) back to vacant,
-- the Checking out list cleared, ticket numbers restarted. Timing history, lab
-- samples and open results calls are left alone.
create or replace function reset_day(p_clinic_id uuid)
returns void language plpgsql as $$
begin
  update rooms set
    stage = 'vacant', stage_started_at = now(), ticket = null, initials = null, note = null,
    requests = '{}'::jsonb, claims = '{}'::jsonb, followup = null, updated_at = now()
  where clinic_id = p_clinic_id and contaminated = false;

  update checkouts set departed_at = now(), initials = null
  where clinic_id = p_clinic_id and departed_at is null;

  update clinics set next_ticket_num = 1 where id = p_clinic_id;
end;
$$;

-- ================================================================ grants --
-- Supabase projects created after May 30, 2026 no longer expose new tables
-- or functions to the Data API automatically; every role that needs access
-- has to be granted it explicitly. The app talks to the database as the
-- `anon` role (no login, by design), so it needs these. Row level security
-- policies above still decide which rows each role may touch. Safe to run
-- more than once.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- ================================================================= seed --
-- Red Berry, 12 rooms, 3 hallways x 4 rooms, odd = left / even = right,
-- two placeholder nurses and two placeholder doctors. Edit names/colors
-- freely in the `staff` table once real staff are confirmed.

do $$
declare
  v_clinic_id uuid;
  v_yellow uuid; v_blue uuid; v_green uuid;
  v_nurseA uuid; v_nurseB uuid; v_docA uuid; v_docB uuid;
  i int;
  v_hallway_id uuid;
begin
  insert into clinics (slug, name, room_count) values ('red-berry', 'Red Berry Health System', 12)
  returning id into v_clinic_id;

  insert into hallways (clinic_id, key, label, color, sort_order) values
    (v_clinic_id, 'yellow', 'Yellow hallway', '#C9820F', 1),
    (v_clinic_id, 'blue', 'Blue hallway', '#3568C4', 2),
    (v_clinic_id, 'green', 'Green hallway', '#2F9E6E', 3);

  select id into v_yellow from hallways where clinic_id = v_clinic_id and key = 'yellow';
  select id into v_blue from hallways where clinic_id = v_clinic_id and key = 'blue';
  select id into v_green from hallways where clinic_id = v_clinic_id and key = 'green';

  insert into staff (clinic_id, name, role, color, sort_order) values
    (v_clinic_id, 'Nurse A', 'nurse', '#2F9E6E', 1),
    (v_clinic_id, 'Nurse B', 'nurse', '#2F9E6E', 2),
    (v_clinic_id, 'Provider A', 'doctor', '#3568C4', 1),
    (v_clinic_id, 'Provider B', 'doctor', '#3568C4', 2);

  select id into v_nurseA from staff where clinic_id = v_clinic_id and name = 'Nurse A';
  select id into v_nurseB from staff where clinic_id = v_clinic_id and name = 'Nurse B';
  select id into v_docA from staff where clinic_id = v_clinic_id and name = 'Provider A';
  select id into v_docB from staff where clinic_id = v_clinic_id and name = 'Provider B';

  for i in 1..12 loop
    v_hallway_id := case when i <= 4 then v_yellow when i <= 8 then v_blue else v_green end;
    insert into rooms (clinic_id, room_number, name, hallway_id, side, assigned_nurse_id, assigned_doctor_id)
    values (
      v_clinic_id, i,
      (array['Ocean','Dinosaurs','Space','Harry Potter','Monsters Inc','Princess','Farm','Cars','Room 9','Room 10','Room 11','Room 12'])[i],
      v_hallway_id,
      case when i % 2 = 1 then 'left' else 'right' end,
      case when i % 2 = 1 then v_nurseA else v_nurseB end,
      case when i % 2 = 1 then v_docA else v_docB end
    );
  end loop;
end $$;

-- To add another clinic later (e.g. Gun Lake), copy the block above with a
-- new slug/name/room count and its own hallway + staff rows. No code change needed.

-- ---- Red Berry door directions (only fills rooms that have none yet) ----------
update rooms r set directions = v.d
from (values
  (1, 'First door on the right'),
  (2, 'First door on the left'),
  (3, 'Second door on the right'),
  (4, 'Second door on the left'),
  (5, 'Third door on the right'),
  (6, 'Third door on the left'),
  (7, 'Fourth door on the right'),
  (8, 'Fifth door on the right'),
  (9, 'End of the hallway, right corner'),
  (10, 'End of the hallway, center'),
  (11, 'End of the hallway, far left')
) as v(room_number, d)
where r.room_number = v.room_number
  and r.directions is null
  and r.clinic_id = (select id from clinics where slug = 'red-berry');

-- ---- Remove the retired "Next patient in" flag --------------------------------
update rooms set requests = requests - 'nextPatient' where requests ? 'nextPatient';

-- ---- Red Berry names: Ivette (nurse), Robin, Ali and Erica (front desk) --------------
-- Only added when no one with that name is on the list yet, so it never duplicates.
insert into staff (clinic_id, name, role, color, sort_order)
select c.id, v.name, v.role, v.color,
       coalesce((select max(s.sort_order) from staff s where s.clinic_id = c.id and s.role = v.role), 0) + v.ord
from clinics c
cross join (values
  ('Ivette', 'nurse', '#2F9E6E', 1),
  ('Robin', 'frontdesk', '#64748B', 1),
  ('Ali', 'frontdesk', '#64748B', 2),
  ('Erica', 'frontdesk', '#64748B', 3)
) as v(name, role, color, ord)
where c.slug = 'red-berry'
  and not exists (select 1 from staff s where s.clinic_id = c.id and lower(s.name) = lower(v.name));

-- ---- Grants (new table and functions need them, see README) --------------------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

notify pgrst, 'reload schema';
