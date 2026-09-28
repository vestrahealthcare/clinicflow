"use client";

import { useClinic } from "@/lib/clinicContext";
import { LiveTimer } from "@/components/LiveTimer";
import { Legend } from "@/components/Legend";
import { NeedsAttentionStrip } from "@/components/NeedsAttentionStrip";
import { STAGE_LABEL, REQUEST_LABEL } from "@/lib/constants";
import { isOverdue, personColor, personLabel, contrastText } from "@/lib/util";

export default function BoardPage() {
  const { rooms, staffById, activeRequestsByRoom, unclaimedRoomIds, today, avgByStage, countByStage } = useClinic();
  const dayOpen = !!today?.opened_at && !today?.closed_at;

  return (
    <div>
      <NeedsAttentionStrip />
      <Legend />
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
        {rooms.map((room) => {
          const color = personColor(room);
          const text = contrastText(color);
          const overdue = isOverdue(room);
          const urgent = room.contaminated;
          const unclaimed = unclaimedRoomIds.has(room.id);
          const badges = Object.values(activeRequestsByRoom[room.id] ?? {});
          const label = personLabel(room, staffById);

          return (
            <div
              key={room.id}
              className={`card p-4 ${urgent ? "flash-urgent" : ""} ${
                (room.flashing || unclaimed) && !urgent ? "flash-box" : ""
              } ${overdue && !urgent ? "ring-2 ring-red-500" : ""}`}
              style={{ backgroundColor: color, color: text }}
            >
              <div className="flex justify-between font-bold text-sm mb-0.5">
                <span>{room.name}</span>
              </div>
              <div className="text-xs mb-2" style={{ color: text, opacity: 0.85 }}>
                {room.contaminated ? "Contamination lockout" : STAGE_LABEL[room.stage]}
                {room.patient_label ? ` · ${room.patient_label}` : ""}
                {label ? ` · ${label}` : ""}
              </div>
              <div className="text-xl font-semibold">
                {room.contaminated ? (
                  "—"
                ) : (
                  <LiveTimer
                    startedAt={room.stage_started_at}
                    paused={!dayOpen}
                    stage={room.stage}
                    avgByStage={avgByStage}
                    countByStage={countByStage}
                  />
                )}
              </div>
              {badges.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {badges.map((req) => (
                    <span
                      key={req.id}
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: text + "22", color: text }}
                    >
                      {REQUEST_LABEL[req.key] ?? req.key}
                      {req.acknowledged_at ? " ✓" : ""}
                    </span>
                  ))}
                </div>
              )}
              {room.note && (
                <div className="text-xs italic mt-2" style={{ color: text, opacity: 0.85 }}>
                  &ldquo;{room.note}&rdquo;
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
