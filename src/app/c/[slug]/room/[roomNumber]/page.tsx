"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useClinic } from "@/lib/clinicContext";
import { LiveTimer } from "@/components/LiveTimer";
import { ClaimPicker } from "@/components/ClaimPicker";
import { BlackStage } from "@/components/BlackStage";
import {
  STAGE_LABEL,
  ACTION_LABEL,
  REQUEST_GROUPS,
  REQUEST_LABEL,
  TEST_KEYS,
  LAB_PICKUP_KEYS,
  FOLLOWUP_TIMEFRAMES,
  FOLLOWUP_REASONS,
  FOLLOWUP_TIMEFRAME_LABEL,
  FOLLOWUP_REASON_LABEL
} from "@/lib/constants";
import { FollowupReason, FollowupTimeframe } from "@/lib/types";
import { attentionItems, flashKind, FLASH_CLASS, isOverdue, personColor, personLabel, roomDirections } from "@/lib/util";

export default function RoomPage({ params }: { params: { slug: string; roomNumber: string } }) {
  const { rooms, hallways, staffById, avgByStage, countByStage, actions, me } = useClinic();
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  // Shown when the patient is leaving but rapid/molecular tests are still marked on the room.
  const [askCallbackFor, setAskCallbackFor] = useState<string | null>(null);
  // Which "I've got it" item is picking a name, and the follow up form.
  const [claiming, setClaiming] = useState<string | null>(null);
  const [followupOpenFor, setFollowupOpenFor] = useState<string | null>(null);
  const [fuTimeframe, setFuTimeframe] = useState<FollowupTimeframe | null>(null);
  const [fuReason, setFuReason] = useState<FollowupReason | null>(null);
  const [fuNote, setFuNote] = useState("");
  // Start prep with no name set at the top of the page: ask which nurse is going in.
  const [prepPicker, setPrepPicker] = useState(false);
  // Change room: pick a vacant room to move this patient to.
  const [changingRoom, setChangingRoom] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const router = useRouter();

  const roomNumber = parseInt(params.roomNumber, 10);
  const room = rooms.find((r) => r.room_number === roomNumber);
  const hallway = useMemo(() => hallways.find((h) => h.id === room?.hallway_id), [hallways, room]);

  if (!room)
    return (
      <BlackStage>
        <div className="text-slate-400">
          Room {params.roomNumber} is not in service. Pick a room above, or change &ldquo;Rooms in service&rdquo; in
          Admin.
        </div>
      </BlackStage>
    );

  const color = personColor(room);
  const label = personLabel(room, staffById);
  const overdue = isOverdue(room);
  const items = attentionItems(room);
  const flash = flashKind(room);

  const pendingTests = TEST_KEYS.filter((k) => room.requests?.[k]);
  const labOn = LAB_PICKUP_KEYS.filter((k) => room.requests?.[k]);
  const inVisit = room.stage === "with_doctor" || room.stage === "shots" || room.stage === "other";

  // Check-out: if tests are still marked, ask once whether to add the patient to the
  // Call with results list. The patient then goes back to the waiting room list.
  const checkOutNow = (addCallback: boolean) => {
    setAskCallbackFor(null);
    actions.checkOut(room.id, { expected: room.stage, addCallback });
  };
  const onCheckOut = () => {
    if (pendingTests.length > 0) setAskCallbackFor(room.id);
    else checkOutNow(false);
  };

  const vacantRooms = rooms.filter((r) => r.stage === "vacant" && !r.contaminated && r.id !== room.id);
  const moveTo = async (toId: string, toNumber: number) => {
    setSwapError(null);
    const err = await actions.swapRoom(room.id, toId);
    if (err) {
      setSwapError(err);
      return;
    }
    setChangingRoom(false);
    router.push(`/c/${params.slug}/room/${toNumber}`);
  };
  const startPrep = (name: string) => {
    setPrepPicker(false);
    actions.advanceStage(room.id, { expected: "ready_for_nurse", actor: name });
  };

  const openFollowup = () => {
    setFuTimeframe(room.followup?.timeframe ?? null);
    setFuReason(room.followup?.reason ?? null);
    setFuNote(room.followup?.note ?? "");
    setFollowupOpenFor(room.id);
  };
  const saveFollowup = () => {
    if (!fuTimeframe || !fuReason) return;
    actions.setFollowup(room.id, fuTimeframe, fuReason, fuNote);
    setFollowupOpenFor(null);
  };

  return (
    <BlackStage>
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

      <div
        className={`card p-6 max-w-xl ${overdue ? "border-red-400" : ""} ${room.contaminated ? "border-red-700" : ""} ${
          flash && !room.contaminated ? FLASH_CLASS[flash] : ""
        }`}
      >
        <h2 className="text-2xl font-bold mb-1">
          {room.name}
          {room.initials ? <span className="ml-3 font-mono text-xl text-slate-500">{room.initials}</span> : null}
        </h2>
        <div className="text-sm text-slate-500 mb-4">
          <span className="hall-dot" style={{ backgroundColor: hallway?.color ?? "#999" }} />
          {roomDirections(room, hallway)}
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
                onClick={() => checkOutNow(true)}
              >
                Yes, call with results
              </button>
              <button
                className="flex-1 py-3 rounded-xl border border-slate-300 dark:border-slate-600 font-bold"
                onClick={() => checkOutNow(false)}
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
            <button className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold text-lg" onClick={onCheckOut}>
              {ACTION_LABEL.with_doctor} →
            </button>
          </>
        ) : room.stage === "shots" || room.stage === "other" ? (
          <button className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold text-lg" onClick={onCheckOut}>
            {ACTION_LABEL[room.stage]} →
          </button>
        ) : room.stage === "ready_for_nurse" ? (
          <>
            <button
              className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold text-lg"
              onClick={() => (me ? startPrep(me) : setPrepPicker(true))}
            >
              {ACTION_LABEL[room.stage]}
              {me ? ` (${me})` : ""} →
            </button>
            {prepPicker && (
              <ClaimPicker prompt="Which nurse is going in?" onPick={startPrep} onCancel={() => setPrepPicker(false)} />
            )}
          </>
        ) : (
          <button
            className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold text-lg"
            onClick={() => actions.advanceStage(room.id, { expected: room.stage })}
          >
            {ACTION_LABEL[room.stage]} →
          </button>
        )}

        {!room.contaminated && room.stage !== "vacant" && (
          <div className="mt-3">
            {changingRoom ? (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                <div className="text-xs text-slate-500 mb-2">
                  Move {room.initials ?? "this patient"} to which vacant room?
                </div>
                {vacantRooms.length === 0 ? (
                  <div className="text-sm text-slate-500 mb-2">No vacant rooms right now.</div>
                ) : (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {vacantRooms.map((r) => (
                      <button key={r.id} className="chip" onClick={() => moveTo(r.id, r.room_number)}>
                        {r.name}
                      </button>
                    ))}
                  </div>
                )}
                {swapError && <div className="text-sm font-semibold text-red-600 mb-2">{swapError}</div>}
                <button
                  className="text-sm text-slate-500"
                  onClick={() => {
                    setChangingRoom(false);
                    setSwapError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="w-full py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-semibold"
                onClick={() => setChangingRoom(true)}
              >
                Change room
              </button>
            )}
          </div>
        )}

        {!room.contaminated && items.length > 0 && (
          <div className="mt-5">
            <div className="text-xs text-slate-500 mb-2">Needs attention</div>
            <div className="space-y-2">
              {items.map((it) => (
                <div key={it.key} className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-semibold text-sm">
                      {it.label}
                      {it.detail && <span className="block font-normal text-slate-500">{it.detail}</span>}
                    </span>
                    {it.claimedBy ? (
                      <span className="flex items-center gap-2 text-sm">
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{it.claimedBy} has it</span>
                        <button
                          className="text-xs text-slate-400"
                          onClick={() => actions.claim(room.id, it.key, "")}
                        >
                          Undo
                        </button>
                      </span>
                    ) : (
                      <button
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold text-sm"
                        onClick={() => (me ? actions.claim(room.id, it.key, me) : setClaiming(`${room.id}:${it.key}`))}
                      >
                        I&apos;ve got it{me ? ` (${me})` : ""}
                      </button>
                    )}
                  </div>
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
          </div>
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

            {room.stage !== "vacant" && room.stage !== "needs_cleanup" && (
              <>
                <div className="text-xs text-slate-500 mt-5 mb-2">Follow up visit</div>
                {followupOpenFor === room.id ? (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                    <div className="text-xs text-slate-500 mb-2">When</div>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {FOLLOWUP_TIMEFRAMES.map((t) => (
                        <button
                          key={t.key}
                          className={`chip ${fuTimeframe === t.key ? "on" : ""}`}
                          onClick={() => setFuTimeframe(t.key)}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <div className="text-xs text-slate-500 mb-2">Reason</div>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {FOLLOWUP_REASONS.map((r) => (
                        <button
                          key={r.key}
                          className={`chip ${fuReason === r.key ? "on" : ""}`}
                          onClick={() => setFuReason(r.key)}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                    <div className="text-xs text-slate-500 mb-2">Note for the front desk (optional)</div>
                    <input
                      className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 mb-3"
                      placeholder="e.g. needs a morning slot, bring shot record"
                      maxLength={300}
                      value={fuNote}
                      onChange={(e) => setFuNote(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white font-bold text-sm disabled:opacity-40"
                        disabled={!fuTimeframe || !fuReason}
                        onClick={saveFollowup}
                      >
                        Send to front desk
                      </button>
                      <button
                        className="px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-sm"
                        onClick={() => setFollowupOpenFor(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : room.followup ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm">
                    <span className="font-semibold">
                      {FOLLOWUP_TIMEFRAME_LABEL[room.followup.timeframe]}, {FOLLOWUP_REASON_LABEL[room.followup.reason]}
                      {room.followup.note && <span className="block font-normal text-slate-500">{room.followup.note}</span>}
                    </span>
                    <span className="flex gap-3">
                      <button className="text-slate-500" onClick={openFollowup}>
                        Change
                      </button>
                      <button className="text-slate-500" onClick={() => actions.setFollowup(room.id, null, null)}>
                        Remove
                      </button>
                    </span>
                  </div>
                ) : (
                  <button
                    className="w-full py-3 rounded-xl border border-blue-600 text-blue-700 dark:text-blue-300 font-bold text-sm"
                    onClick={openFollowup}
                  >
                    Schedule a follow up visit
                  </button>
                )}
              </>
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
    </BlackStage>
  );
}
