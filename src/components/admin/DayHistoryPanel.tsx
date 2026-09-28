"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ClinicDay, StaffStatRow, StagePercentileRow, RoomUtilizationRow, Stage } from "@/lib/types";
import { STAGE_LABEL, STAGE_ORDER } from "@/lib/constants";
import { formatClockTime, formatMinutes, toCsv, downloadCsv, utilizationBucket } from "@/lib/util";

interface Props {
  clinicId: string;
  days: ClinicDay[];
  roomNameById: Record<string, string>;
}

interface DayDetail {
  percentiles: StagePercentileRow[];
  providers: StaffStatRow[];
  nurses: StaffStatRow[];
  utilization: RoomUtilizationRow[];
}

function dayBounds(day: ClinicDay): { since: string; until: string } {
  return {
    since: day.opened_at ?? `${day.day_date}T00:00:00`,
    until: day.closed_at ?? `${day.day_date}T23:59:59`
  };
}

export function DayHistoryPanel({ clinicId, days, roomNameById }: Props) {
  const [selected, setSelected] = useState<ClinicDay | null>(null);
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function openDay(day: ClinicDay) {
    setSelected(day);
    setDetail(null);
    setLoading(true);
    const { since, until } = dayBounds(day);
    const [{ data: percentiles }, { data: providers }, { data: nurses }, { data: utilization }] = await Promise.all([
      supabase.rpc("get_stage_percentiles", { p_clinic_id: clinicId, p_since: since, p_until: until }),
      supabase.rpc("get_provider_stats", { p_clinic_id: clinicId, p_since: since, p_until: until }),
      supabase.rpc("get_nurse_stats", { p_clinic_id: clinicId, p_since: since, p_until: until }),
      supabase.rpc("get_room_utilization", { p_clinic_id: clinicId, p_since: since, p_until: until })
    ]);
    setDetail({
      percentiles: (percentiles as StagePercentileRow[]) ?? [],
      providers: (providers as StaffStatRow[]) ?? [],
      nurses: (nurses as StaffStatRow[]) ?? [],
      utilization: (utilization as RoomUtilizationRow[]) ?? []
    });
    setLoading(false);
  }

  async function exportDay(day: ClinicDay) {
    setExporting(true);
    const { since, until } = dayBounds(day);
    const { data } = await supabase
      .from("room_history")
      .select("*")
      .eq("clinic_id", clinicId)
      .gte("ended_at", since)
      .lte("ended_at", until)
      .order("ended_at");
    const rows = (data ?? []).map((h) => ({
      room: roomNameById[h.room_id] ?? h.room_id,
      stage: STAGE_LABEL[h.stage as Stage] ?? h.stage,
      minutes: (h.duration_ms / 60000).toFixed(1),
      provider: h.provider_name ?? "",
      nurse: h.nurse_name ?? "",
      ended_at: h.ended_at
    }));
    downloadCsv(`clinicflow_${day.day_date}.csv`, toCsv(rows));
    setExporting(false);
  }

  function percentileFor(stage: Stage): StagePercentileRow | undefined {
    return detail?.percentiles.find((p) => p.stage === stage);
  }

  const utilByRoom = detail
    ? (() => {
        const map: Record<string, { room_name: string; Vacant: number; Occupied: number; "Needs cleanup": number }> = {};
        detail.utilization.forEach((row) => {
          const bucket = utilizationBucket(row.stage);
          map[row.room_id] ||= { room_name: row.room_name, Vacant: 0, Occupied: 0, "Needs cleanup": 0 };
          map[row.room_id][bucket] += row.total_ms;
        });
        return Object.values(map);
      })()
    : [];

  return (
    <div className="card p-5 mb-5">
      <h3 className="font-bold mb-3">Day history</h3>
      <p className="text-sm text-slate-500 mb-3">Click a day to see how the clinic ran that day.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 text-xs whitespace-nowrap">
              <th className="pb-2 pr-3">Date</th>
              <th className="pb-2 pr-3">Opened</th>
              <th className="pb-2 pr-3">Closed</th>
              <th className="pb-2 pr-3">Visits</th>
              <th className="pb-2 pr-3">Avg w/ doctor</th>
              <th className="pb-2">Avg turnaround</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr
                key={d.id}
                className={`border-t border-slate-100 dark:border-slate-700 whitespace-nowrap cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900 ${
                  selected?.id === d.id ? "bg-slate-50 dark:bg-slate-900" : ""
                }`}
                onClick={() => openDay(d)}
              >
                <td className="py-2 pr-3 font-semibold">{d.day_date}</td>
                <td className="py-2 pr-3">{formatClockTime(d.opened_at)}</td>
                <td className="py-2 pr-3">{formatClockTime(d.closed_at)}</td>
                <td className="py-2 pr-3 font-mono">{d.total_visits ?? "—"}</td>
                <td className="py-2 pr-3 font-mono">
                  {d.avg_with_doctor_ms ? formatMinutes(d.avg_with_doctor_ms) : "—"}
                </td>
                <td className="py-2 font-mono">
                  {d.avg_needs_cleanup_ms ? formatMinutes(d.avg_needs_cleanup_ms) : "—"}
                </td>
              </tr>
            ))}
            {days.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-slate-400">
                  No past days yet — Start day / End day at least once to build history.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="mt-5 border-t border-slate-100 dark:border-slate-700 pt-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
            <h4 className="font-bold">{selected.day_date} in detail</h4>
            <div className="flex gap-2">
              <button
                className="text-sm font-semibold border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 disabled:opacity-50"
                onClick={() => exportDay(selected)}
                disabled={exporting}
              >
                {exporting ? "Exporting…" : "Export CSV"}
              </button>
              <button
                className="text-sm font-semibold text-slate-500"
                onClick={() => {
                  setSelected(null);
                  setDetail(null);
                }}
              >
                Close
              </button>
            </div>
          </div>

          {loading && <p className="text-sm text-slate-500">Loading…</p>}

          {detail && (
            <>
              <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))" }}>
                {STAGE_ORDER.map((s) => {
                  const p = percentileFor(s);
                  return (
                    <div key={s} className="rounded-xl bg-slate-50 dark:bg-slate-900 p-3">
                      <div className="text-xs text-slate-500 mb-1">{STAGE_LABEL[s]}</div>
                      <div className="text-lg font-bold">{p ? formatMinutes(p.avg_ms) : "—"}</div>
                      <div className="text-xs text-slate-500">
                        {p ? `p50 ${formatMinutes(p.p50_ms)} · p90 ${formatMinutes(p.p90_ms)} · n=${p.n}` : "no data"}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid gap-5 sm:grid-cols-2 mb-2">
                <div>
                  <div className="text-xs text-slate-500 mb-2">Providers that day</div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500 text-xs">
                        <th className="pb-1">Name</th>
                        <th className="pb-1">Visits</th>
                        <th className="pb-1">Avg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.providers.map((p) => (
                        <tr key={p.provider_name} className="border-t border-slate-100 dark:border-slate-700">
                          <td className="py-1">{p.provider_name}</td>
                          <td className="py-1 font-mono">{p.visits}</td>
                          <td className="py-1 font-mono">{formatMinutes(p.avg_ms)}</td>
                        </tr>
                      ))}
                      {detail.providers.length === 0 && (
                        <tr>
                          <td colSpan={3} className="py-1 text-slate-400">
                            No visits logged
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-2">Nurses that day</div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500 text-xs">
                        <th className="pb-1">Name</th>
                        <th className="pb-1">Preps</th>
                        <th className="pb-1">Avg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.nurses.map((n) => (
                        <tr key={n.nurse_name} className="border-t border-slate-100 dark:border-slate-700">
                          <td className="py-1">{n.nurse_name}</td>
                          <td className="py-1 font-mono">{n.visits}</td>
                          <td className="py-1 font-mono">{formatMinutes(n.avg_ms)}</td>
                        </tr>
                      ))}
                      {detail.nurses.length === 0 && (
                        <tr>
                          <td colSpan={3} className="py-1 text-slate-400">
                            No preps logged (or this day was before per-nurse tracking was added)
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="text-xs text-slate-500 mb-2 mt-3">Room utilization that day</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 text-xs">
                    <th className="pb-1">Room</th>
                    <th className="pb-1">Vacant</th>
                    <th className="pb-1">Occupied</th>
                    <th className="pb-1">Needs cleanup</th>
                  </tr>
                </thead>
                <tbody>
                  {utilByRoom.map((r) => (
                    <tr key={r.room_name} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="py-1">{r.room_name}</td>
                      <td className="py-1 font-mono">{formatMinutes(r.Vacant)}</td>
                      <td className="py-1 font-mono">{formatMinutes(r.Occupied)}</td>
                      <td className="py-1 font-mono">{formatMinutes(r["Needs cleanup"])}</td>
                    </tr>
                  ))}
                  {utilByRoom.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-1 text-slate-400">
                        No room activity logged
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
