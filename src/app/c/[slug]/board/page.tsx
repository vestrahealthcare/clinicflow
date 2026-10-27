"use client";

import { useClinic } from "@/lib/clinicContext";
import { LiveTimer } from "@/components/LiveTimer";
import { Legend } from "@/components/Legend";
import { FollowupStrip } from "@/components/FollowupStrip";
import { STAGE_LABEL, ALL_REQUEST_KEYS, REQUEST_LABEL, URGENT_REQUEST_KEYS } from "@/lib/constants";
import { isOverdue, personColor, personLabel, hasUrgentRequest } from "@/lib/util";

export default function BoardPage({ params }: { params: { slug: string } }) {
  const { rooms, hallways, staffById, avgByStage, countByStage } = useClinic();

  return (
    <div>
      <FollowupStrip slug={params.slug} />
      <Legend />
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
        {rooms.map((room) => {
          const hallway = hallways.find((h) => h.id === room.hallway_id);
          const color = personColor(room);
          const overdue = isOverdue(room);
          const urgent = hasUrgentRequest(room, URGENT_REQUEST_KEYS);
          const badges = ALL_REQUEST_KEYS.filter((k) => room.requests?.[k]);
          const label = personLabel(room, staffById);

          return (
            <div
              key={room.id}
              className={`card p-4 border-l-4 ${urgent ? "flash-urgent border-red-700" : ""} ${
                overdue && !urgent ? "border-red-300" : ""
              }`}
              style={!urgent ? { borderLeftColor: color } : undefined}
            >
              <div className="flex justify-between font-bold text-sm mb-0.5">
                <span>
                  <span className="hall-dot" style={{ backgroundColor: hallway?.color ?? "#999" }} />
                  {room.name}
                </span>
              </div>
              <div className="text-xs text-slate-500 mb-2">
                {room.contaminated ? "Contamination lockout" : STAGE_LABEL[room.stage]}
                {label ? ` · ${label}` : ""}
              </div>
              <div className="text-xl font-semibold">
                {room.contaminated ? (
                  "—"
                ) : (
                  <LiveTimer
                    startedAt={room.stage_started_at}
                    stage={room.stage}
                    avgByStage={avgByStage}
                    countByStage={countByStage}
                  />
                )}
              </div>
              {badges.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {badges.map((k) => (
                    <span
                      key={k}
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-900 text-slate-500"
                    >
                      {REQUEST_LABEL[k]}
                    </span>
                  ))}
                </div>
              )}
              {room.note && <div className="text-xs italic text-slate-500 mt-2">&ldquo;{room.note}&rdquo;</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
