"use client";

import { useState } from "react";
import Link from "next/link";
import { useClinic } from "@/lib/clinicContext";
import { LiveTimer } from "@/components/LiveTimer";
import { STAGE_LABEL, ACTION_LABEL, REQUEST_GROUPS } from "@/lib/constants";
import { isOverdue, roomOccupancyColor, personLabel, contrastText } from "@/lib/util";

export default function RoomPage({ params }: { params: { slug: string; roomNumber: string } }) {
  const { rooms, staffById, today, avgByStage, countByStage, actions } = useClinic();
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  const roomNumber = parseInt(params.roomNumber, 10);
  const room = rooms.find((r) => r.room_number === roomNumber);
  const dayOpen = !!today?.opened_at && !today?.closed_at;

  if (!room) return <div className="text-slate-500">Loading room…</div>;

  const color = roomOccupancyColor(room);
  const text = contrastText(color);
  const label = personLabel(room, staffById);
  const overdue = isOverdue(room);
  const side = room.side === "left" ? "Left" : "Right";

  function sendNote() {
    const text = noteDraft[room!.id] ?? room!.note ?? "";
    actions.setNote(room!.id, text);
    if (text.trim()) actions.toggleFlash(room!.id, true);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-5">
        {rooms.map((r) => {
          const chipColor = roomOccupancyColor(r);
          const chipText = contrastText(chipColor);
          const active = r.room_number === roomNumber;
          return (
            <Link
              key={r.id}
              href={`/c/${params.slug}/room/${r.room_number}`}
              className={`chip flex items-center font-semibold ${
                active ? "ring-2 ring-offset-2 ring-slate-900 dark:ring-white ring-offset-slate-100 dark:ring-offset-slate-900" : ""
              }`}
              style={{ backgroundColor: chipColor, color: chipText, borderColor: chipColor }}
            >
              {r.name}
            </Link>
          );
        })}
      </div>

      <div
        className={`card overflow-hidden max-w-xl ${overdue ? "ring-2 ring-red-500" : ""} ${
          room.flashing ? "flash-box" : ""
        }`}
      >
        <div className="p-6" style={{ backgroundColor: color, color: text }}>
          <h2 className="text-2xl font-bold mb-1">{room.name}</h2>
          <div className="text-sm mb-4" style={{ opacity: 0.85 }}>
            {side} side
            {room.ticket ? ` · Ticket ${room.ticket}` : ""}
            {label ? ` · ${label}` : ""}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-semibold text-sm">
              {room.contaminated ? "Contamination lockout" : STAGE_LABEL[room.stage]}
            </span>
            {!room.contaminated && (
              <span className="text-xl font-semibold">
                <LiveTimer
                  startedAt={room.stage_started_at}
                  paused={!dayOpen}
                  stage={room.stage}
                  avgByStage={avgByStage}
                  countByStage={countByStage}
                />
              </span>
            )}
            <button
              className="px-3 py-1.5 rounded-full font-semibold text-sm border"
              style={
                room.flashing
                  ? { backgroundColor: text, borderColor: text, color }
                  : { borderColor: text, color: text, opacity: 0.85 }
              }
              onClick={() => actions.toggleFlash(room.id, !room.flashing)}
            >
              {room.flashing ? "Stop flashing on board" : "Flash this room on board"}
            </button>
          </div>
        </div>

        <div className="p-6">
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
        ) : (
          <button
            className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold text-lg"
            onClick={() => actions.advanceStage(room.id)}
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
                onClick={sendNote}
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
    </div>
  );
}
