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
    check (stage in ('vacant','ready_for_nurse','prepping','ready_for_doctor','with_doctor','needs_cleanup')),
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

-- Advance a room to its next lifecycle stage, logging the stage it's leaving.
create or replace function advance_room_stage(p_room_id uuid)
returns void language plpgsql as $$
declare
  v_room rooms%rowtype;
  v_next text;
  v_elapsed_ms bigint;
  v_provider_name text;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found or v_room.contaminated or v_room.stage = 'vacant' then
    return;
  end if;

  v_elapsed_ms := extract(epoch from (now() - v_room.stage_started_at)) * 1000;
  v_next := case v_room.stage
    when 'ready_for_nurse' then 'prepping'
    when 'prepping' then 'ready_for_doctor'
    when 'ready_for_doctor' then 'with_doctor'
    when 'with_doctor' then 'needs_cleanup'
    when 'needs_cleanup' then 'vacant'
  end;

  v_provider_name := null;
  if v_room.stage = 'with_doctor' then
    select name into v_provider_name from staff where id = v_room.assigned_doctor_id;
  end if;

  insert into room_history (clinic_id, room_id, stage, duration_ms, provider_name)
  values (v_room.clinic_id, v_room.id, v_room.stage, v_elapsed_ms, v_provider_name);

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

-- Toggle one boolean flag inside the requests jsonb column (rsv, chaperone, etc).
create or replace function toggle_request(p_room_id uuid, p_key text)
returns void language plpgsql as $$
declare
  v_current boolean;
begin
  select coalesce((requests->>p_key)::boolean, false) into v_current from rooms where id = p_room_id;
  update rooms set
    requests = jsonb_set(coalesce(requests, '{}'::jsonb), array[p_key], to_jsonb(not v_current), true),
    updated_at = now()
  where id = p_room_id;
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
    (v_clinic_id, 'green', 'Green hallway', '#2F9E6E', 3)
  returning id into v_yellow; -- last insert's id only; re-select below for clarity

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
      v_clinic_id, i, 'Room ' || i, v_hallway_id,
      case when i % 2 = 1 then 'left' else 'right' end,
      case when i % 2 = 1 then v_nurseA else v_nurseB end,
      case when i % 2 = 1 then v_docA else v_docB end
    );
  end loop;
end $$;

-- To add another clinic later (e.g. Gun Lake), copy the block above with a
-- new slug/name/room count and its own hallway + staff rows. No code change needed.
