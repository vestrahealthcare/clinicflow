"use client";

import { useState } from "react";
import { PeriodDetailPanel } from "./PeriodDetailPanel";

interface Props {
  clinicId: string;
  roomNameById: Record<string, string>;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function MonthHistoryPanel({ clinicId, roomNameById }: Props) {
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  const label = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  function shift(months: number) {
    setMonthStart((prev) => new Date(prev.getFullYear(), prev.getMonth() + months, 1));
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="font-bold">{label}</h3>
        <div className="flex gap-2">
          <button className="text-sm font-semibold border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5" onClick={() => shift(-1)}>
            ← Prev month
          </button>
          <button className="text-sm font-semibold border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5" onClick={() => shift(1)}>
            Next month →
          </button>
        </div>
      </div>
      <PeriodDetailPanel
        clinicId={clinicId}
        since={monthStart.toISOString()}
        until={monthEnd.toISOString()}
        rangeLabel={label}
        roomNameById={roomNameById}
        csvFilename={`clinicflow_${monthStart.toISOString().slice(0, 7)}.csv`}
      />
    </div>
  );
}
