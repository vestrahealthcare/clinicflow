"use client";

import { useState } from "react";
import Link from "next/link";
import { useClinic } from "@/lib/clinicContext";
import { useUndo } from "@/lib/undoContext";
import { supabase } from "@/lib/supabaseClient";
import { LiveTimer } from "@/components/LiveTimer";
import { STAGE_LABEL, ACTION_LABEL, REQUEST_GROUPS, REQUEST_LABEL, STAFF_NAME_KEY } from "@/lib/constants";
import { isOverdue, roomOccupancyColor, personLabel, contrastText, formatClockTime } from "@/lib/util";
import { Room, RoomRequest } from "@/lib/types";

export default function RoomPage({ params }: { params: { slug: string; roomNumber: string } }) {
  const { rooms, staffById, today, activeRequestsByRoom, avgByStage, countByStage, actions } = useClinic();
  const { showUndo } = useUndo();
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [departConfirmOpen, setDepartConfirmOpen] = useState(false);
  const [askingNameForKey, setAskingNameForKey] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const roomNumber = parseInt(params.roomNumber, 10);
  const room = rooms.find((r) => r.room_number === roomNumber);
  const dayOpen = !!today?.opened_at && !today?.closed_at;

  if (!room) return <div className="text-slate-500">Loading room…</div>;

  const color = roomOccupancyColor(room);
  const text = contrastText(color);
  const label = personLabel(room, staffById);
  const overdue = isOverdue(room);
  const side = room.side === "left" ? "Left" : "Right";
  const activeReqs = activeRequestsByRoom[room.id] ?? {};
  const outstanding = Object.values(activeReqs);

  function getStaffName(): string {
    try {
      return localStorage.getItem(STAFF_NAME_KEY) ?? "";
    } catch {
      return "";
    }
  }

  function sendNote() {
    const text = noteDraft[room!.id] ?? room!.note ?? "";
    actions.setNote(room!.id, text);
    if (text.trim()) actions.toggleFlash(room!.id, true);
  }

  async function requestChipClick(key: string) {
    const existing = activeReqs[key];
    if (!existing) {
      await actions.createRequest(room!.id, key);
      return;
    }
    const res = await actions.clearRequest(existing.id);
    if (res.ok) {
      showUndo(`${REQUEST_LABEL[key] ?? key} cleared.`, () => actions.restoreRequest(existing.id));
    }
  }

  function rememberStaffName(name: string) {
    try {
      localStorage.setItem(STAFF_NAME_KEY, name);
    } catch {
      // Ignore — just won't be remembered next time.
    }
  }

  async function claimRequest(req: RoomRequest) {
    const name = getStaffName();
    if (name) {
      await actions.acknowledgeRequest(req.id, name);
    } else {
      setNameDraft("");
      setAskingNameForKey(req.key);
    }
  }

  async function confirmNamedClaim(req: RoomRequest) {
    if (!nameDraft.trim()) return;
    rememberStaffName(nameDraft.trim());
    await actions.acknowledgeRequest(req.id, nameDraft.trim());
    setAskingNameForKey(null);
  }

  async function advanceWithUndo() {
    const snapshot: Partial<Room> = {
      stage: room!.stage,
      stage_started_at: room!.stage_started_at,
      ticket: room!.ticket,
      note: room!.note,
      requests: room!.requests,
      flashing: room!.flashing,
      provider_finished_at: room!.provider_finished_at
    };
    const beforeUpdatedAt = room!.updated_at;
    const res = await actions.advanceStage(room!.id);
    if (!res.ok) return;
    const { data: fresh } = await supabase.from("rooms").select("updated_at").eq("id", room!.id).single();
    const afterUpdatedAt = fresh?.updated_at ?? beforeUpdatedAt;
    showUndo(`${STAGE_LABEL[snapshot.stage!]} step done.`, () =>
      actions.restoreRoomSnapshot(room!.id, snapshot, afterUpdatedAt, res.historyId)
    );
  }

  async function handlePatientDepartedClick() {
    if (outstanding.length > 0) {
      setDepartConfirmOpen(true);
      return;
    }
    await advanceWithUndo();
  }

  async function handOffAndDepart() {
    setDepartConfirmOpen(false);
    await advanceWithUndo();
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
            {room.patient_label ? ` · ${room.patient_label}` : ""}
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
          ) : room.stage === "with_doctor" ? (
            <div className="space-y-2">
              {room.provider_finished_at ? (
                <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 px-1">
                  Provider finished at {formatClockTime(room.provider_finished_at)}
                </div>
              ) : (
                <button
                  className="w-full py-3 rounded-xl border border-slate-300 dark:border-slate-600 font-bold"
                  onClick={() => actions.markProviderFinished(room.id)}
                >
                  Provider finished
                </button>
              )}

              {departConfirmOpen && (
                <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200">
                  <div className="font-semibold text-sm mb-2">These tasks are still open:</div>
                  <ul className="text-sm mb-3 list-disc pl-5">
                    {outstanding.map((r) => (
                      <li key={r.id}>
                        {REQUEST_LABEL[r.key] ?? r.key}
                        {r.acknowledged_by ? ` — claimed by ${r.acknowledged_by}` : " — unclaimed"}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs mb-3">
                    They&apos;ll stay open on Needs Attention for someone to finish — departing doesn&apos;t delete them.
                  </p>
                  <div className="flex gap-2">
                    <button
                      className="flex-1 py-2.5 rounded-lg border border-amber-600 font-bold text-sm"
                      onClick={() => setDepartConfirmOpen(false)}
                    >
                      Go back
                    </button>
                    <button
                      className="flex-1 py-2.5 rounded-lg bg-amber-600 text-white font-bold text-sm"
                      onClick={handOffAndDepart}
                    >
                      Hand off and depart anyway
                    </button>
                  </div>
                </div>
              )}

              <button
                className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold text-lg"
                onClick={handlePatientDepartedClick}
              >
                Patient departed →
              </button>
            </div>
          ) : (
            <button
              className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold text-lg"
              onClick={advanceWithUndo}
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
                    {g.items.map((d) => {
                      const req = activeReqs[d.key];
                      if (!req) {
                        return (
                          <button key={d.key} className="chip" onClick={() => requestChipClick(d.key)}>
                            {d.label}
                          </button>
                        );
                      }
                      if (!req.acknowledged_at) {
                        if (askingNameForKey === d.key) {
                          return (
                            <span key={d.key} className="chip on flex items-center gap-1.5">
                              <input
                                autoFocus
                                className="w-20 min-w-0 border-none bg-white/20 rounded px-1.5 py-0.5 text-xs placeholder:text-current"
                                placeholder="Your name"
                                value={nameDraft}
                                onChange={(e) => setNameDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") confirmNamedClaim(req);
                                }}
                              />
                              <button
                                className="font-semibold disabled:opacity-50"
                                onClick={() => confirmNamedClaim(req)}
                                disabled={!nameDraft.trim()}
                              >
                                Claim
                              </button>
                              <button className="opacity-70" onClick={() => setAskingNameForKey(null)}>
                                ✕
                              </button>
                            </span>
                          );
                        }
                        return (
                          <span key={d.key} className="chip on flex items-center gap-2">
                            <button onClick={() => requestChipClick(d.key)}>{d.label} ✕</button>
                            <button className="underline font-semibold" onClick={() => claimRequest(req)}>
                              I&apos;ve got it
                            </button>
                          </span>
                        );
                      }
                      return (
                        <button
                          key={d.key}
                          className="chip on"
                          title={`Claimed by ${req.acknowledged_by}`}
                          onClick={() => requestChipClick(d.key)}
                        >
                          {d.label} — {req.acknowledged_by} ✓
                        </button>
                      );
                    })}
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
