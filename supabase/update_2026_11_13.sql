-- ClinicFlow update 7, November 13 2026: Per provider and per nurse or MA tables in the Tracker,
-- and green squares while the provider is in the room (that part is in the app, not here).
-- Run this in the Supabase SQL Editor AFTER update 4 and update 6
-- (clinicflow-update-6-2026-11-04.sql). Safe to run more than once. Nothing is deleted.
--
-- What it does:
--   1. Each visit now remembers which nurse or MA tapped Start prep (prep_by), so the Tracker can
--      show patients prepped and average prep time per nurse or MA. Counts start the day this runs;
--      earlier visits did not record who did the prep and are not counted.
--   2. tracker_nurse_data: the numbers behind the per nurse or MA table.
--   The per provider table uses the visit data the Tracker already has.

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'log_room_step' and pronamespace = 'public'::regnamespace)
     or not exists (select 1 from information_schema.columns where table_name = 'checkouts' and column_name = 'school_note') then
    raise exception 'Run update 4 and update 6 first, then run this one.';
  end if;
end $$;

alter table visit_log add column if not exists prep_by text;
alter table visit_log add column if not exists nurse_tracked boolean not null default false;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('check_out_room', 'tracker_nurse_data')
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

-- Check out. Same as update 6, now also saving who did the prep on the visit.
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

  insert into checkouts (
    clinic_id, room_name, ticket, initials,
    followup_timeframe, followup_reason, followup_note, followup_claimed_by,
    school_note, school_note_claimed_by, fd_other, fd_other_claimed_by
  )
  values (
    v_room.clinic_id, v_room.name, v_room.ticket, v_room.initials,
    v_room.followup->>'timeframe', v_room.followup->>'reason', v_room.followup->>'note',
    nullif(v_room.claims->>'followup', ''),
    v_room.followup->>'school_note', nullif(v_room.claims->>'school_note', ''),
    v_room.followup->>'fd_other', nullif(v_room.claims->>'fd_other', '')
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
    ready_for_nurse_ms, prepping_ms, ready_for_doctor_ms, with_doctor_ms, shots_ms, other_ms, swabs,
    prep_by, nurse_tracked
  )
  values (
    v_room.clinic_id, (now() at time zone coalesce(v_tz, 'America/Chicago'))::date,
    v_room.visit_started_at, now(), v_provider, v_d2d,
    v_rfn, v_prep, v_rfd, v_wd, v_sh, v_ot, v_swabs,
    v_room.prep_by, true
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

-- Per nurse or MA: patients prepped and prep time, by day, for visits recorded since this update.
create or replace function tracker_nurse_data(p_clinic_id uuid, p_day date)
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
      prep_by as nurse_name,
      (v_reset is null or checked_out_at >= v_reset) as after_reset,
      count(*) as preps,
      sum(prepping_ms) filter (where prepping_ms between 0 and 10800000) as prep_sum,
      count(*) filter (where prepping_ms between 0 and 10800000) as prep_n
    from visit_log
    where clinic_id = p_clinic_id and visit_date <= p_day and nurse_tracked
    group by 1, 2, 3
  ) t;

  return jsonb_build_object('reset_at', v_reset, 'rows', v_rows);
end;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

notify pgrst, 'reload schema';
