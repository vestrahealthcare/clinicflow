-- ClinicFlow migration 0007
-- Additive/replace only. Safe to run after 0006_attribution_and_reset_fix.sql.
--
-- Removes the "needs cleanup" step from the live workflow: a patient
-- departing now goes straight from with_doctor to vacant. The
-- `needs_cleanup` stage value, its historical room_history rows, and its
-- admin analytics (Room utilization, Day/Week/Month/All-time "Avg
-- turnaround") are all left untouched — this only changes what happens
-- going forward. Any room already sitting in needs_cleanup at the moment
-- this runs still has a working path to vacant (that mapping is kept).

create or replace function advance_room_stage(p_room_id uuid)
returns uuid language plpgsql as $$
declare
  v_room rooms%rowtype;
  v_next text;
  v_elapsed_ms bigint;
  v_provider_name text;
  v_nurse_name text;
  v_history_id uuid;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found or v_room.contaminated or v_room.stage = 'vacant' then
    return null;
  end if;

  v_elapsed_ms := extract(epoch from (now() - v_room.stage_started_at)) * 1000;
  v_next := case v_room.stage
    when 'ready_for_nurse' then 'prepping'
    when 'prepping' then 'ready_for_doctor'
    when 'ready_for_doctor' then 'with_doctor'
    when 'with_doctor' then 'vacant'      -- was 'needs_cleanup'; patient departed skips straight to vacant now
    when 'needs_cleanup' then 'vacant'    -- kept: lets any room already mid-cleanup still finish out
  end;

  v_provider_name := null;
  v_nurse_name := null;
  if v_room.stage = 'with_doctor' then
    select name into v_provider_name from staff where id = v_room.assigned_doctor_id;
  elsif v_room.stage = 'prepping' then
    select name into v_nurse_name from staff where id = v_room.assigned_nurse_id;
  end if;

  insert into room_history (clinic_id, room_id, stage, duration_ms, provider_name, nurse_name)
  values (v_room.clinic_id, v_room.id, v_room.stage, v_elapsed_ms, v_provider_name, v_nurse_name)
  returning id into v_history_id;

  update rooms set
    stage = v_next,
    stage_started_at = now(),
    ticket = case when v_next = 'vacant' then null else ticket end,
    note = case when v_next = 'vacant' then null else note end,
    note_author = case when v_next = 'vacant' then null else note_author end,
    requests = case when v_next = 'vacant' then '{}'::jsonb else requests end,
    flashing = case when v_next = 'vacant' then false else flashing end,
    provider_finished_at = case when v_next = 'vacant' then null else provider_finished_at end,
    updated_at = now()
  where id = p_room_id;

  if v_next = 'vacant' then
    update room_requests set cleared_at = now() where room_id = p_room_id and cleared_at is null;
  end if;

  return v_history_id;
end;
$$;

-- "Completed visits" was counted via needs_cleanup rows (the old terminal
-- stage before vacant); with_doctor is now the terminal stage, so this
-- switches to counting that instead. Both counts are identical for any
-- historical day that went through both stages, so nothing retroactively
-- changes for past days.
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
      where clinic_id = p_clinic_id and stage = 'with_doctor' and ended_at >= v_since
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

-- ------------------------------------------------------- doctor idle reset --
-- Doctor idle time is calculated live from with_doctor room_history rows —
-- the same rows behind "Avg doctor in room" and visit counts — so resetting
-- it can't mean deleting that data without also wiping those. Instead this
-- is just a per-clinic cutoff: the idle-time calculation only counts gaps
-- between visits that happened after idle_reset_at. Nothing is deleted, so
-- there's nothing to undo — the same reasoning as the two-step confirms
-- on the history resets doesn't apply here, this just needs one warning.
alter table clinics add column if not exists idle_reset_at timestamptz;

create or replace function reset_doctor_idle(p_clinic_id uuid)
returns void language plpgsql as $$
begin
  update clinics set idle_reset_at = now() where id = p_clinic_id;
end;
$$;
