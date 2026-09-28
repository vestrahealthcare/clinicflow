"use client";

import { useState } from "react";
import { useClinic } from "@/lib/clinicContext";
import { LiveTimer } from "@/components/LiveTimer";
import { REQUEST_LABEL, STAGE_LABEL, STAFF_NAME_KEY } from "@/lib/constants";
import { isOverdue } from "@/lib/util";

export function NeedsAttentionStrip() {
  const { rooms, roomRequests, actions } = useClinic();
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const roomNameById = Object.fromEntries(rooms.map((r) => [r.id, r.name]));

  const unclaimed = roomRequests.filter((r) => !r.acknowledged_at);
  const longWaits = rooms.filter((r) => isOverdue(r) && r.stage !== "needs_cleanup");

  if (unclaimed.length === 0 && longWaits.length === 0) return null;

  async function claim(requestId: string) {
    setClaimingId(requestId);
    let name = "";
    try {
      name = localStorage.getItem(STAFF_NAME_KEY) ?? "";
    } catch {
      // Ignore — fall back to prompting.
    }
    if (!name) {
      name = window.prompt("Your name, so others know who's got this:") ?? "";
      if (name) {
        try {
          localStorage.setItem(STAFF_NAME_KEY, name);
        } catch {
          // Ignore — just won't be remembered next time.
        }
      }
    }
    if (name.trim()) await actions.acknowledgeRequest(requestId, name.trim());
    setClaimingId(null);
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
            <div className="text-xs text-slate-500">{REQUEST_LABEL[r.key] ?? r.key}</div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm">
                <LiveTimer startedAt={r.created_at} />
              </span>
              <button
                className="text-xs font-semibold bg-slate-900 dark:bg-white dark:text-slate-900 text-white px-2 py-1 rounded-md disabled:opacity-50"
                onClick={() => claim(r.id)}
                disabled={claimingId === r.id}
              >
                I&apos;ve got it
              </button>
            </div>
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
