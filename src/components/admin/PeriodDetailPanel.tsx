"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { StaffStatRow, StagePercentileRow, RoomUtilizationRow, Stage } from "@/lib/types";
import { STAGE_LABEL, STAGE_ORDER } from "@/lib/constants";
import { formatMinutes, toCsv, downloadCsv, utilizationBucket } from "@/lib/util";
import { ResetPeriodButton } from "./ResetPeriodButton";

interface Props {
  clinicId: string;
  since: string | null;
  until: string | null;
  rangeLabel: string;
  roomNameById: Record<string, string>;
  csvFilename: string;
  onReset?: () => void;
}

/** Shared breakdown used by Day/Week/Month/All-time: percentiles, provider &
 *  nurse tables, room utilization, CSV export, and the reset control. Bounds
 *  of null,null mean "unbounded" (all-time). */
export function PeriodDetailPanel({ clinicId, since, until, rangeLabel, roomNameById, csvFilename, onReset }: Props) {
  const [percentiles, setPercentiles] = useState<StagePercentileRow[]>([]);
  const [providers, setProviders] = useState<StaffStatRow[]>([]);
  const [nurses, setNurses] = useState<StaffStatRow[]>([]);
  const [utilization, setUtilization] = useState<RoomUtilizationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [{ data: p }, { data: pr }, { data: n }, { data: u }] = await Promise.all([
        supabase.rpc("get_stage_percentiles", { p_clinic_id: clinicId, p_since: since, p_until: until }),
        supabase.rpc("get_provider_stats", { p_clinic_id: clinicId, p_since: since, p_until: until }),
        supabase.rpc("get_nurse_stats", { p_clinic_id: clinicId, p_since: since, p_until: until }),
        supabase.rpc("get_room_utilization", { p_clinic_id: clinicId, p_since: since, p_until: until })
      ]);
      if (cancelled) return;
      setPercentiles((p as StagePercentileRow[]) ?? []);
      setProviders((pr as StaffStatRow[]) ?? []);
      setNurses((n as StaffStatRow[]) ?? []);
      setUtilization((u as RoomUtilizationRow[]) ?? []);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [clinicId, since, until]);

  function percentileFor(stage: Stage) {
    return percentiles.find((p) => p.stage === stage);
  }

  const utilByRoom = useMemo(() => {
    const map: Record<string, { room_name: string; Vacant: number; Occupied: number; "Needs cleanup": number }> = {};
    utilization.forEach((row) => {
      const bucket = utilizationBucket(row.stage);
      map[row.room_id] ||= { room_name: row.room_name, Vacant: 0, Occupied: 0, "Needs cleanup": 0 };
      map[row.room_id][bucket] += row.total_ms;
    });
    return Object.values(map);
  }, [utilization]);

  async function exportCsv() {
    setExporting(true);
    let query = supabase.from("room_history").select("*").eq("clinic_id", clinicId).order("ended_at");
    if (since) query = query.gte("ended_at", since);
    if (until) query = query.lt("ended_at", until);
    const { data } = await query;
    const rows = (data ?? []).map((h) => ({
      room: roomNameById[h.room_id] ?? h.room_id,
      stage: STAGE_LABEL[h.stage as Stage] ?? h.stage,
      minutes: (h.duration_ms / 60000).toFixed(1),
      provider: h.provider_name ?? "",
      nurse: h.nurse_name ?? "",
      ended_at: h.ended_at
    }));
    downloadCsv(csvFilename, toCsv(rows));
    setExporting(false);
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div>
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

      <div className="grid gap-5 sm:grid-cols-2 mb-5">
        <div>
          <div className="text-xs text-slate-500 mb-2">Providers</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 text-xs">
                <th className="pb-1">Name</th>
                <th className="pb-1">Visits</th>
                <th className="pb-1">Avg</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.provider_name} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="py-1">{p.provider_name}</td>
                  <td className="py-1 font-mono">{p.visits}</td>
                  <td className="py-1 font-mono">{formatMinutes(p.avg_ms)}</td>
                </tr>
              ))}
              {providers.length === 0 && (
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
          <div className="text-xs text-slate-500 mb-2">Nurses</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 text-xs">
                <th className="pb-1">Name</th>
                <th className="pb-1">Preps</th>
                <th className="pb-1">Avg</th>
              </tr>
            </thead>
            <tbody>
              {nurses.map((n) => (
                <tr key={n.nurse_name} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="py-1">{n.nurse_name}</td>
                  <td className="py-1 font-mono">{n.visits}</td>
                  <td className="py-1 font-mono">{formatMinutes(n.avg_ms)}</td>
                </tr>
              ))}
              {nurses.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-1 text-slate-400">
                    No preps logged
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-5">
        <div className="text-xs text-slate-500 mb-2">Room utilization</div>
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
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-2">
        <button
          className="text-sm font-semibold border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 disabled:opacity-50"
          onClick={exportCsv}
          disabled={exporting}
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      <ResetPeriodButton since={since} until={until} rangeLabel={rangeLabel} onDone={onReset} />
    </div>
  );
}
