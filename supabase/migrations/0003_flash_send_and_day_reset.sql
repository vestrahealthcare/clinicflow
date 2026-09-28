-- ClinicFlow migration 0003
-- Additive/replace only — does not touch supabase/schema.sql, migration 0002,
-- or any existing data. Safe to run after 0002. Run once in the Supabase SQL
-- editor for the red-berry project.

-- ---------------------------------------------------- flash auto-clear --
-- A room's flash (whether toggled manually or by sending a teammate note)
-- now always clears itself the moment the room goes vacant again — either
-- through the normal stage advance, or by clearing a contamination lockout.
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
    flashing = case when v_next = 'vacant' then false else flashing end,
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
      ticket = null, note = null, requests = '{}'::jsonb, flashing = false, updated_at = now()
    where id = p_room_id;
  end if;
end;
$$;

-- ------------------------------------------------------- day restart fix --
-- Previously, once closed_at was set, pressing Start Day again did nothing
-- (opened_at was already non-null so the coalesce left it alone, and
-- closed_at was never cleared) — the Admin page had no way back to "open".
-- Now Start Day always clears closed_at, so a closed day can be reopened;
-- opened_at still only records the *original* open time for that date.
create or replace function start_clinic_day(p_clinic_id uuid)
returns uuid language plpgsql as $$
declare
  v_id uuid;
  v_today date := current_date;
begin
  insert into clinic_days (clinic_id, day_date, opened_at)
  values (p_clinic_id, v_today, now())
  on conflict (clinic_id, day_date) do update set
    opened_at = coalesce(clinic_days.opened_at, excluded.opened_at),
    closed_at = null
  returning id into v_id;
  return v_id;
end;
$$;

-- Ending the day now also resets every non-contaminated room back to vacant
-- (clears ticket/note/requests/flashing) so the next Start Day begins clean.
-- Contaminated rooms are left alone — a lockout survives a day boundary
-- until someone actually clears it.
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

  update rooms set
    stage = 'vacant',
    stage_started_at = now(),
    ticket = null,
    note = null,
    requests = '{}'::jsonb,
    flashing = false,
    updated_at = now()
  where clinic_id = p_clinic_id and contaminated = false;
end;
$$;
