"use client";

import { useState } from "react";
import { ClinicDay } from "@/lib/types";
import { formatClockTime, formatMinutes } from "@/lib/util";
import { PeriodDetailPanel } from "./PeriodDetailPanel";

interface Props {
  clinicId: string;
  days: ClinicDay[];
  roomNameById: Record<string, string>;
}

function dayBounds(day: ClinicDay): { since: string; until: string } {
  return {
    since: day.opened_at ?? `${day.day_date}T00:00:00`,
    until: day.closed_at ?? `${day.day_date}T23:59:59`
  };
}

export function DayHistoryPanel({ clinicId, days, roomNameById }: Props) {
  const [selected, setSelected] = useState<ClinicDay | null>(null);

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
                onClick={() => setSelected(d)}
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
            <button className="text-sm font-semibold text-slate-500" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <PeriodDetailPanel
            clinicId={clinicId}
            since={dayBounds(selected).since}
            until={dayBounds(selected).until}
            rangeLabel={selected.day_date}
            roomNameById={roomNameById}
            csvFilename={`clinicflow_${selected.day_date}.csv`}
            onReset={() => setSelected(null)}
          />
        </div>
      )}
    </div>
  );
}
