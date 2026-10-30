-- ClinicFlow update 4, October 30 2026.
-- Run this in the Supabase SQL Editor. It already includes everything from update 3
-- (clinicflow-update-3-2026-10-28.sql), so it is safe whether or not update 3 was run,
-- and safe to run more than once. Nothing is deleted. Patients and history stay as they are.
--
-- What it does:
--   1. Update 3 items: Room 12 is named Overflow, no cleaning step, prep nurse name,
--      Change room, 30 day reset and erase buttons.
--   2. Visit log for the Admin Tracker (visits, provider, swabs, step times, door to door).
--      Past provider visits are filled in once from existing history.
--   3. The provider for a visit is kept separate from the room's usual provider, so it can
--      be changed during the visit and never sticks to the next patient.
--   4. Check-out puts the room in a 2 minute "Turning over" state, with Undo check out.
--   5. Go back one step (the timer resumes from the original start).
--   6. Timer colors are fixed targets that you set in Admin (not averages).
--   7. Provider name colors (set in Admin; Tracee Choinard, Nicole Curtsinger and
--      Laura White start green, orange and purple).

-- ---- Columns ---------------------------------------------------------------------
alter table rooms add column if not exists prep_by text;
alter table clinics add column if not exists averages_reset_at timestamptz;
alter table rooms add column if not exists visit_id uuid;
alter table rooms add column if not exists visit_started_at timestamptz;
alter table rooms add column if not exists visit_doctor_id uuid references staff(id) on delete set null;
alter table rooms add column if not exists undo jsonb;
alter table room_history add column if not exists visit_id uuid;
alter table clinics add column if not exists timer_targets jsonb;
alter table staff add column if not exists name_color text;

-- Rooms may now be in the "turnover" step (the 2 minutes after check-out).
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
    check (stage in ('vacant','ready_for_nurse','prepping','ready_for_doctor','with_doctor','shots','other','needs_cleanup','turnover'));
end $$;

-- ---- Visit log: one row per completed visit, used by the Admin Tracker -------------
-- Counts and times only. No initials, no ticket numbers, nothing that names a patient.
create table if not exists visit_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  visit_date date not null,
  checked_in_at timestamptz,
  checked_out_at timestamptz not null default now(),
  provider_name text,
  door_to_door_ms bigint,
  ready_for_nurse_ms bigint,
  prepping_ms bigint,
  ready_for_doctor_ms bigint,
  with_doctor_ms bigint,
  shots_ms bigint,
  other_ms bigint,
  swabs text[] not null default '{}',
  source_history_id uuid unique
);
create index if not exists idx_visit_log_clinic_date on visit_log(clinic_id, visit_date);
alter table visit_log enable row level security;
drop policy if exists "public all visit_log" on visit_log;
create policy "public all visit_log" on visit_log for all using (true) with check (true);

-- ---- Room 12 is now Overflow -------------------------------------------------------
update rooms set name = 'Overflow'
where room_number = 12
  and clinic_id = (select id from clinics where slug = 'red-berry');

-- ---- No more cleaning step: rooms stuck in "Needs cleanup" go to Vacant --------------
update rooms set
  stage = 'vacant', stage_started_at = now(), ticket = null, initials = null, note = null,
  requests = '{}'::jsonb, claims = '{}'::jsonb, followup = null, prep_by = null, updated_at = now()
where stage = 'needs_cleanup' and contaminated = false;

-- ---- Timer targets (yellow and red minutes per step), editable in Admin ----------------
update clinics set timer_targets = '{
  "ready_for_nurse":  {"yellow": 5,  "red": 8},
  "prepping":         {"yellow": 8,  "red": 12},
  "ready_for_doctor": {"yellow": 10, "red": 15},
  "with_doctor":      {"yellow": 20, "red": 30},
  "shots":            {"yellow": 10, "red": 15},
  "other":            {"yellow": 10, "red": 15}
}'::jsonb
where timer_targets is null;

-- ---- Provider name colors (only fills providers that have no color yet) -----------------
update staff set name_color = '#16A34A' where role = 'doctor' and name_color is null and lower(name) like '%choinard%';
update staff set name_color = '#C2410C' where role = 'doctor' and name_color is null and lower(name) like '%curtsinger%';
update staff set name_color = '#7E22CE' where role = 'doctor' and name_color is null and lower(name) like '%white%' and lower(name) like '%laura%';

-- ---- Patients already in a room when this update runs -----------------------------------
-- Give them a visit so Go back, Change provider and the Tracker work for them too.
update rooms r set
  visit_id = gen_random_uuid(),
  visit_started_at = coalesce(
    (select min(c.called_at) from calls c
      where c.room_id = r.id and c.ticket = r.ticket and c.called_at > now() - interval '12 hours'),
    r.stage_started_at),
  visit_doctor_id = coalesce(r.visit_doctor_id, r.assigned_doctor_id)
where r.visit_id is null
  and r.stage not in ('vacant', 'turnover', 'needs_cleanup')
  and r.ticket is not null;

update room_history h set visit_id = r.visit_id
from rooms r
where h.room_id = r.id and r.visit_id is not null and h.visit_id is null
  and h.ended_at >= r.visit_started_at;

-- ---- Functions -----------------------------------------------------------------------
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
        'swap_room', 'reset_timing_averages', 'erase_timing_history', 'log_room_step',
        'set_visit_provider', 'go_back_room', 'undo_checkout', 'set_timer_targets', 'tracker_data'
      )
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

-- Writes one finished step into the timing history and returns its id.
create or replace function log_room_step(p_room rooms)
returns uuid language plpgsql as $$
declare
  v_id uuid;
  v_name text;
  v_ms bigint;
begin
  v_ms := extract(epoch from (now() - p_room.stage_started_at)) * 1000;
  v_name := null;
  if p_room.stage = 'with_doctor' then
    select name into v_name from staff where id = p_room.visit_doctor_id;
  end if;
  insert into room_history (clinic_id, room_id, stage, duration_ms, provider_name, visit_id)
  values (p_room.clinic_id, p_room.id, p_room.stage, v_ms, v_name, p_room.visit_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- Check in. A room that is Vacant, or still in its 2 minute Turning over state, can take a patient.
--   p_set_doctor  true: use p_doctor_id as this visit's provider (null = any provider).
--                 false: this visit uses the room's usual provider from Today's staffing.
-- The room's usual provider is never overwritten by a visit.
create or replace function assign_patient(
  p_room_id uuid,
  p_initials text default null,
  p_doctor_id uuid default null,
  p_set_doctor boolean default false
)
returns text language plpgsql as $$
declare
  v_room rooms%rowtype;
  v_ticket_num int;
  v_ticket text;
  v_initials text;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found or v_room.contaminated or v_room.stage not in ('vacant', 'turnover') then
    return null;
  end if;

  v_initials := nullif(upper(left(regexp_replace(coalesce(p_initials, ''), '[^A-Za-z]', '', 'g'), 4)), '');

  update clinics set next_ticket_num = next_ticket_num + 1
  where id = v_room.clinic_id
  returning next_ticket_num - 1 into v_ticket_num;

  v_ticket := 'A-0' || v_ticket_num;

  update rooms set
    stage = 'ready_for_nurse', stage_started_at = now(), ticket = v_ticket,
    initials = v_initials, note = null, requests = '{}'::jsonb, claims = '{}'::jsonb,
    followup = null, prep_by = null, undo = null,
    visit_id = gen_random_uuid(), visit_started_at = now(),
    visit_doctor_id = case when p_set_doctor then p_doctor_id else v_room.assigned_doctor_id end,
    updated_at = now()
  where id = p_room_id;

  insert into calls (clinic_id, room_id, ticket, initials) values (v_room.clinic_id, p_room_id, v_ticket, v_initials);
  return v_ticket;
end;
$$;

-- Moves a room to its next step.
--   p_actor   the name of the person who tapped Start prep (shown on the board)
-- Ending a visit (Doctor in room, Shots or Other) is Check-out, handled by check_out_room.
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
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found or v_room.contaminated or v_room.stage in ('vacant', 'turnover') then
    return;
  end if;

  if p_expected_stage is not null and p_expected_stage <> v_room.stage then
    return;
  end if;

  -- Older copies of the app may ask for "needs_cleanup" or "vacant" to end a visit.
  v_target := case when p_target in ('needs_cleanup', 'vacant') then 'turnover' else p_target end;

  if v_room.stage in ('with_doctor', 'shots', 'other') and (v_target is null or v_target = 'turnover') then
    perform check_out_room(p_room_id, v_room.stage, p_add_callback);
    return;
  end if;

  v_next := case v_room.stage
    when 'ready_for_nurse' then 'prepping'
    when 'prepping' then 'ready_for_doctor'
    when 'ready_for_doctor' then 'with_doctor'
    when 'with_doctor' then v_target
    when 'needs_cleanup' then 'vacant'
  end;

  if v_next is null or (v_target is not null and v_target <> v_next) then
    return;
  end if;
  if v_room.stage = 'with_doctor' and v_next not in ('shots', 'other') then
    return;
  end if;

  perform log_room_step(v_room);

  update rooms set
    stage = v_next,
    stage_started_at = now(),
    claims = case when v_next = 'shots' then coalesce(claims, '{}'::jsonb) - 'shots' else claims end,
    prep_by = case when v_next = 'prepping' then nullif(left(trim(coalesce(p_actor, '')), 40), '')
                   else prep_by end,
    updated_at = now()
  where id = p_room_id;
end;
$$;

-- "Check-out": the patient goes to the waiting room list (with any follow up request), the visit
-- is saved to the Tracker, and the room shows "Turning over" for 2 minutes, then it is Vacant.
-- A saved copy of the room lets "Undo check out" put everything back during those 2 minutes.
create or replace function check_out_room(
  p_room_id uuid,
  p_expected_stage text default null,
  p_add_callback boolean default false
)
returns void language plpgsql as $$
declare
  v_room rooms%rowtype;
  v_hist uuid;
  v_cb uuid := null;
  v_co uuid;
  v_vl uuid;
  v_tests text[];
  v_swabs text[];
  v_provider text;
  v_tz text;
  v_d2d bigint := null;
  v_rfn bigint; v_prep bigint; v_rfd bigint; v_wd bigint; v_sh bigint; v_ot bigint;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found or v_room.contaminated or v_room.stage not in ('with_doctor', 'shots', 'other') then
    return;
  end if;
  if p_expected_stage is not null and p_expected_stage <> v_room.stage then
    return;
  end if;

  v_hist := log_room_step(v_room);

  if p_add_callback then
    select coalesce(array_agg(k order by k), '{}') into v_tests
    from unnest(array['covid','flu','rsv','strep']) as k
    where coalesce((v_room.requests->>k)::boolean, false);

    if array_length(v_tests, 1) > 0
       and not exists (
         select 1 from result_callbacks
         where room_id = v_room.id and coalesce(ticket, '') = coalesce(v_room.ticket, '')
       ) then
      insert into result_callbacks (clinic_id, room_id, room_name, ticket, initials, tests)
      values (v_room.clinic_id, v_room.id, v_room.name, v_room.ticket, v_room.initials, v_tests)
      returning id into v_cb;
    end if;
  end if;

  insert into checkouts (clinic_id, room_name, ticket, initials, followup_timeframe, followup_reason, followup_note, followup_claimed_by)
  values (
    v_room.clinic_id, v_room.name, v_room.ticket, v_room.initials,
    v_room.followup->>'timeframe', v_room.followup->>'reason', v_room.followup->>'note',
    nullif(v_room.claims->>'followup', '')
  )
  returning id into v_co;

  -- Tracker row: counts and times only.
  select coalesce(timezone, 'America/Chicago') into v_tz from clinics where id = v_room.clinic_id;
  select name into v_provider from staff where id = v_room.visit_doctor_id;
  select coalesce(array_agg(k), '{}') into v_swabs
  from unnest(array['rsv','flu','strep','covid','throat_culture','strep_culture','viral_panel']) as k
  where coalesce((v_room.requests->>k)::boolean, false);

  if v_room.visit_id is not null then
    select
      sum(duration_ms) filter (where stage = 'ready_for_nurse'),
      sum(duration_ms) filter (where stage = 'prepping'),
      sum(duration_ms) filter (where stage = 'ready_for_doctor'),
      sum(duration_ms) filter (where stage = 'with_doctor'),
      sum(duration_ms) filter (where stage = 'shots'),
      sum(duration_ms) filter (where stage = 'other')
    into v_rfn, v_prep, v_rfd, v_wd, v_sh, v_ot
    from room_history where visit_id = v_room.visit_id;
  end if;
  if v_room.visit_started_at is not null then
    v_d2d := extract(epoch from (now() - v_room.visit_started_at)) * 1000;
  end if;

  insert into visit_log (
    clinic_id, visit_date, checked_in_at, checked_out_at, provider_name, door_to_door_ms,
    ready_for_nurse_ms, prepping_ms, ready_for_doctor_ms, with_doctor_ms, shots_ms, other_ms, swabs
  )
  values (
    v_room.clinic_id, (now() at time zone coalesce(v_tz, 'America/Chicago'))::date,
    v_room.visit_started_at, now(), v_provider, v_d2d,
    v_rfn, v_prep, v_rfd, v_wd, v_sh, v_ot, v_swabs
  )
  returning id into v_vl;

  update rooms set
    stage = 'turnover', stage_started_at = now(),
    ticket = null, initials = null, note = null, requests = '{}'::jsonb, claims = '{}'::jsonb,
    followup = null, prep_by = null, visit_id = null, visit_started_at = null, visit_doctor_id = null,
    undo = jsonb_build_object(
      'stage', v_room.stage,
      'stage_started_at', v_room.stage_started_at,
      'ticket', v_room.ticket,
      'note', v_room.note,
      'requests', v_room.requests,
      'claims', v_room.claims,
      'followup', v_room.followup,
      'prep_by', v_room.prep_by,
      'visit_id', v_room.visit_id,
      'visit_started_at', v_room.visit_started_at,
      'visit_doctor_id', v_room.visit_doctor_id,
      'hist_id', v_hist,
      'checkout_id', v_co,
      'callback_id', v_cb,
      'visit_log_id', v_vl
    ),
    updated_at = now()
  where id = p_room_id;
end;
$$;

-- Undo check-out, within the 2 minute Turning over window and before anyone is checked in or
-- Pt departed is tapped. Puts the patient back exactly where they were, timer resumed.
create or replace function undo_checkout(p_room_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  r rooms%rowtype;
  s jsonb;
  v_init text;
  v_dep timestamptz;
begin
  select * into r from rooms where id = p_room_id for update;
  if not found or r.contaminated or r.stage <> 'turnover' or r.undo is null then
    return false;
  end if;
  if now() - r.stage_started_at > interval '135 seconds' then
    return false;
  end if;
  s := r.undo;

  select initials, departed_at into v_init, v_dep from checkouts where id = (s->>'checkout_id')::uuid;
  if not found or v_dep is not null then
    return false;
  end if;

  delete from checkouts where id = (s->>'checkout_id')::uuid;
  if s->>'callback_id' is not null then
    delete from result_callbacks where id = (s->>'callback_id')::uuid;
  end if;
  delete from room_history where id = (s->>'hist_id')::uuid;
  delete from visit_log where id = (s->>'visit_log_id')::uuid;

  update rooms set
    stage = s->>'stage',
    stage_started_at = (s->>'stage_started_at')::timestamptz,
    ticket = s->>'ticket',
    initials = v_init,
    note = s->>'note',
    requests = coalesce(s->'requests', '{}'::jsonb),
    claims = coalesce(s->'claims', '{}'::jsonb),
    followup = case when jsonb_typeof(s->'followup') = 'object' then s->'followup' else null end,
    prep_by = s->>'prep_by',
    visit_id = (s->>'visit_id')::uuid,
    visit_started_at = (s->>'visit_started_at')::timestamptz,
    visit_doctor_id = (s->>'visit_doctor_id')::uuid,
    undo = null,
    updated_at = now()
  where id = p_room_id;
  return true;
end;
$$;

-- Go back one step. The step you tapped past is erased from the timing history and the
-- timer resumes from the original start of the earlier step, as if the tap never happened.
create or replace function go_back_room(p_room_id uuid, p_expected_stage text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  r rooms%rowtype;
  v_prev text;
  h room_history%rowtype;
  v_start timestamptz;
begin
  select * into r from rooms where id = p_room_id for update;
  if not found or r.contaminated then
    return false;
  end if;
  if p_expected_stage is not null and p_expected_stage <> r.stage then
    return false;
  end if;

  v_prev := case r.stage
    when 'prepping' then 'ready_for_nurse'
    when 'ready_for_doctor' then 'prepping'
    when 'with_doctor' then 'ready_for_doctor'
    when 'shots' then 'with_doctor'
    when 'other' then 'with_doctor'
  end;
  if v_prev is null then
    return false;
  end if;

  select * into h from room_history
  where room_id = r.id and stage = v_prev
    and (
      (r.visit_id is not null and visit_id = r.visit_id)
      or (r.visit_id is null and ended_at between r.stage_started_at - interval '10 seconds'
                                              and r.stage_started_at + interval '10 seconds')
    )
  order by ended_at desc
  limit 1;

  if found then
    v_start := h.ended_at - (h.duration_ms || ' milliseconds')::interval;
    delete from room_history where id = h.id;
  else
    v_start := now();
  end if;

  update rooms set
    stage = v_prev,
    stage_started_at = v_start,
    prep_by = case when v_prev = 'ready_for_nurse' then null else prep_by end,
    claims = case when r.stage = 'shots' then coalesce(claims, '{}'::jsonb) - 'shots' else claims end,
    updated_at = now()
  where id = p_room_id;
  return true;
end;
$$;

-- Change the provider for this visit only (null = any provider). The room's usual provider is untouched.
create or replace function set_visit_provider(p_room_id uuid, p_doctor_id uuid)
returns void language plpgsql as $$
begin
  update rooms set visit_doctor_id = p_doctor_id, updated_at = now()
  where id = p_room_id and stage not in ('vacant', 'turnover');
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
      claims = '{}'::jsonb, followup = null, prep_by = null,
      visit_id = null, visit_started_at = null, visit_doctor_id = null, undo = null,
      updated_at = now()
    where id = p_room_id;
  end if;
end;
$$;

-- Start of day: every room (except ones in contamination lockout) back to vacant,
-- the Checking out list cleared, ticket numbers restarted. Timing history, the Tracker,
-- lab samples and open results calls are left alone.
create or replace function reset_day(p_clinic_id uuid)
returns void language plpgsql as $$
begin
  update rooms set
    stage = 'vacant', stage_started_at = now(), ticket = null, initials = null, note = null,
    requests = '{}'::jsonb, claims = '{}'::jsonb, followup = null, prep_by = null,
    visit_id = null, visit_started_at = null, visit_doctor_id = null, undo = null,
    updated_at = now()
  where clinic_id = p_clinic_id and contaminated = false;

  update checkouts set departed_at = now(), initials = null
  where clinic_id = p_clinic_id and departed_at is null;

  update clinics set next_ticket_num = 1 where id = p_clinic_id;
end;
$$;

-- Change room: moves a checked in patient (initials, ticket, step and timer, requests, message,
-- "I've got it" names, follow up, and the visit's provider) to a vacant room (or one in its
-- 2 minute Turning over state). The old room goes back to Vacant. Neither room's usual provider changes.
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
     or a.contaminated or a.stage in ('vacant', 'turnover')
     or b.contaminated or b.stage not in ('vacant', 'turnover') then
    return false;
  end if;

  update rooms set
    stage = a.stage, stage_started_at = a.stage_started_at, ticket = a.ticket,
    initials = a.initials, note = a.note, requests = a.requests, claims = a.claims,
    followup = a.followup, prep_by = a.prep_by, undo = null,
    visit_id = a.visit_id, visit_started_at = a.visit_started_at, visit_doctor_id = a.visit_doctor_id,
    updated_at = now()
  where id = p_to;

  update rooms set
    stage = 'vacant', stage_started_at = now(), ticket = null, initials = null, note = null,
    requests = '{}'::jsonb, claims = '{}'::jsonb, followup = null, prep_by = null, undo = null,
    visit_id = null, visit_started_at = null, visit_doctor_id = null,
    updated_at = now()
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

-- Timer colors: yellow and red minutes per step, shared by every screen.
create or replace function set_timer_targets(p_clinic_id uuid, p_targets jsonb)
returns void language plpgsql as $$
begin
  if p_targets is null or jsonb_typeof(p_targets) <> 'object' then
    return;
  end if;
  update clinics set timer_targets = p_targets where id = p_clinic_id;
end;
$$;

-- The 30 day columns in the Tracker restart from now. Old data is kept.
create or replace function reset_timing_averages(p_clinic_id uuid)
returns void language plpgsql as $$
begin
  update clinics set averages_reset_at = now() where id = p_clinic_id;
end;
$$;

-- Permanently erases ALL timing history and ALL Tracker data for the clinic. Cannot be undone.
-- (security definer: these tables have no delete rule for the public key, so this function
-- is the only way to erase them.)
create or replace function erase_timing_history(p_clinic_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from room_history where clinic_id = p_clinic_id;
  delete from visit_log where clinic_id = p_clinic_id;
  update clinics set averages_reset_at = null where id = p_clinic_id;
end;
$$;

-- Everything the Admin Tracker shows, up to and including p_day: one compact row per date,
-- provider and "after the 30 day reset" flag, with counts and time totals. The app adds these
-- up for That day, Last 7 days, Last 30 days and All time. Any single step over 3 hours is
-- left out of the time averages (the visit itself still counts).
create or replace function tracker_data(p_clinic_id uuid, p_day date)
returns jsonb language plpgsql as $$
declare
  v_reset timestamptz;
  v_rows jsonb;
begin
  select averages_reset_at into v_reset from clinics where id = p_clinic_id;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows
  from (
    select
      visit_date,
      provider_name,
      (v_reset is null or checked_out_at >= v_reset) as after_reset,
      count(*) as visits,
      count(*) filter (where source_history_id is null) as new_visits,
      sum(door_to_door_ms) filter (where door_to_door_ms between 0 and 10800000) as d2d_sum,
      count(*) filter (where door_to_door_ms between 0 and 10800000) as d2d_n,
      sum(ready_for_nurse_ms) filter (where ready_for_nurse_ms between 0 and 10800000) as rfn_sum,
      count(*) filter (where ready_for_nurse_ms between 0 and 10800000) as rfn_n,
      sum(prepping_ms) filter (where prepping_ms between 0 and 10800000) as prep_sum,
      count(*) filter (where prepping_ms between 0 and 10800000) as prep_n,
      sum(ready_for_doctor_ms) filter (where ready_for_doctor_ms between 0 and 10800000) as rfd_sum,
      count(*) filter (where ready_for_doctor_ms between 0 and 10800000) as rfd_n,
      sum(with_doctor_ms) filter (where with_doctor_ms between 0 and 10800000) as wd_sum,
      count(*) filter (where with_doctor_ms between 0 and 10800000) as wd_n,
      sum(shots_ms) filter (where shots_ms between 0 and 10800000) as sh_sum,
      count(*) filter (where shots_ms between 0 and 10800000) as sh_n,
      sum(other_ms) filter (where other_ms between 0 and 10800000) as ot_sum,
      count(*) filter (where other_ms between 0 and 10800000) as ot_n,
      count(*) filter (where 'rsv' = any(swabs)) as sw_rsv,
      count(*) filter (where 'flu' = any(swabs)) as sw_flu,
      count(*) filter (where 'strep' = any(swabs)) as sw_strep,
      count(*) filter (where 'covid' = any(swabs)) as sw_covid,
      count(*) filter (where 'throat_culture' = any(swabs)) as sw_throat_culture,
      count(*) filter (where 'strep_culture' = any(swabs)) as sw_strep_culture,
      count(*) filter (where 'viral_panel' = any(swabs)) as sw_viral_panel
    from visit_log
    where clinic_id = p_clinic_id and visit_date <= p_day
    group by 1, 2, 3
  ) t;

  return jsonb_build_object('reset_at', v_reset, 'rows', v_rows);
end;
$$;

-- ---- Past provider visits: filled in once from existing history -------------------------
-- Only history from before this update (no visit id). Provider and Doctor in room time only;
-- the other steps, swabs and door to door time were not recorded back then.
insert into visit_log (clinic_id, visit_date, checked_out_at, provider_name, with_doctor_ms, source_history_id)
select h.clinic_id,
       (h.ended_at at time zone coalesce(c.timezone, 'America/Chicago'))::date,
       h.ended_at, h.provider_name, h.duration_ms, h.id
from room_history h
join clinics c on c.id = h.clinic_id
where h.stage = 'with_doctor' and h.visit_id is null
on conflict (source_history_id) do nothing;

-- ---- Grants (new tables and functions need them, see README) ---------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

notify pgrst, 'reload schema';
