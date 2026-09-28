"use client";

import { useState } from "react";
import { PeriodDetailPanel } from "./PeriodDetailPanel";

interface Props {
  clinicId: string;
  roomNameById: Record<string, string>;
}

function mondayOf(d: Date): Date {
  const copy = new Date(d);
  const dow = copy.getDay();
  const diff = (dow === 0 ? -6 : 1) - dow;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function WeekHistoryPanel({ clinicId, roomNameById }: Props) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndInclusive = new Date(weekEnd.getTime() - 86400000);

  const label = `${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${weekEndInclusive.toLocaleDateString(
    undefined,
    { month: "short", day: "numeric", year: "numeric" }
  )}`;

  function shift(days: number) {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + days);
      return next;
    });
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="font-bold">Week of {label}</h3>
        <div className="flex gap-2">
          <button className="text-sm font-semibold border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5" onClick={() => shift(-7)}>
            ← Prev week
          </button>
          <button className="text-sm font-semibold border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5" onClick={() => shift(7)}>
            Next week →
          </button>
        </div>
      </div>
      <PeriodDetailPanel
        clinicId={clinicId}
        since={weekStart.toISOString()}
        until={weekEnd.toISOString()}
        rangeLabel={`the week of ${label}`}
        roomNameById={roomNameById}
        csvFilename={`clinicflow_week_${weekStart.toISOString().slice(0, 10)}.csv`}
      />
    </div>
  );
}
