"use client";

import { useClinic } from "@/lib/clinicContext";
import { formatClockTime } from "@/lib/util";

export function ConnectionBadge() {
  const { connected, lastUpdatedAt } = useClinic();

  if (connected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        Live
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
      <span className="w-2 h-2 rounded-full bg-red-600" />
      Connection lost — last updated at {formatClockTime(lastUpdatedAt)}
    </span>
  );
}
