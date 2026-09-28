-- ClinicFlow migration 0004
-- Additive/replace only — does not touch supabase/schema.sql or earlier
-- migrations' data. Safe to run after 0002 and 0003. Run once in the
-- Supabase SQL editor for the red-berry project.
--
-- Adds what's needed for: Admin > Day history drill-down, the new All-time
-- tab (visit trend, per-provider/per-nurse stats, room utilization), and
-- wait-time percentiles / CSV export.

-- ------------------------------------------------------------ nurse_name --
-- room_history already captures provider_name for with_doctor rows; it never
-- captured WHICH nurse did the prepping. Per-nurse stats only have data from
-- the point this migration runs forward — prepping rows logged before this
-- won't have a nurse_name.
alter table room_history add column if not exists nurse_name text;

create or replace function advance_room_stage(p_room_id uuid)
returns void language plpgsql as $$
declare
  v_room rooms%rowtype;
  v_next text;
  v_elapsed_ms bigint;
  v_provider_name text;
  v_nurse_name text;
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
  v_nurse_name := null;
  if v_room.stage = 'with_doctor' then
    select name into v_provider_name from staff where id = v_room.assigned_doctor_id;
  elsif v_room.stage = 'prepping' then
    select name into v_nurse_name from staff where id = v_room.assigned_nurse_id;
  end if;

  insert into room_history (clinic_id, room_id, stage, duration_ms, provider_name, nurse_name)
  values (v_room.clinic_id, v_room.id, v_room.stage, v_elapsed_ms, v_provider_name, v_nurse_name);

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

-- ------------------------------------------------------------ vacant time --
-- Room utilization (vacant vs. occupied vs. needs-cleanup) needs vacant
-- stretches logged too. Nothing logged this before, so assign_patient now
-- records the vacant time that's ending. Same caveat as above: the very
-- first patient assigned to a room after this migration will log one
-- "vacant" row spanning back to whenever that room last changed stage
-- (possibly since setup) — expected, not a bug.
create or replace function assign_patient(p_room_id uuid)
returns text language plpgsql as $$
declare
  v_room rooms%rowtype;
  v_ticket_num int;
  v_ticket text;
  v_vacant_ms bigint;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found or v_room.stage <> 'vacant' or v_room.contaminated then
    return null;
  end if;

  v_vacant_ms := extract(epoch from (now() - v_room.stage_started_at)) * 1000;

  update clinics set next_ticket_num = next_ticket_num + 1
  where id = v_room.clinic_id
  returning next_ticket_num - 1 into v_ticket_num;

  v_ticket := 'A-0' || v_ticket_num;

  insert into room_history (clinic_id, room_id, stage, duration_ms)
  values (v_room.clinic_id, v_room.id, 'vacant', v_vacant_ms);

  update rooms set
    stage = 'ready_for_nurse', stage_started_at = now(), ticket = v_ticket, updated_at = now()
  where id = p_room_id;

  insert into calls (clinic_id, room_id, ticket) values (v_room.clinic_id, p_room_id, v_ticket);
  return v_ticket;
end;
$$;

-- --------------------------------------------------------- analytics RPCs --
-- All three take an optional [p_since, p_until) window: called with no
-- bounds for the All-time tab, or with one day's opened_at/closed_at for the
-- Admin > Day history drill-down. Plain SQL functions (not SECURITY DEFINER)
-- so they run under the caller's existing "public read" RLS policies.

create or replace function get_provider_stats(p_clinic_id uuid, p_since timestamptz default null, p_until timestamptz default null)
returns table(provider_name text, visits bigint, avg_ms numeric, p50_ms numeric, p90_ms numeric)
language sql stable as $$
  select
    provider_name,
    count(*)::bigint as visits,
    avg(duration_ms) as avg_ms,
    percentile_cont(0.5) within group (order by duration_ms) as p50_ms,
    percentile_cont(0.9) within group (order by duration_ms) as p90_ms
  from room_history
  where clinic_id = p_clinic_id
    and stage = 'with_doctor'
    and provider_name is not null
    and (p_since is null or ended_at >= p_since)
    and (p_until is null or ended_at < p_until)
  group by provider_name
  order by visits desc;
$$;

create or replace function get_nurse_stats(p_clinic_id uuid, p_since timestamptz default null, p_until timestamptz default null)
returns table(nurse_name text, visits bigint, avg_ms numeric, p50_ms numeric, p90_ms numeric)
language sql stable as $$
  select
    nurse_name,
    count(*)::bigint as visits,
    avg(duration_ms) as avg_ms,
    percentile_cont(0.5) within group (order by duration_ms) as p50_ms,
    percentile_cont(0.9) within group (order by duration_ms) as p90_ms
  from room_history
  where clinic_id = p_clinic_id
    and stage = 'prepping'
    and nurse_name is not null
    and (p_since is null or ended_at >= p_since)
    and (p_until is null or ended_at < p_until)
  group by nurse_name
  order by visits desc;
$$;

create or replace function get_stage_percentiles(p_clinic_id uuid, p_since timestamptz default null, p_until timestamptz default null)
returns table(stage text, n bigint, avg_ms numeric, p50_ms numeric, p90_ms numeric)
language sql stable as $$
  select
    stage,
    count(*)::bigint as n,
    avg(duration_ms) as avg_ms,
    percentile_cont(0.5) within group (order by duration_ms) as p50_ms,
    percentile_cont(0.9) within group (order by duration_ms) as p90_ms
  from room_history
  where clinic_id = p_clinic_id
    and (p_since is null or ended_at >= p_since)
    and (p_until is null or ended_at < p_until)
  group by stage;
$$;

create or replace function get_room_utilization(p_clinic_id uuid, p_since timestamptz default null, p_until timestamptz default null)
returns table(room_id uuid, room_name text, stage text, total_ms bigint)
language sql stable as $$
  select rh.room_id, r.name, rh.stage, sum(rh.duration_ms)::bigint as total_ms
  from room_history rh
  join rooms r on r.id = rh.room_id
  where rh.clinic_id = p_clinic_id
    and (p_since is null or rh.ended_at >= p_since)
    and (p_until is null or rh.ended_at < p_until)
  group by rh.room_id, r.name, rh.stage;
$$;
