"use client";

import { useMemo, useState } from "react";
import { useClinic } from "@/lib/clinicContext";
import { LiveTimer } from "@/components/LiveTimer";
import { StaffRoster } from "@/components/StaffRoster";
import { TrackerPanel } from "@/components/TrackerPanel";
import { TimerColorsCard } from "@/components/TimerColorsCard";
import { STAGE_LABEL } from "@/lib/constants";
import { formatMinutes, isOverdue, computeDoctorIdleTime } from "@/lib/util";
import { Stage } from "@/lib/types";

// Start of day: rooms back to vacant, Checking out list cleared, ticket numbers restart.
function ResetDayCard({ onReset }: { onReset: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <div className="card p-5 mb-6">
      <h3 className="font-bold mb-1">Reset for the day</h3>
      <p className="text-sm text-slate-500 mb-3">
        Sends every room back to Vacant, clears initials, requests and messages, empties the Checking out list and
        restarts ticket numbers at A-01. Timing history, lab samples and open Call with results tasks are kept. A room
        in Contamination lockout stays locked until it is cleared.
      </p>
      {asking ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-amber-600">Reset every room now?</span>
          <button
            className="px-4 py-2.5 rounded-xl bg-red-700 text-white font-semibold text-sm"
            onClick={async () => {
              await onReset();
              setAsking(false);
              setDone(true);
            }}
          >
            Yes, reset the day
          </button>
          <button className="px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-sm" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button
            className="px-4 py-2.5 rounded-xl border border-red-700 text-red-700 dark:text-red-300 font-semibold text-sm"
            onClick={() => {
              setDone(false);
              setAsking(true);
            }}
          >
            Reset for the day
          </button>
          {done && <span className="text-sm text-emerald-600 font-semibold">Done. All rooms are vacant.</span>}
        </div>
      )}
    </div>
  );
}

// Tracker data: restart the Tracker's 30 day columns (old data kept), or erase everything.
function AveragesCard({
  resetAt,
  onReset,
  onErase
}: {
  resetAt: string | null | undefined;
  onReset: () => Promise<void>;
  onErase: () => Promise<void>;
}) {
  const [askReset, setAskReset] = useState(false);
  const [askErase, setAskErase] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const since = resetAt
    ? new Date(resetAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;
  return (
    <div className="card p-5 mb-6">
      <h3 className="font-bold mb-1">Tracker data</h3>
      <p className="text-sm text-slate-500 mb-3">
        The Tracker tab shows That day, Last 7 days, Last 30 days and All time.
        {since ? ` The Last 30 days columns currently count visits since ${since}.` : ""}
      </p>

      <div className="mb-4">
        <div className="text-sm font-semibold mb-1">Reset 30 day averages</div>
        <p className="text-sm text-slate-500 mb-2">
          Restarts every Last 30 days column in the Tracker from this moment, so only new visits count there. Nothing is
          deleted. That day, Last 7 days and All time are not affected.
        </p>
        {askReset ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-amber-600">Start the averages fresh now?</span>
            <button
              className="px-4 py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm"
              onClick={async () => {
                await onReset();
                setAskReset(false);
                setMessage("Done. The Last 30 days columns now count visits from this moment.");
              }}
            >
              Yes, reset averages
            </button>
            <button
              className="px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-sm"
              onClick={() => setAskReset(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="px-4 py-2.5 rounded-xl border border-blue-600 text-blue-700 dark:text-blue-300 font-semibold text-sm"
            onClick={() => {
              setMessage(null);
              setAskReset(true);
            }}
          >
            Reset 30 day averages
          </button>
        )}
      </div>

      <div className="pt-4 border-t border-slate-100 dark:border-slate-700">
        <div className="text-sm font-semibold mb-1">Erase all timing history</div>
        <p className="text-sm text-slate-500 mb-2">
          Permanently deletes every saved step time and all Tracker data (visits per provider, swab counts, door to door
          times and provider idle time). Everything starts over from zero. This cannot be undone.
        </p>
        {askErase ? (
          <div className="rounded-xl border-2 border-red-600 bg-red-50 dark:bg-red-950 p-4">
            <div className="font-bold text-red-700 dark:text-red-300 mb-1">Warning: this cannot be undone</div>
            <div className="text-sm text-red-700 dark:text-red-300 mb-3">
              You must verify with your administrator before proceeding. All timing history and all Tracker data will be erased for good.
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="px-4 py-2.5 rounded-xl bg-red-700 text-white font-semibold text-sm"
                onClick={async () => {
                  await onErase();
                  setAskErase(false);
                  setMessage("All timing history and Tracker data were erased.");
                }}
              >
                Yes, erase everything
              </button>
              <button
                className="px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-sm"
                onClick={() => setAskErase(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="px-4 py-2.5 rounded-xl border border-red-700 text-red-700 dark:text-red-300 font-semibold text-sm"
            onClick={() => {
              setMessage(null);
              setAskErase(true);
            }}
          >
            Erase all timing history
          </button>
        )}
      </div>
      {message && <div className="mt-3 text-sm text-emerald-600 font-semibold">{message}</div>}
    </div>
  );
}

// One text box per room. Saves when you click away, so typing never fights the live updates.
function DirectionsRow({
  name,
  value,
  onSave
}: {
  name: string;
  value: string | null;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value ?? "";
  return (
    <tr className="border-t border-slate-100 dark:border-slate-700">
      <td className="py-2 pr-3 whitespace-nowrap">{name}</td>
      <td className="py-2">
        <input
          className="w-full border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1.5 text-sm bg-slate-50 dark:bg-slate-900"
          placeholder="e.g. First door on the right"
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== null && draft.trim() !== (value ?? "")) onSave(draft);
            setDraft(null);
          }}
        />
      </td>
    </tr>
  );
}

export default function AdminPage() {
  const { clinic, rooms, staff, history, timerTargets, actions } = useClinic();
  const [tab, setTab] = useState<"setup" | "tracker">("setup");

  const roomAvg = (roomId: string, stage: Stage) => {
    const items = history.filter((h) => h.room_id === roomId && h.stage === stage);
    if (!items.length) return null;
    return items.reduce((a, h) => a + h.duration_ms, 0) / items.length;
  };
  // Every visit passes through "Ready for nurse" exactly once, so that is the visit count.
  const roomVisits = (roomId: string) => history.filter((h) => h.room_id === roomId && h.stage === "ready_for_nurse").length;

  const idleByProvider = useMemo(() => computeDoctorIdleTime(history), [history]);

  const overdueCount = rooms.filter((r) => isOverdue(r, timerTargets)).length;
  const lockoutCount = rooms.filter((r) => r.contaminated).length;

  if (!clinic) return null;

  return (
    <div>
      <div className="inline-flex bg-slate-200 dark:bg-slate-800 rounded-lg p-1 gap-0.5 mb-5" role="tablist">
        {(
          [
            ["setup", "Setup"],
            ["tracker", "Tracker"]
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`px-5 py-2 rounded-md text-sm font-semibold ${
              tab === key ? "bg-white dark:bg-slate-700 shadow-sm" : "text-slate-500"
            }`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "setup" ? (
        <>
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

          <StaffRoster
            staff={staff}
            onAdd={actions.addStaff}
            onRename={actions.renameStaff}
            onRemove={actions.removeStaff}
            onColor={actions.setStaffColor}
          />

          <TimerColorsCard />

          <ResetDayCard onReset={actions.resetDay} />

          <AveragesCard
            resetAt={clinic.averages_reset_at}
            onReset={actions.resetAverages}
            onErase={actions.eraseTimingHistory}
          />

          <div className="card p-5 mb-6">
            <h3 className="font-bold mb-1">Room directions</h3>
            <p className="text-sm text-slate-500 mb-3">
              What the front desk and the waiting room screen tell patients, for example &ldquo;First door on the
              right&rdquo;. Leave a room blank to show its hallway and side instead.
            </p>
            <table className="w-full text-sm">
              <tbody>
                {rooms.map((r) => (
                  <DirectionsRow
                    key={r.id}
                    name={r.name}
                    value={r.directions}
                    onSave={(text) => actions.setDirections(r.id, text)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px,1fr))" }}>
            <div className="card p-4">
              <div className="text-xs text-slate-500 mb-1">Rooms past red now</div>
              <div className={`text-2xl font-bold ${overdueCount > 0 ? "text-red-600" : ""}`}>
                {overdueCount} of {rooms.length}
              </div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-slate-500 mb-1">Contamination lockouts now</div>
              <div className={`text-2xl font-bold ${lockoutCount > 0 ? "text-red-600" : ""}`}>{lockoutCount}</div>
            </div>
          </div>

          <TrackerPanel />

          <div className="card p-5 mb-6">
            <h3 className="font-bold mb-1">Doctor idle time</h3>
            <p className="text-sm text-slate-500 mb-3">
              Actual gaps between a provider&apos;s visits over the last 30 days, not an estimate. Counted only within
              the same day, so an overnight or weekend gap never counts as idle time. Visits with &quot;Any
              provider&quot; are not attributed to anyone here.
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
            <p className="text-sm text-slate-500 mb-3">Last 30 days, or since the last 30 day reset.</p>
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
                    <th className="pb-2 pr-3">Avg shots</th>
                    <th className="pb-2 pr-3">Avg other</th>
                    <th className="pb-2">Visits</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((r) => {
                    const over = isOverdue(r, timerTargets);
                    const cell = (stage: Stage) => {
                      const v = roomAvg(r.id, stage);
                      return v ? formatMinutes(v) : "—";
                    };
                    return (
                      <tr
                        key={r.id}
                        className={`border-t border-slate-100 dark:border-slate-700 whitespace-nowrap ${
                          over ? "text-red-600" : ""
                        }`}
                      >
                        <td className="py-2 pr-3">{r.name}</td>
                        <td className="py-2 pr-3">
                          {r.contaminated ? "Lockout" : STAGE_LABEL[r.stage] + (over ? " (past red)" : "")}
                        </td>
                        <td className="py-2 pr-3 font-mono">
                          {r.contaminated || r.stage === "vacant" || r.stage === "turnover" ? (
                            "—"
                          ) : (
                            <LiveTimer startedAt={r.stage_started_at} stage={r.stage} minVisibleMin={0} />
                          )}
                        </td>
                        <td className="py-2 pr-3 font-mono">{cell("ready_for_nurse")}</td>
                        <td className="py-2 pr-3 font-mono">{cell("prepping")}</td>
                        <td className="py-2 pr-3 font-mono">{cell("ready_for_doctor")}</td>
                        <td className="py-2 pr-3 font-mono">{cell("with_doctor")}</td>
                        <td className="py-2 pr-3 font-mono">{cell("shots")}</td>
                        <td className="py-2 pr-3 font-mono">{cell("other")}</td>
                        <td className="py-2 font-mono">{roomVisits(r.id)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Timer colors (when a step turns yellow and red) are set on the Setup tab.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
