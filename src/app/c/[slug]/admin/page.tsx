"use client";

import { useMemo, useState } from "react";
import { useClinic } from "@/lib/clinicContext";
import { LiveTimer } from "@/components/LiveTimer";
import { Legend } from "@/components/Legend";
import { StaffRoster } from "@/components/StaffRoster";
import { DayHistoryPanel } from "@/components/admin/DayHistoryPanel";
import { AllTimePanel } from "@/components/admin/AllTimePanel";
import { STAGE_LABEL, STAGE_ORDER, THRESH_MIN, SCHEDULED_DAY_START, SCHEDULED_DAY_END } from "@/lib/constants";
import { formatMinutes, isOverdue, computeDoctorIdleTime, formatClockTime, formatSqlTime } from "@/lib/util";
import { Stage } from "@/lib/types";

type AdminTab = "live" | "days" | "alltime";

export default function AdminPage() {
  const { clinic, rooms, staff, history, today, pastDays, avgByStage, countByStage, actions } = useClinic();
  const [tab, setTab] = useState<AdminTab>("live");
  const roomNameById = useMemo(() => Object.fromEntries(rooms.map((r) => [r.id, r.name])), [rooms]);

  const roomAvg = (roomId: string, stage: Stage) => {
    const items = history.filter((h) => h.room_id === roomId && h.stage === stage);
    if (!items.length) return null;
    return items.reduce((a, h) => a + h.duration_ms, 0) / items.length;
  };
  const roomVisits = (roomId: string) => history.filter((h) => h.room_id === roomId && h.stage === "needs_cleanup").length;

  const idleByProvider = useMemo(() => computeDoctorIdleTime(history), [history]);

  const overdueCount = rooms.filter(isOverdue).length;
  const lockoutCount = rooms.filter((r) => r.contaminated).length;
  const totalVisits = history.filter((h) => h.stage === "needs_cleanup").length;
  const maxAvg = Math.max(...STAGE_ORDER.map((s) => avgByStage[s] ?? 0), 1);
  const bottleneck = STAGE_ORDER.reduce<Stage | null>(
    (best, s) => (!best || (avgByStage[s] ?? 0) > (avgByStage[best] ?? 0) ? s : best),
    null
  );

  if (!clinic) return null;

  const dayOpen = !!today?.opened_at && !today?.closed_at;
  const dayNotStarted = !today?.opened_at;
  const dayClosed = !!today?.opened_at && !!today?.closed_at;

  return (
    <div>
      <div className="card p-4 mb-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-bold">Day control</h3>
          <p className="text-sm text-slate-500">
            Scheduled {formatSqlTime(SCHEDULED_DAY_START)} – {formatSqlTime(SCHEDULED_DAY_END)}.{" "}
            {dayNotStarted && "Day not started yet."}
            {dayOpen && `Opened at ${formatClockTime(today!.opened_at)}.`}
            {dayClosed && `Opened ${formatClockTime(today!.opened_at)}, closed ${formatClockTime(today!.closed_at)}.`}
          </p>
        </div>
        {dayNotStarted && (
          <button className="bg-emerald-600 text-white font-bold px-4 py-2.5 rounded-lg" onClick={() => actions.startDay()}>
            Start day
          </button>
        )}
        {dayOpen && (
          <button className="bg-red-700 text-white font-bold px-4 py-2.5 rounded-lg" onClick={() => actions.endDay()}>
            End day
          </button>
        )}
        {dayClosed && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-500">Day closed</span>
            <button className="bg-emerald-600 text-white font-bold px-4 py-2.5 rounded-lg" onClick={() => actions.startDay()}>
              Restart day
            </button>
          </div>
        )}
      </div>

      <div className="card p-4 mb-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-bold">Clinic setup</h3>
          <p className="text-sm text-slate-500">Rooms currently in service</p>
        </div>
        <select
          className="border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-lg text-sm px-3 py-2"
          value={clinic.room_count}
          onChange={(e) => actions.setRoomCount(parseInt(e.target.value, 10))}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} rooms
            </option>
          ))}
        </select>
      </div>

      <StaffRoster staff={staff} onAdd={actions.addStaff} onRename={actions.renameStaff} onRemove={actions.removeStaff} />

      <div className="flex bg-slate-100 dark:bg-slate-900 rounded-lg p-1 gap-0.5 mb-5 w-fit">
        {(
          [
            ["live", "Live"],
            ["days", "Day history"],
            ["alltime", "All-time"]
          ] as [AdminTab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            className={`px-3 py-2 rounded-md text-sm font-semibold ${
              tab === key ? "bg-white dark:bg-slate-700 shadow-sm" : "text-slate-500"
            }`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "live" && (
        <>
          <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px,1fr))" }}>
            {STAGE_ORDER.map((s) => (
              <div key={s} className="card p-4">
                <div className="text-xs text-slate-500 mb-1">Avg {STAGE_LABEL[s].toLowerCase()}</div>
                <div className="text-2xl font-bold">{formatMinutes(avgByStage[s] ?? 0)}</div>
              </div>
            ))}
            <div className="card p-4">
              <div className="text-xs text-slate-500 mb-1">Rooms overdue now</div>
              <div className={`text-2xl font-bold ${overdueCount > 0 ? "text-red-600" : ""}`}>
                {overdueCount} of {rooms.length}
              </div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-slate-500 mb-1">Contamination lockouts now</div>
              <div className={`text-2xl font-bold ${lockoutCount > 0 ? "text-red-600" : ""}`}>{lockoutCount}</div>
            </div>
          </div>

          <div className="card p-5 mb-6">
            <h3 className="font-bold mb-4">Average minutes per step, trailing 30 days</h3>
            {STAGE_ORDER.map((s) => {
              const pct = Math.max(4, ((avgByStage[s] ?? 0) / maxAvg) * 100);
              return (
                <div key={s} className="flex items-center gap-3 mb-3">
                  <div className="w-36 text-sm text-slate-500 shrink-0">{STAGE_LABEL[s]}</div>
                  <div className="flex-1 bg-slate-100 dark:bg-slate-900 rounded-md h-6 relative overflow-hidden">
                    <div
                      className="h-full rounded-md flex items-center pl-2 text-xs font-semibold text-white"
                      style={{ width: `${pct}%`, backgroundColor: "#3568C4" }}
                    >
                      {formatMinutes(avgByStage[s] ?? 0)}
                    </div>
                  </div>
                </div>
              );
            })}
            <p className="text-sm text-slate-500 mt-2">
              Slowest step: {bottleneck ? STAGE_LABEL[bottleneck] : "—"}. {totalVisits} patient visits completed.
              Timers across the app turn yellow at 20% over these averages and red at 50% over, once a step has
              enough history to trust; new or low volume steps fall back to fixed minute thresholds.
            </p>
          </div>

          <div className="card p-5 mb-6">
            <h3 className="font-bold mb-1">Doctor idle time</h3>
            <p className="text-sm text-slate-500 mb-3">
              Actual gaps between a provider&apos;s visits, not an estimate. Counted only within the same day, so an
              overnight or weekend gap never counts as idle time. Rooms staffed as &quot;Any provider&quot; are not
              attributed to anyone here.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs">
                  <th className="pb-2">Provider</th>
                  <th className="pb-2">Visits</th>
                  <th className="pb-2">Idle time</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(idleByProvider).map(([name, v]) => (
                  <tr key={name} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="py-2">{name}</td>
                    <td className="py-2 font-mono">{v.visits}</td>
                    <td className="py-2 font-mono">{formatMinutes(v.idleMs)}</td>
                  </tr>
                ))}
                {Object.keys(idleByProvider).length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-2 text-slate-400">
                      No completed visits with a named provider yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card p-5">
            <h3 className="font-bold mb-1">Per room</h3>
            <Legend />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 text-xs whitespace-nowrap">
                    <th className="pb-2 pr-3">Room</th>
                    <th className="pb-2 pr-3">Current step</th>
                    <th className="pb-2 pr-3">Time in step</th>
                    <th className="pb-2 pr-3">Avg wait for nurse</th>
                    <th className="pb-2 pr-3">Avg prep</th>
                    <th className="pb-2 pr-3">Avg wait for doctor</th>
                    <th className="pb-2 pr-3">Avg w/ doctor</th>
                    <th className="pb-2 pr-3">Avg turnaround</th>
                    <th className="pb-2">Visits</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((r) => {
                    const over = isOverdue(r);
                    return (
                      <tr
                        key={r.id}
                        className={`border-t border-slate-100 dark:border-slate-700 whitespace-nowrap ${
                          over ? "text-red-600" : ""
                        }`}
                      >
                        <td className="py-2 pr-3">{r.name}</td>
                        <td className="py-2 pr-3">
                          {r.contaminated ? "Lockout" : STAGE_LABEL[r.stage] + (over ? " (overdue)" : "")}
                        </td>
                        <td className="py-2 pr-3 font-mono">
                          {r.contaminated ? (
                            "—"
                          ) : (
                            <LiveTimer
                              startedAt={r.stage_started_at}
                              paused={!dayOpen}
                              stage={r.stage}
                              avgByStage={avgByStage}
                              countByStage={countByStage}
                            />
                          )}
                        </td>
                        <td className="py-2 pr-3 font-mono">
                          {roomAvg(r.id, "ready_for_nurse") ? formatMinutes(roomAvg(r.id, "ready_for_nurse")!) : "—"}
                        </td>
                        <td className="py-2 pr-3 font-mono">
                          {roomAvg(r.id, "prepping") ? formatMinutes(roomAvg(r.id, "prepping")!) : "—"}
                        </td>
                        <td className="py-2 pr-3 font-mono">
                          {roomAvg(r.id, "ready_for_doctor") ? formatMinutes(roomAvg(r.id, "ready_for_doctor")!) : "—"}
                        </td>
                        <td className="py-2 pr-3 font-mono">
                          {roomAvg(r.id, "with_doctor") ? formatMinutes(roomAvg(r.id, "with_doctor")!) : "—"}
                        </td>
                        <td className="py-2 pr-3 font-mono">
                          {roomAvg(r.id, "needs_cleanup") ? formatMinutes(roomAvg(r.id, "needs_cleanup")!) : "—"}
                        </td>
                        <td className="py-2 font-mono">{roomVisits(r.id)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Fallback overdue thresholds, used only until a step has enough history: ready for nurse over{" "}
              {THRESH_MIN.ready_for_nurse}m, prepping over {THRESH_MIN.prepping}m, wait for doctor over{" "}
              {THRESH_MIN.ready_for_doctor}m, with doctor over {THRESH_MIN.with_doctor}m, turnaround over{" "}
              {THRESH_MIN.needs_cleanup}m.
            </p>
          </div>
        </>
      )}

      {tab === "days" && <DayHistoryPanel clinicId={clinic.id} days={pastDays} roomNameById={roomNameById} />}

      {tab === "alltime" && <AllTimePanel clinicId={clinic.id} allDays={pastDays} rooms={rooms} />}
    </div>
  );
}
