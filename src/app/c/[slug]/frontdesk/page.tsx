"use client";

import { useState } from "react";
import { useClinic } from "@/lib/clinicContext";
import { LiveTimer } from "@/components/LiveTimer";
import { Legend } from "@/components/Legend";
import { STAGE_LABEL } from "@/lib/constants";

export default function FrontDeskPage() {
  const { rooms, staff, today, actions, avgByStage, countByStage } = useClinic();
  const dayOpen = !!today?.opened_at && !today?.closed_at;
  const [lastAssigned, setLastAssigned] = useState<{ roomId: string; label: string | null } | null>(null);
  const [labelDraft, setLabelDraft] = useState<Record<string, string>>({});

  const vacant = rooms.filter((r) => r.stage === "vacant" && !r.contaminated);
  const busy = rooms.filter((r) => !(r.stage === "vacant" && !r.contaminated));
  const nurses = staff.filter((s) => s.role === "nurse");
  const doctors = staff.filter((s) => s.role === "doctor");

  async function checkIn(roomId: string) {
    const label = (labelDraft[roomId] ?? "").trim() || null;
    const res = await actions.assignPatient(roomId, label);
    if (res.ok && res.ticket) {
      setLastAssigned({ roomId, label });
      setLabelDraft((d) => ({ ...d, [roomId]: "" }));
    }
  }

  const lastRoom = lastAssigned ? rooms.find((r) => r.id === lastAssigned.roomId) : null;

  return (
    <div>
      {lastRoom && (
        <div className="card p-4 mb-5 bg-emerald-50 dark:bg-emerald-950 border-emerald-500 flex items-center justify-between gap-3 flex-wrap">
          <span className="font-semibold text-emerald-700 dark:text-emerald-300">
            Tell the patient: {lastRoom.name}, {lastRoom.side === "left" ? "Left" : "Right"} side
            {lastRoom.patient_label ? ` (${lastRoom.patient_label})` : ""}
          </span>
          <button className="text-emerald-700 dark:text-emerald-300 font-semibold" onClick={() => setLastAssigned(null)}>
            Got it
          </button>
        </div>
      )}

      <Legend />

      <div className="text-xs text-slate-500 mb-2">Vacant rooms. Enter initials, then check in the next patient.</div>
      <div className="grid gap-3 mb-8" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
        {vacant.map((r) => {
          return (
            <div key={r.id} className="card p-4 border-l-4 border-emerald-500">
              <div className="font-bold text-sm mb-0.5">{r.name}</div>
              <div className="text-xs text-slate-500 mb-3">
                {r.side === "left" ? "Left" : "Right"} side &middot; Vacant
              </div>
              <input
                className="w-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-lg px-2.5 py-1.5 text-sm mb-2"
                placeholder="Initials (e.g. JS)"
                value={labelDraft[r.id] ?? ""}
                onChange={(e) => setLabelDraft((d) => ({ ...d, [r.id]: e.target.value }))}
              />
              <button
                className="w-full bg-emerald-600 text-white font-bold py-2.5 rounded-lg"
                onClick={() => checkIn(r.id)}
              >
                Check in next patient
              </button>
            </div>
          );
        })}
        {vacant.length === 0 && <div className="text-slate-500 text-sm">No vacant rooms right now.</div>}
      </div>

      <div className="card p-5 mb-6">
        <h3 className="font-bold mb-3">Rest of the floor</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 text-xs">
              <th className="pb-2">Room</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Patient</th>
              <th className="pb-2">Time in step</th>
            </tr>
          </thead>
          <tbody>
            {busy.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700">
                <td className="py-2">{r.name}</td>
                <td className="py-2">{r.contaminated ? "Contamination lockout" : STAGE_LABEL[r.stage]}</td>
                <td className="py-2">
                  <input
                    className="border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-md text-sm px-2 py-1 w-28"
                    defaultValue={r.patient_label ?? ""}
                    placeholder="—"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (r.patient_label ?? "")) actions.setPatientLabel(r.id, v || null);
                    }}
                  />
                </td>
                <td className="py-2">
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-5">
        <h3 className="font-bold mb-1">Today&apos;s staffing</h3>
        <p className="text-sm text-slate-500 mb-3">
          Who&apos;s covering which room. Drives the color on the board. Leave a room as &quot;Any nurse&quot; or
          &quot;Any provider&quot; if you do not want to name someone specific.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 text-xs">
              <th className="pb-2">Room</th>
              <th className="pb-2">Nurse</th>
              <th className="pb-2">Doctor</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700">
                <td className="py-2">{r.name}</td>
                <td className="py-2">
                  <select
                    className="border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-md text-sm px-2 py-1"
                    value={r.assigned_nurse_id ?? ""}
                    onChange={(e) => actions.setStaffing(r.id, e.target.value || null, r.assigned_doctor_id)}
                  >
                    <option value="">Any nurse</option>
                    {nurses.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2">
                  <select
                    className="border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-md text-sm px-2 py-1"
                    value={r.assigned_doctor_id ?? ""}
                    onChange={(e) => actions.setStaffing(r.id, r.assigned_nurse_id, e.target.value || null)}
                  >
                    <option value="">Any provider</option>
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
