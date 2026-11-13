"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClinic } from "@/lib/clinicContext";
import { NurseTrackerData, TrackerData } from "@/lib/types";
import { clinicToday, formatMinutes } from "@/lib/util";
import { avgStepMs, providerKey, rowsFor, StepKey, UNASSIGNED, WindowKey, WINDOWS, WINDOW_LABEL } from "@/lib/tracker";

const COLS: { key: StepKey; label: string }[] = [
  { key: "rfn", label: "Avg wait for nurse" },
  { key: "prep", label: "Avg prep" },
  { key: "rfd", label: "Avg wait for doctor" },
  { key: "wd", label: "Avg w/ doctor" },
  { key: "sh", label: "Avg shots" },
  { key: "ot", label: "Avg other" },
  { key: "d2d", label: "Avg door to door" }
];

const NOT_RECORDED = "No name picked";

/**
 * The same numbers as Per room, but by provider and by nurse or MA (nurses and MAs share one
 * list). Provider numbers come from the visit data the Tracker already keeps. Nurse and MA
 * numbers come from who tapped Start prep, counted from the day update 7 was installed.
 */
export function PerPersonPanel() {
  const { clinic, actions } = useClinic();
  const today = clinicToday(clinic?.timezone);
  const [win, setWin] = useState<WindowKey>("d30");
  const [prov, setProv] = useState<TrackerData | null>(null);
  const [nurse, setNurse] = useState<NurseTrackerData | null>(null);
  const [provErr, setProvErr] = useState<string | null>(null);
  const [nurseErr, setNurseErr] = useState<string | null>(null);

  // Keep the latest actions in a ref so a re-render never restarts the loading loop.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const clinicId = clinic?.id;

  const load = useCallback(async () => {
    if (!clinicId) return;
    const a = actionsRef.current;
    const [p, n] = await Promise.all([a.getTrackerData(today), a.getNurseTrackerData(today)]);
    setProv(p.data);
    setProvErr(p.error);
    setNurse(n.data);
    setNurseErr(n.error);
  }, [clinicId, today]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const provRows = useMemo(() => (prov ? rowsFor(prov.rows, today, win) : []), [prov, today, win]);
  const provNames = useMemo(() => {
    const names = Array.from(new Set(provRows.map(providerKey)));
    return names.sort((a, b) => (a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b)));
  }, [provRows]);

  const nurseRows = useMemo(() => (nurse ? rowsFor(nurse.rows, today, win) : []), [nurse, today, win]);
  const nurseNames = useMemo(() => {
    const names = Array.from(new Set(nurseRows.map((r) => r.nurse_name || NOT_RECORDED)));
    return names.sort((a, b) => (a === NOT_RECORDED ? 1 : b === NOT_RECORDED ? -1 : a.localeCompare(b)));
  }, [nurseRows]);

  const th = "pb-2 pr-3";

  return (
    <>
      <div className="card p-5 mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h3 className="font-bold">Per provider</h3>
          <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1 text-xs" role="tablist">
            {WINDOWS.map((w) => (
              <button
                key={w}
                role="tab"
                aria-selected={win === w}
                className={`px-2.5 py-1 rounded-md font-semibold ${
                  win === w ? "bg-white dark:bg-slate-700 shadow-sm" : "text-slate-500"
                }`}
                onClick={() => setWin(w)}
              >
                {w === "day" ? "Today" : WINDOW_LABEL[w]}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-slate-500 mb-3">
          Visits and average minutes per visit for each provider. &quot;Last 30 days&quot; restarts at the 30 day
          reset. Step times only include visits recorded since update 4.
        </p>
        {provErr && <div className="text-sm text-red-600 mb-2">{provErr}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 text-xs whitespace-nowrap">
                <th className={th}>Provider</th>
                <th className={th}>Visits</th>
                {COLS.map((c) => (
                  <th key={c.key} className={th}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {provNames.map((name) => {
                const rows = provRows.filter((r) => providerKey(r) === name);
                return (
                  <tr key={name} className="border-t border-slate-100 dark:border-slate-700 whitespace-nowrap">
                    <td className="py-2 pr-3">
                      {name}
                      {name === UNASSIGNED && <span className="text-xs text-slate-400"> (Any provider)</span>}
                    </td>
                    <td className="py-2 pr-3 font-mono">{rows.reduce((a, r) => a + r.visits, 0)}</td>
                    {COLS.map((c) => {
                      const { avgMs } = avgStepMs(rows, c.key);
                      return (
                        <td key={c.key} className="py-2 pr-3 font-mono">
                          {avgMs === null ? "—" : formatMinutes(avgMs)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {provNames.length === 0 && (
                <tr>
                  <td colSpan={COLS.length + 2} className="py-2 text-slate-400">
                    No completed visits in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5 mt-6">
        <h3 className="font-bold mb-1">Per nurse and MA</h3>
        <p className="text-sm text-slate-500 mb-3">
          Patients prepped and average prep time (Start prep to Prep complete) for the nurse or MA who tapped Start
          prep. Uses the same time window as the table above. Counts begin the day update 7 was installed, because
          earlier visits did not record who did the prep. If nobody picked their name with &quot;Who are you?&quot;
          the prep shows under &quot;{NOT_RECORDED}&quot;.
        </p>
        {nurseErr && <div className="text-sm text-red-600 mb-2">{nurseErr}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 text-xs whitespace-nowrap">
                <th className={th}>Nurse or MA</th>
                <th className={th}>Patients prepped</th>
                <th className={th}>Avg prep</th>
              </tr>
            </thead>
            <tbody>
              {nurseNames.map((name) => {
                const rows = nurseRows.filter((r) => (r.nurse_name || NOT_RECORDED) === name);
                const preps = rows.reduce((a, r) => a + r.preps, 0);
                const sum = rows.reduce((a, r) => a + Number(r.prep_sum ?? 0), 0);
                const n = rows.reduce((a, r) => a + r.prep_n, 0);
                return (
                  <tr key={name} className="border-t border-slate-100 dark:border-slate-700 whitespace-nowrap">
                    <td className="py-2 pr-3">{name}</td>
                    <td className="py-2 pr-3 font-mono">{preps}</td>
                    <td className="py-2 pr-3 font-mono">{n > 0 ? formatMinutes(sum / n) : "—"}</td>
                  </tr>
                );
              })}
              {nurseNames.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-2 text-slate-400">
                    No preps recorded in this window yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
