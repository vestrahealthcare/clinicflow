"use client";

import { useState } from "react";
import { useClinic } from "@/lib/clinicContext";
import { LiveTimer } from "@/components/LiveTimer";
import {
  REQUEST_LABEL,
  CALLBACK_WAITING_YELLOW_MIN,
  CALLBACK_WAITING_RED_MIN,
  CALLBACK_READY_YELLOW_MIN,
  CALLBACK_READY_RED_MIN
} from "@/lib/constants";
import { LabSample, ResultCallback } from "@/lib/types";

function timeLabel(iso: string, tz: string | undefined) {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz || "America/Chicago"
    });
  } catch {
    return new Date(iso).toLocaleTimeString();
  }
}

function RemoveButton({ onConfirm }: { onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button className="text-xs text-slate-400 px-2 py-1" onClick={() => setAsking(true)}>
        Remove
      </button>
    );
  return (
    <span className="text-xs flex items-center gap-2">
      <button className="text-red-600 font-semibold px-2 py-1" onClick={onConfirm}>
        Yes, remove
      </button>
      <button className="text-slate-500 px-2 py-1" onClick={() => setAsking(false)}>
        Keep
      </button>
    </span>
  );
}

function SampleRow({ sample, early }: { sample: LabSample; early?: boolean }) {
  const { clinic, actions } = useClinic();
  const boxed = !!sample.boxed_at;
  return (
    <div
      className={`flex flex-wrap items-center gap-3 py-3 border-t border-slate-100 dark:border-slate-700 first:border-t-0 ${
        early && !boxed ? "text-red-600" : ""
      }`}
    >
      <div className="flex-1 min-w-[10rem]">
        <div className="font-semibold">{REQUEST_LABEL[sample.sample_type] ?? sample.sample_type}</div>
        <div className="text-xs text-slate-500">
          {sample.room_name ?? "Room"}
          {sample.ticket ? ` · Ticket ${sample.ticket}` : ""} · requested {timeLabel(sample.requested_at, clinic?.timezone)}
          {early ? ` · from ${sample.pickup_date}` : ""}
        </div>
      </div>
      {boxed ? (
        <button
          className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-sm"
          onClick={() => actions.setSampleBoxed(sample.id, false)}
          title="Tap to undo"
        >
          In the box ✓ {timeLabel(sample.boxed_at!, clinic?.timezone)}
        </button>
      ) : (
        <button
          className="px-4 py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm"
          onClick={() => actions.setSampleBoxed(sample.id, true)}
        >
          Mark in the box
        </button>
      )}
      <RemoveButton onConfirm={() => actions.removeSample(sample.id)} />
    </div>
  );
}

function CallbackCard({ cb }: { cb: ResultCallback }) {
  const { actions } = useClinic();
  const ready = cb.status === "ready";
  const called = cb.status === "called";
  const since = called ? cb.called_at! : ready ? cb.ready_at ?? cb.departed_at : cb.departed_at;

  return (
    <div className={`card p-4 ${ready ? "flash-urgent border-red-700" : ""}`}>
      <div className="flex justify-between gap-3 items-start">
        <div>
          <div className="font-bold">
            {cb.room_name ?? "Room"}
            {cb.ticket ? ` · Ticket ${cb.ticket}` : ""}
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {cb.tests.map((t) => (
              <span
                key={t}
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300"
              >
                {REQUEST_LABEL[t] ?? t}
              </span>
            ))}
          </div>
        </div>
        <div className="text-right text-xl font-semibold">
          {called ? (
            <span className="text-sm font-normal text-slate-500">called</span>
          ) : (
            <LiveTimer
              startedAt={since}
              yellowAfterMin={ready ? CALLBACK_READY_YELLOW_MIN : CALLBACK_WAITING_YELLOW_MIN}
              redAfterMin={ready ? CALLBACK_READY_RED_MIN : CALLBACK_WAITING_RED_MIN}
            />
          )}
          <div className="text-[11px] font-normal text-slate-500">
            {called ? "" : ready ? "since results came in" : "since patient left"}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        {cb.status === "waiting" && (
          <button
            className="px-4 py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm"
            onClick={() => actions.setCallbackStatus(cb.id, "ready")}
          >
            Results in, call now
          </button>
        )}
        {cb.status === "ready" && (
          <>
            <button
              className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-sm"
              onClick={() => actions.setCallbackStatus(cb.id, "called")}
            >
              Called
            </button>
            <button
              className="px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-sm"
              onClick={() => actions.setCallbackStatus(cb.id, "waiting")}
            >
              Back to waiting
            </button>
          </>
        )}
        {called && (
          <button
            className="px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-sm"
            onClick={() => actions.setCallbackStatus(cb.id, "ready")}
          >
            Undo
          </button>
        )}
        <span className="ml-auto">
          <RemoveButton onConfirm={() => actions.removeCallback(cb.id)} />
        </span>
      </div>
    </div>
  );
}

export default function LabPage() {
  const { clinic, followups, actions } = useClinic();
  const tz = clinic?.timezone;
  const { todaySamples, earlierOpenSamples, dloCalledAt } = followups;

  const boxedCount = todaySamples.filter((s) => s.boxed_at).length;
  const allBoxed = todaySamples.length > 0 && boxedCount === todaySamples.length;

  return (
    <div className="grid gap-6 lg:grid-cols-2 items-start">
      <section className="card p-5">
        <h2 className="text-xl font-bold mb-1">DLO pickup today</h2>
        <p className="text-sm text-slate-500 mb-4">
          Throat culture, strep culture, viral panel and send out lab requests land here automatically. Step 1: put
          each sample in the pickup box. Step 2: call DLO for pickup.
        </p>

        {earlierOpenSamples.length > 0 && (
          <div className="mb-4 rounded-xl border border-red-300 bg-red-50 dark:bg-red-950 px-4 py-2">
            <div className="text-sm font-bold text-red-700 dark:text-red-300 pt-2">
              From earlier days, never marked as in the box
            </div>
            {earlierOpenSamples.map((s) => (
              <SampleRow key={s.id} sample={s} early />
            ))}
          </div>
        )}

        {todaySamples.length === 0 ? (
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-500 text-sm text-center">
            No samples for pickup yet today.
          </div>
        ) : (
          <>
            <div className="mb-2 text-sm font-semibold">
              Step 1: in the box, {boxedCount} of {todaySamples.length}
              {allBoxed ? " ✓" : ""}
            </div>
            <div>
              {todaySamples.map((s) => (
                <SampleRow key={s.id} sample={s} />
              ))}
            </div>
          </>
        )}

        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[10rem]">
            <div className="text-sm font-semibold">Step 2: call DLO for pickup</div>
            <div className="text-xs text-slate-500">
              {dloCalledAt ? `Called at ${timeLabel(dloCalledAt, tz)}` : "Not called yet today"}
            </div>
          </div>
          {dloCalledAt ? (
            <button
              className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-sm"
              onClick={() => actions.setDloCalled(false)}
              title="Tap to undo"
            >
              DLO called ✓
            </button>
          ) : (
            <button
              className="px-4 py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm"
              onClick={() => actions.setDloCalled(true)}
            >
              Mark DLO called
            </button>
          )}
        </div>
        {!dloCalledAt && todaySamples.length > 0 && (
          <div className="mt-2 text-xs text-amber-600 font-semibold">Reminder: DLO has not been called today.</div>
        )}
      </section>

      <section>
        <h2 className="text-xl font-bold mb-1">Call with results</h2>
        <p className="text-sm text-slate-500 mb-4">
          Patients who left while RSV, flu, strep or COVID results were still pending. Added from the room tablet when
          you tap Pt departed. Only the ticket number and room are kept, no names or phone numbers.
        </p>

        {followups.readyCallbacks.length > 0 && (
          <div className="mb-4">
            <div className="text-sm font-bold text-red-600 mb-2">Results in, call patient</div>
            <div className="grid gap-3">
              {followups.readyCallbacks.map((c) => (
                <CallbackCard key={c.id} cb={c} />
              ))}
            </div>
          </div>
        )}

        <div className="mb-4">
          <div className="text-sm font-bold mb-2">Waiting on results</div>
          {followups.waitingCallbacks.length === 0 ? (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-500 text-sm text-center">
              Nobody waiting on results.
            </div>
          ) : (
            <div className="grid gap-3">
              {followups.waitingCallbacks.map((c) => (
                <CallbackCard key={c.id} cb={c} />
              ))}
            </div>
          )}
        </div>

        {followups.doneTodayCallbacks.length > 0 && (
          <div>
            <div className="text-sm font-bold text-slate-500 mb-2">Called today</div>
            <div className="grid gap-3 opacity-70">
              {followups.doneTodayCallbacks.map((c) => (
                <CallbackCard key={c.id} cb={c} />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
