"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useClinic } from "@/lib/clinicContext";
import { LiveTimer } from "@/components/LiveTimer";
import { Legend } from "@/components/Legend";
import { FollowupStrip } from "@/components/FollowupStrip";
import { ClaimPicker } from "@/components/ClaimPicker";
import { STAGE_LABEL } from "@/lib/constants";
import { attentionItems, flashKind, FLASH_CLASS, isOverdue, personColor, personLabel } from "@/lib/util";

export default function BoardPage({ params }: { params: { slug: string } }) {
  const { rooms, hallways, staffById, avgByStage, countByStage, actions, me } = useClinic();
  // "roomId:itemKey" of the item currently choosing a name.
  const [claiming, setClaiming] = useState<string | null>(null);

  // Fishbowl look: black page behind white room squares.
  useEffect(() => {
    document.body.classList.add("fishbowl");
    return () => document.body.classList.remove("fishbowl");
  }, []);

  return (
    <div>
      <FollowupStrip slug={params.slug} />
      <Legend />
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
        {rooms.map((room) => {
          const hallway = hallways.find((h) => h.id === room.hallway_id);
          const color = personColor(room);
          const overdue = isOverdue(room);
          const flash = flashKind(room);
          const items = attentionItems(room);
          const label = personLabel(room, staffById);

          return (
            <div
              key={room.id}
              className={`rounded-2xl border-l-4 bg-white text-slate-900 shadow-sm hover:shadow-md transition-shadow ${
                flash ? FLASH_CLASS[flash] : ""
              } ${overdue && !flash ? "border-red-300" : ""}`}
              style={{ borderLeftColor: flash === "lockout" ? "#B23A2C" : color, backgroundColor: flash ? undefined : "#ffffff" }}
            >
              {/* Tapping the top of the card opens the room's tablet page. */}
              <Link href={`/c/${params.slug}/room/${room.room_number}`} className="block p-4 pb-2">
                <div className="flex justify-between font-bold text-sm mb-0.5">
                  <span>
                    <span className="hall-dot" style={{ backgroundColor: hallway?.color ?? "#999" }} />
                    {room.name}
                  </span>
                  {room.initials && <span className="font-mono text-slate-500">{room.initials}</span>}
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
              </Link>

              {items.length > 0 && (
                <div className="px-4 pb-4 space-y-1.5">
                  {items.map((it) => (
                    <div key={it.key}>
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${
                            it.claimedBy ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {it.label}
                        </span>
                        {it.claimedBy ? (
                          <span className="text-[11px] font-semibold text-emerald-700 whitespace-nowrap">
                            {it.claimedBy} has it
                            <button
                              className="ml-1.5 font-normal text-slate-400"
                              onClick={() => actions.claim(room.id, it.key, "")}
                            >
                              Undo
                            </button>
                          </span>
                        ) : (
                          <button
                            className="text-[11px] font-bold px-2 py-1 rounded-md bg-emerald-600 text-white whitespace-nowrap"
                            onClick={() =>
                              me ? actions.claim(room.id, it.key, me) : setClaiming(`${room.id}:${it.key}`)
                            }
                          >
                            I&apos;ve got it
                          </button>
                        )}
                      </div>
                      {it.detail && <div className="text-xs text-slate-500 mt-0.5">{it.detail}</div>}
                      {it.key === "note" && room.note && (
                        <div className="text-xs italic text-slate-500 mt-0.5">&ldquo;{room.note}&rdquo;</div>
                      )}
                      {claiming === `${room.id}:${it.key}` && (
                        <ClaimPicker
                          onPick={(name) => {
                            actions.claim(room.id, it.key, name);
                            setClaiming(null);
                          }}
                          onCancel={() => setClaiming(null)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
