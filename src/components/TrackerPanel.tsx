"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useClinic } from "@/lib/clinicContext";
import { SWAB_KEYS } from "@/lib/constants";
import { TrackerData, TrackerRow } from "@/lib/types";
import { clinicToday, formatMinutes } from "@/lib/util";
import {
  addDays,
  avgStepMs,
  providerKey,
  rowsFor,
  StepKey,
  totals,
  UNASSIGNED,
  WindowKey,
  WINDOWS,
  WINDOW_LABEL
} from "@/lib/tracker";

const STEPS: { key: StepKey; label: string }[] = [
  { key: "rfn", label: "Ready for nurse" },
  { key: "prep", label: "Prepping" },
  { key: "rfd", label: "Ready for doctor" },
  { key: "wd", label: "Doctor in room" },
  { key: "sh", label: "Shots" },
  { key: "ot", label: "Other" },
  { key: "d2d", label: "Door to door (check in to check out)" }
];

function perDay(total: number, days: number): string {
  if (days <= 0) return "—";
  return (total / days).toFixed(1);
}

function prettyDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
}

const th = "pb-2 pr-3 font-semibold";
const tdNum = "py-2 pr-3 font-mono whitespace-nowrap align-top";

export function TrackerPanel() {
  const { clinic, staff, actions } = useClinic();
  const today = clinicToday(clinic?.timezone);
  const [day, setDay] = useState(today);
  const [data, setData] = useState<TrackerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const resetAt = clinic?.averages_reset_at ?? null;

  const load = useCallback(async () => {
    const res = await actions.getTrackerData(day);
    if (res.error) setError(res.error);
    else {
      setError(null);
      setData(res.data);
    }
    setLoading(false);
  }, [actions, day]);

  // Reload when the date changes, the 30 day reset or erase happens, and once a minute.
  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, resetAt, clinic?.id]);

  const rows: TrackerRow[] = useMemo(() => data?.rows ?? [], [data]);
  const byWindow = useMemo(
    () => Object.fromEntries(WINDOWS.map((w) => [w, rowsFor(rows, day, w)])) as Record<WindowKey, TrackerRow[]>,
    [rows, day]
  );
  const tot = useMemo(
    () => Object.fromEntries(WINDOWS.map((w) => [w, totals(byWindow[w])])) as Record<WindowKey, ReturnType<typeof totals>>,
    [byWindow]
  );

  // Provider list: staff order first, then any other name found in the data, Unassigned last.
  const providerNames = useMemo(() => {
    const inData = new Set(rows.map(providerKey));
    const ordered = staff.filter((s) => s.role === "doctor" && inData.has(s.name)).map((s) => s.name);
    const rest = [...inData].filter((n) => n !== UNASSIGNED && !ordered.includes(n)).sort();
    return [...ordered, ...rest, ...(inData.has(UNASSIGNED) ? [UNASSIGNED] : [])];
  }, [rows, staff]);

  const countCell = (w: WindowKey, count: number, days: number) =>
    w === "day" ? (
      <span>{count}</span>
    ) : (
      <span>
        {count} <span className="text-xs text-slate-400">({perDay(count, days)}/day)</span>
      </span>
    );

  const resetNote = resetAt
    ? new Date(resetAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div>
      <div className="card p-4 mb-5 flex flex-wrap items-center gap-3">
        <label htmlFor="trackerDay" className="font-semibold text-sm">
          Date
        </label>
        <button
          className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-semibold"
          onClick={() => setDay(addDays(day, -1))}
          aria-label="Previous day"
        >
          ←
        </button>
        <input
          id="trackerDay"
          type="date"
          className="border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2 text-sm"
          value={day}
          max={today}
          onChange={(e) => e.target.value && setDay(e.target.value > today ? today : e.target.value)}
        />
        <button
          className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-semibold disabled:opacity-30"
          onClick={() => setDay(addDays(day, 1))}
          disabled={day >= today}
          aria-label="Next day"
        >
          →
        </button>
        {day !== today && (
          <button className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold" onClick={() => setDay(today)}>
            Today
          </button>
        )}
        <span className="text-sm text-slate-500 basis-full sm:basis-auto">{prettyDay(day)}</span>
      </div>

      {error && (
        <div className="card p-4 mb-5 border-red-500 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm font-semibold">
          {error}
        </div>
      )}
      {loading && !data && !error && <div className="text-slate-500 text-sm mb-4">Loading the Tracker…</div>}

      {data && (
        <>
          <div className="card p-5 mb-6">
            <h3 className="font-bold mb-1">Provider visits</h3>
            <p className="text-sm text-slate-500 mb-3">
              Patients checked out, by provider. The week, month and all time columns show the total and the average
              per clinic day that had visits.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 text-xs whitespace-nowrap">
                    <th className={th}>Provider</th>
                    {WINDOWS.map((w) => (
                      <th key={w} className={th}>
                        {WINDOW_LABEL[w]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-slate-100 dark:border-slate-700 font-semibold">
                    <td className="py-2 pr-3">All visits</td>
                    {WINDOWS.map((w) => (
                      <td key={w} className={tdNum}>
                        {countCell(w, tot[w].visits, tot[w].days)}
                      </td>
                    ))}
                  </tr>
                  {providerNames.map((name) => (
                    <tr key={name} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="py-2 pr-3">
                        {name}
                        {name === UNASSIGNED && <span className="text-xs text-slate-400"> (Any provider)</span>}
                      </td>
                      {WINDOWS.map((w) => {
                        const count = byWindow[w].filter((r) => providerKey(r) === name).reduce((a, r) => a + r.visits, 0);
                        return (
                          <td key={w} className={tdNum}>
                            {countCell(w, count, tot[w].days)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {providerNames.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-2 text-slate-400">
                        No completed visits yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card p-5 mb-6">
            <h3 className="font-bold mb-1">Step times and door to door time</h3>
            <p className="text-sm text-slate-500 mb-3">
              Average minutes per visit. Door to door runs from check in to check out. A single step over 3 hours is
              left out of the averages (the visit still counts above).
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 text-xs whitespace-nowrap">
                    <th className={th}>Step</th>
                    {WINDOWS.map((w) => (
                      <th key={w} className={th}>
                        {WINDOW_LABEL[w]}
                        {w === "d30" && resetNote ? <span className="font-normal"> (since {resetNote})</span> : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {STEPS.map((st) => (
                    <tr
                      key={st.key}
                      className={`border-t border-slate-100 dark:border-slate-700 ${st.key === "d2d" ? "font-semibold" : ""}`}
                    >
                      <td className="py-2 pr-3">{st.label}</td>
                      {WINDOWS.map((w) => {
                        const { avgMs, n } = avgStepMs(byWindow[w], st.key);
                        return (
                          <td key={w} className={tdNum}>
                            {avgMs === null ? "—" : formatMinutes(avgMs)}
                            {avgMs !== null && <span className="block text-xs text-slate-400 font-sans">{n} visits</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card p-5 mb-6">
            <h3 className="font-bold mb-1">Swabs and cultures</h3>
            <p className="text-sm text-slate-500 mb-3">
              Counted at check out, only if the test was still marked on the room. Send out lab is not counted.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 text-xs whitespace-nowrap">
                    <th className={th}>Type</th>
                    {WINDOWS.map((w) => (
                      <th key={w} className={th}>
                        {WINDOW_LABEL[w]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SWAB_KEYS.map((sw) => (
                    <tr key={sw.key} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="py-2 pr-3">{sw.label}</td>
                      {WINDOWS.map((w) => {
                        const count = byWindow[w].reduce((a, r) => a + Number(r[sw.col as keyof TrackerRow] ?? 0), 0);
                        return (
                          <td key={w} className={tdNum}>
                            {countCell(w, count, tot[w].liveDays)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-slate-500 mb-6">
            Provider counts include visits from before the Tracker was added. Step times, door to door time and swab
            counts start on the day update 4 was installed, so earlier days show a dash there.
            {resetNote ? ` The Last 30 days columns restarted on ${resetNote}.` : ""}
          </p>
        </>
      )}
    </div>
  );
}
