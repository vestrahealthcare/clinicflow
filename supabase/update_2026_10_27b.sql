-- ClinicFlow update 2, 2026-10-27
-- Run this whole file once in the Supabase SQL editor, AFTER the first update
-- (clinicflow-update-2026-10-27.sql). Safe to run more than once. It does NOT
-- delete rooms, history or staff.
--
-- What it does:
--   * adds patient initials at check in (kept on the room until check-out)
--   * adds the Check-out list (patients back in the waiting room) and follow up requests
--   * adds "I've got it" so a named person can take a request
--   * adds door directions per room (editable in Admin) and fills in Red Berry's
--   * carries initials onto the Lab and calls lists
--   * removes the old "Next patient in" flag
-- Run this BEFORE deploying the matching app code.

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

-- ---- Functions ----------------------------------------------------------------

-- Front desk check in: now takes the patient's initials (letters only, up to 4).
drop function if exists assign_patient(uuid);
create or replace function assign_patient(p_room_id uuid, p_initials text default null)
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
    initials = v_initials, claims = '{}'::jsonb, followup = null, updated_at = now()
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

  insert into checkouts (clinic_id, room_name, ticket, initials, followup_timeframe, followup_reason, followup_claimed_by)
  values (
    v_room.clinic_id, v_room.name, v_room.ticket, v_room.initials,
    v_room.followup->>'timeframe', v_room.followup->>'reason',
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

-- Schedule a follow up (both values) or clear it (both null).
create or replace function set_followup(p_room_id uuid, p_timeframe text, p_reason text)
returns void language plpgsql as $$
begin
  if p_timeframe is null and p_reason is null then
    update rooms set followup = null, claims = coalesce(claims, '{}'::jsonb) - 'followup', updated_at = now()
    where id = p_room_id;
    return;
  end if;
  if p_timeframe not in ('1_week', '3_months', '6_months', 'other')
     or p_reason not in ('weight_check', 'asthma', 'medication_fu', 'generic') then
    return;
  end if;
  update rooms set
    followup = jsonb_build_object('timeframe', p_timeframe, 'reason', p_reason),
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

-- ---- Grants (new table and functions need them, see README) --------------------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

notify pgrst, 'reload schema';
