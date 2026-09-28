"use client";

import { useState } from "react";
import { useClinic } from "@/lib/clinicContext";
import { LiveTimer } from "@/components/LiveTimer";
import { REQUEST_LABEL, STAGE_LABEL } from "@/lib/constants";
import { isOverdue } from "@/lib/util";

export function NeedsAttentionStrip() {
  const { rooms, roomRequests, actions, staffName, setStaffName } = useClinic();
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [askingNameFor, setAskingNameFor] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const roomNameById = Object.fromEntries(rooms.map((r) => [r.id, r.name]));

  const unclaimed = roomRequests.filter((r) => !r.acknowledged_at);
  const longWaits = rooms.filter((r) => isOverdue(r) && r.stage !== "needs_cleanup");

  if (unclaimed.length === 0 && longWaits.length === 0) return null;

  async function claimAs(requestId: string, name: string) {
    setClaimingId(requestId);
    await actions.acknowledgeRequest(requestId, name.trim());
    setClaimingId(null);
    setAskingNameFor(null);
  }

  function startClaim(requestId: string) {
    if (staffName) {
      claimAs(requestId, staffName);
    } else {
      setNameDraft("");
      setAskingNameFor(requestId);
    }
  }

  function confirmNamedClaim(requestId: string) {
    if (!nameDraft.trim()) return;
    setStaffName(nameDraft.trim());
    claimAs(requestId, nameDraft.trim());
  }

  return (
    <div className="mb-4">
      <div className="text-xs font-semibold text-slate-500 mb-2">Needs attention</div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {unclaimed.map((r) => (
          <div
            key={r.id}
            className="shrink-0 card p-3 border-l-4 border-red-600 min-w-[190px] flex flex-col gap-1"
          >
            <div className="font-bold text-sm">{roomNameById[r.room_id] ?? "Room"}</div>
            <div className="text-xs text-slate-500">
              {REQUEST_LABEL[r.key] ?? r.key}
              {r.created_by ? ` · ${r.created_by}` : ""}
            </div>
            {askingNameFor === r.id ? (
              <div className="flex items-center gap-1 mt-1">
                <input
                  autoFocus
                  className="w-20 min-w-0 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-md px-2 py-1 text-xs"
                  placeholder="Your name"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmNamedClaim(r.id);
                  }}
                />
                <button
                  className="text-xs font-semibold bg-slate-900 dark:bg-white dark:text-slate-900 text-white px-2 py-1 rounded-md disabled:opacity-50"
                  onClick={() => confirmNamedClaim(r.id)}
                  disabled={!nameDraft.trim() || claimingId === r.id}
                >
                  Claim
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm">
                  <LiveTimer startedAt={r.created_at} />
                </span>
                <button
                  className="text-xs font-semibold bg-slate-900 dark:bg-white dark:text-slate-900 text-white px-2 py-1 rounded-md disabled:opacity-50"
                  onClick={() => startClaim(r.id)}
                  disabled={claimingId === r.id}
                >
                  I&apos;ve got it
                </button>
              </div>
            )}
          </div>
        ))}
        {longWaits.map((r) => (
          <div
            key={r.id}
            className="shrink-0 card p-3 border-l-4 border-amber-500 min-w-[190px] flex flex-col gap-1"
          >
            <div className="font-bold text-sm">{r.name}</div>
            <div className="text-xs text-slate-500">Long wait · {STAGE_LABEL[r.stage]}</div>
            <span className="font-mono text-sm">
              <LiveTimer startedAt={r.stage_started_at} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
