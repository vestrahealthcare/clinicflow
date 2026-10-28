-- ClinicFlow update, October 28 2026.
-- Run this in the Supabase SQL Editor AFTER clinicflow-update-2-2026-10-27.sql (already run).
-- Safe to run more than once. Nothing is deleted. Patients and timing history stay as they are.
--
-- What it does:
--   1. Renames Room 12 to Overflow.
--   2. Removes the cleaning step. A visit now ends at Check-out and the room is Vacant.
--      Any room still sitting in "Needs cleanup" is set to Vacant.
--   3. Remembers which nurse tapped Start prep, so the board can show the name.
--   4. Adds Change room (swap_room): moves a checked in patient to a vacant room.
--   5. Adds the 30 day average reset and the erase all timing history buttons for Admin.

-- ---- New columns -------------------------------------------------------------
alter table rooms add column if not exists prep_by text;
alter table clinics add column if not exists averages_reset_at timestamptz;

-- ---- Room 12 is now Overflow -------------------------------------------------
update rooms set name = 'Overflow'
where room_number = 12
  and clinic_id = (select id from clinics where slug = 'red-berry');

-- ---- No more cleaning step: rooms stuck in "Needs cleanup" go to Vacant ----------
update rooms set
  stage = 'vacant', stage_started_at = now(), ticket = null, initials = null, note = null,
  requests = '{}'::jsonb, claims = '{}'::jsonb, followup = null, prep_by = null, updated_at = now()
where stage = 'needs_cleanup' and contaminated = false;

-- ---- Functions ---------------------------------------------------------------
-- Remove every existing version of the functions below first (whatever their argument
-- lists), so the new versions can be created cleanly.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'assign_patient', 'advance_room_stage', 'check_out_room', 'set_lockout', 'reset_day',
        'swap_room', 'reset_timing_averages', 'erase_timing_history'
      )
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

-- Check in: same as before, and clears the prep nurse.
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
    initials = v_initials, claims = '{}'::jsonb, followup = null, prep_by = null,
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

-- Moves a room to its next step. The visit steps (Doctor in room, Shots, Other) now go
-- straight to Vacant: there is no cleaning step any more.
--   p_actor   the name of the person who tapped Start prep (shown on the board)
create or replace function advance_room_stage(
  p_room_id uuid,
  p_target text default null,
  p_expected_stage text default null,
  p_add_callback boolean default false,
  p_actor text default null
)
returns void language plpgsql as $$
declare
  v_room rooms%rowtype;
  v_next text;
  v_target text;
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

  -- An older copy of the app may still ask for "needs_cleanup". That now means vacant.
  v_target := case when p_target = 'needs_cleanup' then 'vacant' else p_target end;

  v_next := case v_room.stage
    when 'ready_for_nurse' then 'prepping'
    when 'prepping' then 'ready_for_doctor'
    when 'ready_for_doctor' then 'with_doctor'
    when 'with_doctor' then coalesce(v_target, 'vacant')
    when 'shots' then 'vacant'
    when 'other' then 'vacant'
    when 'needs_cleanup' then 'vacant'
  end;

  if v_target is not null and v_target <> v_next then
    return;
  end if;
  if v_room.stage = 'with_doctor' and v_next not in ('shots', 'other', 'vacant') then
    return;
  end if;

  v_elapsed_ms := extract(epoch from (now() - v_room.stage_started_at)) * 1000;

  v_provider_name := null;
  if v_room.stage = 'with_doctor' then
    select name into v_provider_name from staff where id = v_room.assigned_doctor_id;
  end if;

  insert into room_history (clinic_id, room_id, stage, duration_ms, provider_name)
  values (v_room.clinic_id, v_room.id, v_room.stage, v_elapsed_ms, v_provider_name);

  if p_add_callback and v_next = 'vacant' and v_room.stage in ('with_doctor', 'shots', 'other') then
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
    prep_by = case when v_next = 'vacant' then null
                   when v_next = 'prepping' then nullif(left(trim(coalesce(p_actor, '')), 40), '')
                   else prep_by end,
    updated_at = now()
  where id = p_room_id;
end;
$$;

-- "Check-out": the room goes straight to Vacant, the patient goes to the waiting room
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

  perform advance_room_stage(p_room_id, 'vacant', v_room.stage, p_add_callback);

  select stage into v_after from rooms where id = p_room_id;
  if v_after <> 'vacant' then
    return;
  end if;

  insert into checkouts (clinic_id, room_name, ticket, initials, followup_timeframe, followup_reason, followup_note, followup_claimed_by)
  values (
    v_room.clinic_id, v_room.name, v_room.ticket, v_room.initials,
    v_room.followup->>'timeframe', v_room.followup->>'reason', v_room.followup->>'note',
    nullif(v_room.claims->>'followup', '')
  );
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
      claims = '{}'::jsonb, followup = null, prep_by = null, updated_at = now()
    where id = p_room_id;
  end if;
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
    requests = '{}'::jsonb, claims = '{}'::jsonb, followup = null, prep_by = null, updated_at = now()
  where clinic_id = p_clinic_id and contaminated = false;

  update checkouts set departed_at = now(), initials = null
  where clinic_id = p_clinic_id and departed_at is null;

  update clinics set next_ticket_num = 1 where id = p_clinic_id;
end;
$$;

-- Change room: moves a checked in patient (initials, ticket, step and timer, requests,
-- message, "I've got it" names, follow up, and the visit's provider) from one room to a
-- vacant room. The old room goes back to Vacant and keeps its own usual provider.
-- Returns true when the move happened, false when it was not allowed (the new room is
-- not vacant, is in lockout, or the old room has no patient).
create or replace function swap_room(p_from uuid, p_to uuid)
returns boolean language plpgsql as $$
declare
  a rooms%rowtype;
  b rooms%rowtype;
begin
  if p_from is null or p_to is null or p_from = p_to then
    return false;
  end if;

  perform 1 from rooms where id in (p_from, p_to) order by id for update;

  select * into a from rooms where id = p_from;
  if not found then
    return false;
  end if;
  select * into b from rooms where id = p_to;
  if not found then
    return false;
  end if;

  if a.clinic_id <> b.clinic_id
     or a.contaminated or a.stage = 'vacant'
     or b.contaminated or b.stage <> 'vacant' then
    return false;
  end if;

  update rooms set
    stage = a.stage, stage_started_at = a.stage_started_at, ticket = a.ticket,
    initials = a.initials, note = a.note, requests = a.requests, claims = a.claims,
    followup = a.followup, prep_by = a.prep_by, assigned_doctor_id = a.assigned_doctor_id,
    updated_at = now()
  where id = p_to;

  update rooms set
    stage = 'vacant', stage_started_at = now(), ticket = null, initials = null, note = null,
    requests = '{}'::jsonb, claims = '{}'::jsonb, followup = null, prep_by = null,
    assigned_doctor_id = b.assigned_doctor_id, updated_at = now()
  where id = p_from;

  -- Keep this patient's lab samples and the waiting room "go to" message pointing at the new room.
  update lab_samples set room_id = p_to, room_name = b.name
  where room_id = p_from and coalesce(ticket, '') = coalesce(a.ticket, '')
    and requested_at > now() - interval '1 day';

  update calls set room_id = p_to, called_at = now()
  where room_id = p_from and coalesce(ticket, '') = coalesce(a.ticket, '')
    and called_at > now() - interval '1 day';

  return true;
end;
$$;

-- Start the 30 day averages fresh from now. Old timing data is kept in the database.
create or replace function reset_timing_averages(p_clinic_id uuid)
returns void language plpgsql as $$
begin
  update clinics set averages_reset_at = now() where id = p_clinic_id;
end;
$$;

-- Permanently erases ALL timing history for the clinic. This cannot be undone.
-- (security definer: the timing history table has no delete rule for the public key,
-- so this function is the only way to erase it.)
create or replace function erase_timing_history(p_clinic_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from room_history where clinic_id = p_clinic_id;
  update clinics set averages_reset_at = now() where id = p_clinic_id;
end;
$$;

-- ---- Grants (new functions need them, see README) --------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

notify pgrst, 'reload schema';
