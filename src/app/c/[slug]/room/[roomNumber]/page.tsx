"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useClinic } from "@/lib/clinicContext";
import { LiveTimer } from "@/components/LiveTimer";
import {
  STAGE_LABEL,
  ACTION_LABEL,
  REQUEST_GROUPS,
  REQUEST_LABEL,
  TEST_KEYS,
  LAB_PICKUP_KEYS
} from "@/lib/constants";
import { isOverdue, personColor, personLabel } from "@/lib/util";

export default function RoomPage({ params }: { params: { slug: string; roomNumber: string } }) {
  const { rooms, hallways, staffById, avgByStage, countByStage, actions } = useClinic();
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  // Shown when the patient is leaving but rapid/molecular tests are still marked on the room.
  const [askCallbackFor, setAskCallbackFor] = useState<string | null>(null);

  const roomNumber = parseInt(params.roomNumber, 10);
  const room = rooms.find((r) => r.room_number === roomNumber);
  const hallway = useMemo(() => hallways.find((h) => h.id === room?.hallway_id), [hallways, room]);

  if (!room)
    return (
      <div className="text-slate-500">
        Room {params.roomNumber} is not in service. Pick a room above, or change &ldquo;Rooms in service&rdquo; in Admin.
      </div>
    );

  const pendingTests = TEST_KEYS.filter((k) => room.requests?.[k]);
  const labOn = LAB_PICKUP_KEYS.filter((k) => room.requests?.[k]);
  const inVisit = room.stage === "with_doctor" || room.stage === "shots" || room.stage === "other";

  // "Pt departed": if tests are still marked, ask once whether to add the patient
  // to the Call with results list before the room moves to cleanup.
  const departNow = (addCallback: boolean) => {
    setAskCallbackFor(null);
    actions.advanceStage(room.id, { target: "needs_cleanup", expected: room.stage, addCallback });
  };
  const onDepart = () => {
    if (pendingTests.length > 0) setAskCallbackFor(room.id);
    else departNow(false);
  };

  const color = personColor(room);
  const label = personLabel(room, staffById);
  const overdue = isOverdue(room);
  const side = room.side === "left" ? "Left" : "Right";

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-5">
        {rooms.map((r) => {
          const h = hallways.find((x) => x.id === r.hallway_id);
          return (
            <Link
              key={r.id}
              href={`/c/${params.slug}/room/${r.room_number}`}
              className={`chip flex items-center ${r.room_number === roomNumber ? "!bg-slate-900 !text-white dark:!bg-white dark:!text-slate-900" : ""}`}
            >
              <span className="hall-dot" style={{ backgroundColor: h?.color ?? "#999" }} />
              {r.name}
            </Link>
          );
        })}
      </div>

      <div className={`card p-6 max-w-xl ${overdue ? "border-red-400" : ""} ${room.contaminated ? "border-red-700" : ""}`}>
        <h2 className="text-2xl font-bold mb-1">{room.name}</h2>
        <div className="text-sm text-slate-500 mb-4">
          <span className="hall-dot" style={{ backgroundColor: hallway?.color ?? "#999" }} />
          {hallway?.label ?? "Hallway"} &middot; {side} side
          {room.ticket ? ` · Ticket ${room.ticket}` : ""}
          {label ? ` · ${label}` : ""}
        </div>

        <div className="flex items-center gap-3 mb-6 flex-wrap">
          {room.contaminated ? (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full font-semibold text-sm bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300">
              <span className="hall-dot" style={{ backgroundColor: color }} />
              Contamination lockout
            </span>
          ) : (
            <>
              <span
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full font-semibold text-sm"
                style={{ backgroundColor: color + "22", color }}
              >
                <span className="hall-dot" style={{ backgroundColor: color }} />
                {STAGE_LABEL[room.stage]}
              </span>
              <span className="text-xl font-semibold">
                <LiveTimer
                  startedAt={room.stage_started_at}
                  stage={room.stage}
                  avgByStage={avgByStage}
                  countByStage={countByStage}
                />
              </span>
            </>
          )}
        </div>

        <div className="text-xs text-slate-500 mb-2">Next step</div>
        {room.contaminated ? (
          <>
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 font-semibold mb-3">
              Deep clean required before this room can be used
            </div>
            <button
              className="w-full py-4 rounded-xl bg-red-700 text-white font-bold"
              onClick={() => actions.setLockout(room.id, false)}
            >
              Clear lockout, room cleaned
            </button>
          </>
        ) : room.stage === "vacant" ? (
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-500 text-sm text-center">
            Waiting for front desk to assign a patient.
          </div>
        ) : inVisit && askCallbackFor === room.id ? (
          <div className="p-4 rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950">
            <div className="font-bold mb-1">Results still pending</div>
            <div className="text-sm mb-3">
              {pendingTests.map((k) => REQUEST_LABEL[k]).join(", ")}. Add this patient to the Call with results
              list?
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-bold"
                onClick={() => departNow(true)}
              >
                Yes, call with results
              </button>
              <button
                className="flex-1 py-3 rounded-xl border border-slate-300 dark:border-slate-600 font-bold"
                onClick={() => departNow(false)}
              >
                No
              </button>
            </div>
            <button className="w-full mt-2 text-sm text-slate-500 py-1" onClick={() => setAskCallbackFor(null)}>
              Back
            </button>
          </div>
        ) : room.stage === "with_doctor" ? (
          <>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button
                className="py-4 rounded-xl bg-emerald-600 text-white font-bold text-lg"
                onClick={() => actions.advanceStage(room.id, { target: "shots", expected: "with_doctor" })}
              >
                Shots
              </button>
              <button
                className="py-4 rounded-xl bg-emerald-600 text-white font-bold text-lg"
                onClick={() => actions.advanceStage(room.id, { target: "other", expected: "with_doctor" })}
              >
                Other
              </button>
            </div>
            <button className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold text-lg" onClick={onDepart}>
              {ACTION_LABEL.with_doctor} →
            </button>
          </>
        ) : room.stage === "shots" || room.stage === "other" ? (
          <button className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold text-lg" onClick={onDepart}>
            {ACTION_LABEL[room.stage]} →
          </button>
        ) : (
          <button
            className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold text-lg"
            onClick={() => actions.advanceStage(room.id, { expected: room.stage })}
          >
            {ACTION_LABEL[room.stage]} →
          </button>
        )}

        {!room.contaminated && (
          <>
            {REQUEST_GROUPS.map((g) => (
              <div key={g.title}>
                <div className="text-xs text-slate-500 mt-5 mb-2">{g.title}</div>
                <div className="flex flex-wrap gap-2">
                  {g.items.map((d) => (
                    <button
                      key={d.key}
                      className={`chip ${room.requests?.[d.key] ? "on" : ""}`}
                      onClick={() => actions.toggleRequest(room.id, d.key)}
                    >
                      {d.label}
                      {room.requests?.[d.key] ? " ✓" : ""}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {labOn.length > 0 && (
              <div className="mt-3 text-sm rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300">
                DLO pickup reminder added for {labOn.map((k) => REQUEST_LABEL[k]).join(", ")}. Put the sample in the
                pickup box, then check it off on the Lab and calls tab.
              </div>
            )}

            <div className="text-xs text-slate-500 mt-5 mb-2">Message a teammate</div>
            <div className="flex gap-2">
              <input
                className="flex-1 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-900"
                placeholder="e.g. running behind, hold my next patient"
                value={noteDraft[room.id] ?? room.note ?? ""}
                onChange={(e) => setNoteDraft({ ...noteDraft, [room.id]: e.target.value })}
              />
              <button
                className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white font-semibold px-4 rounded-lg"
                onClick={() => actions.setNote(room.id, noteDraft[room.id] ?? room.note ?? "")}
              >
                Send
              </button>
            </div>
            {room.note && (
              <div className="mt-2 text-sm bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2 flex justify-between gap-2">
                <span>&ldquo;{room.note}&rdquo;</span>
                <button className="text-slate-400" onClick={() => actions.setNote(room.id, null)}>
                  Clear
                </button>
              </div>
            )}

            <button
              className="w-full mt-4 py-3 rounded-xl border border-red-700 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 font-bold text-sm"
              onClick={() => actions.setLockout(room.id, true)}
            >
              Contamination lockout
            </button>
          </>
        )}
      </div>
    </div>
  );
}
