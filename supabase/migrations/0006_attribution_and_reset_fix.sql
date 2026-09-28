-- ClinicFlow migration 0006
-- Additive/replace only. Safe to run after 0005_v2.sql.
--
-- Fixes: request chips (Lab, RSV, etc.) weren't clearing when a room cycled
-- back to vacant, so the next patient's room could show a stale claimed
-- request from the previous visit.
-- Adds: attribution — who ordered a request (not just who claimed it) and
-- who sent a note — so a persistent "Acting as" name in the browser is
-- actually visible on the things that person did.

-- ------------------------------------------------------- vacant reset fix --
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
    when 'with_doctor' then 'needs_cleanup'
    when 'needs_cleanup' then 'vacant'
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

  -- The bug fix: a room reaching vacant always starts the next patient with
  -- a completely clean slate of requests, claimed or not.
  if v_next = 'vacant' then
    update room_requests set cleared_at = now() where room_id = p_room_id and cleared_at is null;
  end if;

  return v_history_id;
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
      ticket = null, note = null, note_author = null, requests = '{}'::jsonb, flashing = false,
      provider_finished_at = null, updated_at = now()
    where id = p_room_id;
    update room_requests set cleared_at = now() where room_id = p_room_id and cleared_at is null;
  end if;
end;
$$;

-- ------------------------------------------------------------ attribution --
alter table room_requests add column if not exists created_by text;
alter table rooms add column if not exists note_author text;

-- Gains a parameter — different signature, so drop the old 2-arg version
-- first (same reasoning as assign_patient/advance_room_stage in 0005).
drop function if exists create_room_request(uuid, text);
create or replace function create_room_request(p_room_id uuid, p_key text, p_created_by text default null)
returns uuid language plpgsql as $$
declare
  v_clinic_id uuid;
  v_existing uuid;
  v_id uuid;
begin
  select id into v_existing from room_requests
    where room_id = p_room_id and key = p_key and cleared_at is null
    limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  select clinic_id into v_clinic_id from rooms where id = p_room_id;
  insert into room_requests (clinic_id, room_id, key, created_by)
  values (v_clinic_id, p_room_id, p_key, nullif(trim(p_created_by), ''))
  returning id into v_id;
  return v_id;
end;
$$;

drop function if exists set_room_note(uuid, text);
create or replace function set_room_note(p_room_id uuid, p_note text, p_author text default null)
returns void language plpgsql as $$
begin
  update rooms set
    note = nullif(trim(p_note), ''),
    note_author = case when nullif(trim(p_note), '') is null then null else nullif(trim(p_author), '') end,
    updated_at = now()
  where id = p_room_id;
end;
$$;
