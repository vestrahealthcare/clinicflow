"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ClinicDay, StaffStatRow, RoomUtilizationRow, Room, Stage } from "@/lib/types";
import { STAGE_LABEL } from "@/lib/constants";
import { formatMinutes, toCsv, downloadCsv, utilizationBucket } from "@/lib/util";

interface Props {
  clinicId: string;
  allDays: ClinicDay[];
  rooms: Room[];
}

/** The Monday (YYYY-MM-DD) of the week a given day falls in, for grouping into weeks. */
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const dow = d.getDay(); // 0 = Sun .. 6 = Sat
  const diff = (dow === 0 ? -6 : 1) - dow;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

interface WeekBucket {
  week: string;
  visits: number;
  daySums: Partial<Record<Stage, { total: number; count: number }>>;
}

function bucketByWeek(days: ClinicDay[]): WeekBucket[] {
  const map: Record<string, WeekBucket> = {};
  const stageFields: [Stage, keyof ClinicDay][] = [
    ["ready_for_nurse", "avg_ready_for_nurse_ms"],
    ["prepping", "avg_prepping_ms"],
    ["ready_for_doctor", "avg_ready_for_doctor_ms"],
    ["with_doctor", "avg_with_doctor_ms"],
    ["needs_cleanup", "avg_needs_cleanup_ms"]
  ];
  days.forEach((d) => {
    if (!d.opened_at) return;
    const week = mondayOf(d.day_date);
    map[week] ||= { week, visits: 0, daySums: {} };
    map[week].visits += d.total_visits ?? 0;
    stageFields.forEach(([stage, field]) => {
      const v = d[field] as number | null;
      if (v == null) return;
      const bucket = (map[week].daySums[stage] ||= { total: 0, count: 0 });
      bucket.total += v;
      bucket.count += 1;
    });
  });
  return Object.values(map).sort((a, b) => a.week.localeCompare(b.week));
}

export function AllTimePanel({ clinicId, allDays, rooms }: Props) {
  const [providers, setProviders] = useState<StaffStatRow[]>([]);
  const [nurses, setNurses] = useState<StaffStatRow[]>([]);
  const [utilization, setUtilization] = useState<RoomUtilizationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [{ data: p }, { data: n }, { data: u }] = await Promise.all([
        supabase.rpc("get_provider_stats", { p_clinic_id: clinicId }),
        supabase.rpc("get_nurse_stats", { p_clinic_id: clinicId }),
        supabase.rpc("get_room_utilization", { p_clinic_id: clinicId })
      ]);
      if (cancelled) return;
      setProviders((p as StaffStatRow[]) ?? []);
      setNurses((n as StaffStatRow[]) ?? []);
      setUtilization((u as RoomUtilizationRow[]) ?? []);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  const totalVisits = allDays.reduce((a, d) => a + (d.total_visits ?? 0), 0);
  const daysOperated = allDays.filter((d) => d.opened_at).length;
  const busiestDay = allDays.reduce<ClinicDay | null>(
    (best, d) => (!best || (d.total_visits ?? 0) > (best.total_visits ?? 0) ? d : best),
    null
  );

  const weeks = useMemo(() => bucketByWeek(allDays), [allDays]);
  const maxWeeklyVisits = Math.max(...weeks.map((w) => w.visits), 1);
  const thisWeek = weeks[weeks.length - 1];
  const lastWeek = weeks[weeks.length - 2];

  const utilByRoom = useMemo(() => {
    const map: Record<string, { room_name: string; Vacant: number; Occupied: number; "Needs cleanup": number }> = {};
    utilization.forEach((row) => {
      const bucket = utilizationBucket(row.stage);
      map[row.room_id] ||= { room_name: row.room_name, Vacant: 0, Occupied: 0, "Needs cleanup": 0 };
      map[row.room_id][bucket] += row.total_ms;
    });
    return Object.values(map);
  }, [utilization]);

  function weekStageAvg(w: WeekBucket | undefined, stage: Stage): number | null {
    const b = w?.daySums[stage];
    if (!b || b.count === 0) return null;
    return b.total / b.count;
  }

  async function exportRange() {
    if (!rangeStart || !rangeEnd) return;
    setExporting(true);
    const since = `${rangeStart}T00:00:00`;
    const until = `${rangeEnd}T23:59:59`;
    const { data } = await supabase
      .from("room_history")
      .select("*")
      .eq("clinic_id", clinicId)
      .gte("ended_at", since)
      .lte("ended_at", until)
      .order("ended_at");
    const roomNameById = Object.fromEntries(rooms.map((r) => [r.id, r.name]));
    const rows = (data ?? []).map((h) => ({
      room: roomNameById[h.room_id] ?? h.room_id,
      stage: STAGE_LABEL[h.stage as Stage] ?? h.stage,
      minutes: (h.duration_ms / 60000).toFixed(1),
      provider: h.provider_name ?? "",
      nurse: h.nurse_name ?? "",
      ended_at: h.ended_at
    }));
    downloadCsv(`clinicflow_${rangeStart}_to_${rangeEnd}.csv`, toCsv(rows));
    setExporting(false);
  }

  return (
    <div>
      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))" }}>
        <div className="card p-4">
          <div className="text-xs text-slate-500 mb-1">Total visits, all-time</div>
          <div className="text-2xl font-bold">{totalVisits}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500 mb-1">Days operated</div>
          <div className="text-2xl font-bold">{daysOperated}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500 mb-1">Avg visits / day</div>
          <div className="text-2xl font-bold">{daysOperated ? (totalVisits / daysOperated).toFixed(1) : "—"}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500 mb-1">Busiest day</div>
          <div className="text-2xl font-bold">{busiestDay?.total_visits ?? "—"}</div>
          <div className="text-xs text-slate-500">{busiestDay?.day_date ?? ""}</div>
        </div>
      </div>

      <div className="card p-5 mb-5">
        <h3 className="font-bold mb-4">Visits per week</h3>
        {weeks.map((w) => (
          <div key={w.week} className="flex items-center gap-3 mb-2">
            <div className="w-24 text-xs text-slate-500 shrink-0">{w.week}</div>
            <div className="flex-1 bg-slate-100 dark:bg-slate-900 rounded-md h-6 relative overflow-hidden">
              <div
                className="h-full rounded-md flex items-center pl-2 text-xs font-semibold text-white"
                style={{ width: `${Math.max(4, (w.visits / maxWeeklyVisits) * 100)}%`, backgroundColor: "#3568C4" }}
              >
                {w.visits}
              </div>
            </div>
          </div>
        ))}
        {weeks.length === 0 && <p className="text-sm text-slate-400">No completed days yet.</p>}
      </div>

      {thisWeek && lastWeek && (
        <div className="card p-5 mb-5">
          <h3 className="font-bold mb-1">This week vs. last week</h3>
          <p className="text-sm text-slate-500 mb-3">
            Week of {thisWeek.week} ({thisWeek.visits} visits) vs. week of {lastWeek.week} ({lastWeek.visits} visits).
            Averages below are the mean of each day&apos;s own average for that step.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 text-xs">
                <th className="pb-2">Step</th>
                <th className="pb-2">This week</th>
                <th className="pb-2">Last week</th>
              </tr>
            </thead>
            <tbody>
              {(["ready_for_nurse", "prepping", "ready_for_doctor", "with_doctor", "needs_cleanup"] as Stage[]).map(
                (s) => (
                  <tr key={s} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="py-2">{STAGE_LABEL[s]}</td>
                    <td className="py-2 font-mono">
                      {weekStageAvg(thisWeek, s) != null ? formatMinutes(weekStageAvg(thisWeek, s)!) : "—"}
                    </td>
                    <td className="py-2 font-mono">
                      {weekStageAvg(lastWeek, s) != null ? formatMinutes(weekStageAvg(lastWeek, s)!) : "—"}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 mb-5">
        <div className="card p-5">
          <h3 className="font-bold mb-3">Providers, all-time</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 text-xs">
                <th className="pb-2">Name</th>
                <th className="pb-2">Visits</th>
                <th className="pb-2">Avg</th>
                <th className="pb-2">p90</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.provider_name} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="py-2">{p.provider_name}</td>
                  <td className="py-2 font-mono">{p.visits}</td>
                  <td className="py-2 font-mono">{formatMinutes(p.avg_ms)}</td>
                  <td className="py-2 font-mono">{formatMinutes(p.p90_ms)}</td>
                </tr>
              ))}
              {!loading && providers.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-2 text-slate-400">
                    No completed visits yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card p-5">
          <h3 className="font-bold mb-3">Nurses, all-time</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 text-xs">
                <th className="pb-2">Name</th>
                <th className="pb-2">Preps</th>
                <th className="pb-2">Avg</th>
                <th className="pb-2">p90</th>
              </tr>
            </thead>
            <tbody>
              {nurses.map((n) => (
                <tr key={n.nurse_name} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="py-2">{n.nurse_name}</td>
                  <td className="py-2 font-mono">{n.visits}</td>
                  <td className="py-2 font-mono">{formatMinutes(n.avg_ms)}</td>
                  <td className="py-2 font-mono">{formatMinutes(n.p90_ms)}</td>
                </tr>
              ))}
              {!loading && nurses.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-2 text-slate-400">
                    No preps logged since nurse tracking was added
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5 mb-5">
        <h3 className="font-bold mb-1">Room utilization, all-time</h3>
        <p className="text-sm text-slate-500 mb-3">
          How each room&apos;s tracked time splits between sitting vacant, occupied by a visit, and awaiting cleanup.
          Vacant time only counts from when tracking for it was added, so early totals may look low.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 text-xs">
              <th className="pb-2">Room</th>
              <th className="pb-2">Vacant</th>
              <th className="pb-2">Occupied</th>
              <th className="pb-2">Needs cleanup</th>
            </tr>
          </thead>
          <tbody>
            {utilByRoom.map((r) => (
              <tr key={r.room_name} className="border-t border-slate-100 dark:border-slate-700">
                <td className="py-2">{r.room_name}</td>
                <td className="py-2 font-mono">{formatMinutes(r.Vacant)}</td>
                <td className="py-2 font-mono">{formatMinutes(r.Occupied)}</td>
                <td className="py-2 font-mono">{formatMinutes(r["Needs cleanup"])}</td>
              </tr>
            ))}
            {!loading && utilByRoom.length === 0 && (
              <tr>
                <td colSpan={4} className="py-2 text-slate-400">
                  No room activity logged yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-5">
        <h3 className="font-bold mb-3">Export a date range</h3>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <div className="text-xs text-slate-500 mb-1">From</div>
            <input
              type="date"
              className="border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2 text-sm"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">To</div>
            <input
              type="date"
              className="border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2 text-sm"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
            />
          </div>
          <button
            className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            onClick={exportRange}
            disabled={!rangeStart || !rangeEnd || exporting}
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>
    </div>
  );
}
