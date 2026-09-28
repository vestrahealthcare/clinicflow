-- ClinicFlow migration 0005 (v2)
-- Additive/replace only — does not touch supabase/schema.sql or earlier
-- migrations' data or rows. Safe to run after 0002/0003/0004.
--
-- Adds: trackable/claimable room requests (replaces silent jsonb flags),
-- team huddle board, persistent patient identifiers, provider-finished vs
-- patient-departed, and a scoped history reset function.

-- ------------------------------------------------------------ room_requests --
-- Replaces the old boolean `rooms.requests` jsonb flags with real rows so
-- each request can be claimed/acknowledged and tracked individually. The old
-- `toggle_request` RPC and `rooms.requests` column are left in place but
-- unused by new app code — no risk to existing data.
create table if not exists room_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  key text not null,
  created_at timestamptz not null default now(),
  acknowledged_by text,
  acknowledged_at timestamptz,
  cleared_at timestamptz
);
create index if not exists idx_room_requests_room on room_requests(room_id);
create index if not exists idx_room_requests_clinic on room_requests(clinic_id, created_at desc);

alter table room_requests enable row level security;
create policy "public read room_requests" on room_requests for select using (true);
create policy "public write room_requests" on room_requests for all using (true) with check (true);
alter publication supabase_realtime add table room_requests;

-- Idempotent: calling this when an active (uncleared) request for the same
-- room+key already exists just returns that existing request's id, so the
-- room-page button can safely be a plain toggle without a client-side check.
create or replace function create_room_request(p_room_id uuid, p_key text)
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
  insert into room_requests (clinic_id, room_id, key) values (v_clinic_id, p_room_id, p_key)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function acknowledge_room_request(p_request_id uuid, p_by text)
returns void language plpgsql as $$
begin
  update room_requests set acknowledged_by = nullif(trim(p_by), ''), acknowledged_at = now()
  where id = p_request_id and cleared_at is null;
end;
$$;

create or replace function clear_room_request(p_request_id uuid)
returns void language plpgsql as $$
begin
  update room_requests set cleared_at = now() where id = p_request_id and cleared_at is null;
end;
$$;

-- ------------------------------------------------------------- huddle_posts --
create table if not exists huddle_posts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  author text not null,
  body text not null,
  category text not null check (category in ('today', 'week')),
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_huddle_clinic on huddle_posts(clinic_id, created_at desc);

alter table huddle_posts enable row level security;
create policy "public read huddle_posts" on huddle_posts for select using (true);
create policy "public write huddle_posts" on huddle_posts for all using (true) with check (true);
alter publication supabase_realtime add table huddle_posts;

-- --------------------------------------------------------- patient identity --
-- patient_label persists across a vacancy on purpose (the opposite of
-- ticket/note/requests) — see advance_room_stage and set_lockout below,
-- neither of which clears it. provider_finished_at is a separate marker from
-- the room's stage so "provider done" never implies "patient discharged."
alter table rooms add column if not exists patient_label text;
alter table rooms add column if not exists provider_finished_at timestamptz;

create or replace function set_patient_label(p_room_id uuid, p_label text)
returns void language plpgsql as $$
begin
  update rooms set patient_label = nullif(trim(p_label), ''), updated_at = now() where id = p_room_id;
end;
$$;

create or replace function mark_provider_finished(p_room_id uuid)
returns void language plpgsql as $$
begin
  update rooms set provider_finished_at = now(), updated_at = now() where id = p_room_id;
end;
$$;

-- Front desk assigns a label at check-in; deduped against what's CURRENTLY
-- shown on other rooms in this clinic (not all-time history — a patient from
-- three weeks ago sharing initials doesn't matter, only what's visibly on
-- the board right now), e.g. "JS" -> "JS-2" -> "JS-3".
create or replace function assign_patient(p_room_id uuid, p_label text default null)
returns text language plpgsql as $$
declare
  v_room rooms%rowtype;
  v_ticket_num int;
  v_ticket text;
  v_vacant_ms bigint;
  v_label text;
  v_candidate text;
  v_suffix int;
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

  v_label := nullif(trim(p_label), '');
  if v_label is not null then
    v_candidate := v_label;
    v_suffix := 1;
    while exists (
      select 1 from rooms
      where clinic_id = v_room.clinic_id and id <> p_room_id and patient_label = v_candidate
    ) loop
      v_suffix := v_suffix + 1;
      v_candidate := v_label || '-' || v_suffix;
    end loop;
    v_label := v_candidate;
  end if;

  -- Always overwrite (even with null) — a new patient replaces whatever
  -- label the room retained from its last one.
  update rooms set
    stage = 'ready_for_nurse', stage_started_at = now(), ticket = v_ticket,
    patient_label = v_label, provider_finished_at = null, updated_at = now()
  where id = p_room_id;

  insert into calls (clinic_id, room_id, ticket) values (v_room.clinic_id, p_room_id, v_ticket);
  return v_ticket;
end;
$$;

-- ------------------------------------------------------- stage machine tweaks --
-- Returns the new room_history row's id (was void) so Undo can delete
-- exactly that row if the stage advance gets undone. patient_label is
-- deliberately left out of the vacant-transition reset list.
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
    requests = case when v_next = 'vacant' then '{}'::jsonb else requests end,
    flashing = case when v_next = 'vacant' then false else flashing end,
    provider_finished_at = case when v_next = 'vacant' then null else provider_finished_at end,
    updated_at = now()
  where id = p_room_id;

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
      ticket = null, note = null, requests = '{}'::jsonb, flashing = false,
      provider_finished_at = null, updated_at = now()
    where id = p_room_id;
  end if;
end;
$$;

-- ---------------------------------------------------------- history reset --
-- Deletes only what falls inside [p_since, p_until) — nothing outside the
-- range is touched. Since Week/Month/All-time are computed live from
-- room_history (not stored running totals), removing rows here is the whole
-- fix: broader totals recalculate automatically the next time they're
-- queried, with no separate "recompute" step needed.
-- p_since/p_until of null,null resets ALL-time data (matches the "unbounded"
-- convention the get_* analytics RPCs already use).
create or replace function reset_period_data(p_clinic_id uuid, p_since timestamptz, p_until timestamptz)
returns void language plpgsql as $$
begin
  delete from room_history
    where clinic_id = p_clinic_id
      and (p_since is null or ended_at >= p_since)
      and (p_until is null or ended_at < p_until);
  delete from room_requests
    where clinic_id = p_clinic_id
      and (p_since is null or created_at >= p_since)
      and (p_until is null or created_at < p_until);
  delete from clinic_days
    where clinic_id = p_clinic_id
      and (p_since is null or day_date >= p_since::date)
      and (p_until is null or day_date < p_until::date);
end;
$$;
