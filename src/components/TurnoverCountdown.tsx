"use client";

import { useEffect, useState } from "react";
import { TURNOVER_MS } from "@/lib/constants";
import { formatDuration } from "@/lib/util";

/** "2:00" counting down to 0:00 from the moment of check out. */
export function TurnoverCountdown({ startedAt }: { startedAt: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const left = Math.max(0, TURNOVER_MS - (Date.now() - new Date(startedAt).getTime()));
  return <span className="font-mono">{formatDuration(Math.ceil(left / 1000) * 1000)}</span>;
}
