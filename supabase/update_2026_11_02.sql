-- ClinicFlow update 5, November 2 2026: Test mode.
-- Run this in the Supabase SQL Editor AFTER update 4 (clinicflow-update-4-2026-10-30.sql).
-- Safe to run more than once. It changes nothing in the live clinic.
--
-- Test mode is a separate practice copy of the clinic with its own rooms, staff, settings,
-- ticket numbers and Tracker. Nothing done in it can reach the live clinic, because every
-- screen only reads and writes the rows of the clinic it is showing.
--   ensure_test_clinic(live_clinic_id, false)  create the practice copy if it is missing
--   ensure_test_clinic(live_clinic_id, true)   throw the practice copy away and make a fresh
--                                              one from the live room names, staff and settings
-- The practice copy has the same slug as the live clinic plus "-test" (red-berry-test).

drop function if exists ensure_test_clinic(uuid, boolean);

create or replace function ensure_test_clinic(p_live_clinic_id uuid, p_reset boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare
  live clinics%rowtype;
  v_slug text;
  v_test uuid;
begin
  select * into live from clinics where id = p_live_clinic_id;
  if not found or live.slug like '%-test' then
    return null;
  end if;

  v_slug := live.slug || '-test';
  select id into v_test from clinics where slug = v_slug;

  if v_test is not null and not p_reset then
    return v_slug;
  end if;
  if v_test is not null then
    -- Removes only the practice copy (and everything that belongs to it).
    delete from clinics where id = v_test and slug = v_slug;
  end if;

  insert into clinics (slug, name, room_count, next_ticket_num, timezone, timer_targets)
  values (v_slug, live.name || ' (TEST)', live.room_count, 1, live.timezone, live.timer_targets)
  returning id into v_test;

  insert into hallways (clinic_id, key, label, color, sort_order)
  select v_test, key, label, color, sort_order from hallways where clinic_id = live.id;

  insert into staff (clinic_id, name, role, color, sort_order, name_color)
  select v_test, name, role, color, sort_order, name_color from staff where clinic_id = live.id;

  insert into rooms (clinic_id, room_number, name, hallway_id, side, directions, assigned_nurse_id, assigned_doctor_id)
  select v_test, r.room_number, r.name, th.id, r.side, r.directions, tn.id, td.id
  from rooms r
  left join hallways lh on lh.id = r.hallway_id
  left join hallways th on th.clinic_id = v_test and th.key = lh.key
  left join staff ln on ln.id = r.assigned_nurse_id
  left join staff tn on tn.clinic_id = v_test and tn.role = ln.role and tn.name = ln.name
  left join staff ld on ld.id = r.assigned_doctor_id
  left join staff td on td.clinic_id = v_test and td.role = ld.role and td.name = ld.name
  where r.clinic_id = live.id;

  return v_slug;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

notify pgrst, 'reload schema';
