"use client";

import Link from "next/link";
import { useClinic } from "@/lib/clinicContext";

/**
 * One line on the Fishbowl board so lab pickup and result calls are seen
 * without leaving the board. Hidden when there is nothing to do.
 */
export function FollowupStrip({ slug }: { slug: string }) {
  const { followups } = useClinic();
  const unboxed = [...followups.earlierOpenSamples, ...followups.todaySamples].filter((s) => !s.boxed_at).length;
  const needsDloCall = followups.todaySamples.length > 0 && !followups.dloCalledAt;
  const ready = followups.readyCallbacks.length;
  const waiting = followups.waitingCallbacks.length;

  if (unboxed === 0 && !needsDloCall && ready === 0 && waiting === 0) return null;

  return (
    <Link
      href={`/c/${slug}/lab`}
      className={`card mb-4 px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm font-semibold ${
        ready > 0 ? "flash-urgent border-red-700" : ""
      }`}
    >
      {ready > 0 && <span className="text-red-600">{ready} to call with results</span>}
      {waiting > 0 && <span className="text-slate-500">{waiting} waiting on results</span>}
      {unboxed > 0 && <span className="text-amber-600">{unboxed} sample{unboxed === 1 ? "" : "s"} not in the DLO box</span>}
      {needsDloCall && <span className="text-amber-600">DLO not called yet</span>}
      <span className="ml-auto text-slate-400 font-normal">Open Lab and calls →</span>
    </Link>
  );
}
