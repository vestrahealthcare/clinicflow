"use client";

import { useEffect, useState } from "react";
import { formatDuration, timerColor } from "@/lib/util";
import { Stage } from "@/lib/types";
import { useClinic } from "@/lib/clinicContext";
import { TIMER_VISIBLE_AFTER_MIN } from "@/lib/constants";

const COLOR_CLASS: Record<string, string> = {
  normal: "",
  yellow: "text-amber-500",
  red: "text-red-600"
};

export function LiveTimer({
  startedAt,
  paused,
  stage,
  yellowAfterMin,
  redAfterMin,
  minVisibleMin,
  pill
}: {
  startedAt: string;
  paused?: boolean;
  /** Pass the stage to color the time by that step's yellow and red minutes (Admin, Timer colors). */
  stage?: Stage;
  /** Fixed thresholds in minutes, for timers that are not a room stage (e.g. waiting on results). */
  yellowAfterMin?: number;
  redAfterMin?: number;
  /** Hide the timer until this many minutes have passed. Room step timers default to 5, others to 0. */
  minVisibleMin?: number;
  /** Yellow and red times sit on a white pill so they stay readable on a colored background. */
  pill?: boolean;
}) {
  const { timerTargets } = useClinic();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [paused, startedAt]);

  if (paused) return <span>—</span>;
  // Nobody is waiting on an empty room, so a vacant room never shows a running time.
  if (stage === "vacant" || stage === "turnover") return <span />;

  const ms = Date.now() - new Date(startedAt).getTime();
  const hideBefore = minVisibleMin ?? (stage ? TIMER_VISIBLE_AFTER_MIN : 0);
  if (ms < hideBefore * 60000) return <span />;
  let color: "normal" | "yellow" | "red" = "normal";
  if (stage) {
    color = timerColor(stage, ms, timerTargets);
  } else if (redAfterMin !== undefined && ms >= redAfterMin * 60000) {
    color = "red";
  } else if (yellowAfterMin !== undefined && ms >= yellowAfterMin * 60000) {
    color = "yellow";
  }

  const pillClass = pill && color !== "normal" ? "bg-white px-2 rounded-lg" : "";
  return <span className={`font-mono ${COLOR_CLASS[color]} ${pillClass}`}>{formatDuration(ms)}</span>;
}
