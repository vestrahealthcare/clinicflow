-- ClinicFlow migration 0008
-- Fixes the Weekly/Monthly/All-time (and Day) "Reset this period" buttons.
--
-- room_history has only ever had SELECT and INSERT policies (see
-- schema.sql), never DELETE. reset_period_data (0005) runs as the calling
-- role (no SECURITY DEFINER), so its `delete from room_history` was being
-- silently blocked by RLS the entire time — it ran without error but
-- matched zero rows. room_requests and clinic_days already have "for all"
-- policies, so those two tables' rows were actually being deleted; only the
-- visit-history numbers (percentiles, provider/nurse stats, room
-- utilization, totals) never changed. This just adds the missing policy.

drop policy if exists "public delete history" on room_history;
create policy "public delete history" on room_history for delete using (true);
