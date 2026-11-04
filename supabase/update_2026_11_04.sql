-- ClinicFlow update 6, November 4 2026: Send to front desk.
-- Run this in the Supabase SQL Editor AFTER update 4 (clinicflow-update-4-2026-10-30.sql).
-- Safe to run more than once. Nothing is deleted. Patients and history stay as they are.
--
-- What it does:
--   1. Follow up gets a "2 months" choice.
--   2. A school note (free text for how long) and an Other item (free text, for printouts
--      and so on) can be sent to the front desk from the room page, next to the follow up.
--      Each item has its own "I've got it", and shows in the waiting room list after check out.
--   3. Items live in the same rooms.followup field the follow up already uses, so every
--      place that clears it (new patient, lockout, end of day, Change room, Undo check out)
--      keeps working with no other changes.

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'log_room_step' and pronamespace = 'public'::regnamespace) then
    raise exception 'Run update 4 (clinicflow-update-4-2026-10-30.sql) first, then run this one.';
  end if;
end $$;

-- ---- Columns -----------------------------------------------------------------------
alter table checkouts add column if not exists school_note text;
alter table checkouts add column if not exists school_note_claimed_by text;
alter table checkouts add column if not exists fd_other text;
alter table checkouts add column if not exists fd_other_claimed_by text;

-- Follow up timeframe: add '2_months'.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.checkouts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%followup_timeframe%'
  loop
    execute format('alter table public.checkouts drop constraint %I', c.conname);
  end loop;
  alter table public.checkouts add constraint checkouts_followup_timeframe_check
    check (followup_timeframe in ('1_week','2_months','3_months','6_months','other'));
end $$;

-- ---- Functions ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('set_followup', 'set_fd_text', 'claim_checkout_item', 'check_out_room')
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

-- Follow up (timeframe and reason, plus an optional note) or clear it (both null).
-- Leaves the school note and Other item as they are.
create or replace function set_followup(p_room_id uuid, p_timeframe text, p_reason text, p_note text default null)
returns void language plpgsql as $$
declare
  v_note text;
  v_cur jsonb;
  v_new jsonb;
begin
  select coalesce(followup, '{}'::jsonb) into v_cur from rooms where id = p_room_id;
  if not found then
    return;
  end if;
  v_cur := v_cur - 'timeframe' - 'reason' - 'note';
  if p_timeframe is null and p_reason is null then
    v_new := v_cur;
  else
    if p_timeframe not in ('1_week', '2_months', '3_months', '6_months', 'other')
       or p_reason not in ('weight_check', 'asthma', 'medication_fu', 'wcc', 'generic') then
      return;
    end if;
    v_note := nullif(left(trim(coalesce(p_note, '')), 300), '');
    v_new := v_cur || jsonb_strip_nulls(jsonb_build_object('timeframe', p_timeframe, 'reason', p_reason, 'note', v_note));
  end if;
  update rooms set
    followup = case when v_new = '{}'::jsonb then null else v_new end,
    claims = coalesce(claims, '{}'::jsonb) - 'followup',
    updated_at = now()
  where id = p_room_id;
end;
$$;

-- School note (p_kind 'school_note') or Other (p_kind 'fd_other'): free text for the front desk.
-- Empty text removes it.
create or replace function set_fd_text(p_room_id uuid, p_kind text, p_text text)
returns void language plpgsql as $$
declare
  v_text text;
  v_cur jsonb;
  v_new jsonb;
begin
  if p_kind not in ('school_note', 'fd_other') then
    return;
  end if;
  select coalesce(followup, '{}'::jsonb) into v_cur from rooms where id = p_room_id;
  if not found then
    return;
  end if;
  v_text := nullif(left(trim(coalesce(p_text, '')), 300), '');
  v_new := case
    when v_text is null then v_cur - p_kind
    else v_cur || jsonb_build_object(p_kind, v_text)
  end;
  update rooms set
    followup = case when v_new = '{}'::jsonb then null else v_new end,
    claims = coalesce(claims, '{}'::jsonb) - p_kind,
    updated_at = now()
  where id = p_room_id;
end;
$$;

-- "I've got it" on one item in the waiting room list. p_kind is 'followup', 'school_note'
-- or 'fd_other'. An empty name undoes it.
create or replace function claim_checkout_item(p_checkout_id uuid, p_kind text, p_name text)
returns void language plpgsql as $$
declare
  v_name text := nullif(left(trim(coalesce(p_name, '')), 40), '');
begin
  if p_kind = 'followup' then
    update checkouts set followup_claimed_by = v_name where id = p_checkout_id;
  elsif p_kind = 'school_note' then
    update checkouts set school_note_claimed_by = v_name where id = p_checkout_id;
  elsif p_kind = 'fd_other' then
    update checkouts set fd_other_claimed_by = v_name where id = p_checkout_id;
  end if;
end;
$$;

-- Check out. Same as update 4, now also carrying the school note and Other item to the
-- waiting room list.
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

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

notify pgrst, 'reload schema';
