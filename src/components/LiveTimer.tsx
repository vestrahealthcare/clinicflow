"use client";

import { useEffect, useState } from "react";
import { formatDuration, timerColor } from "@/lib/util";
import { Stage } from "@/lib/types";

const COLOR_CLASS: Record<string, string> = {
  normal: "",
  yellow: "text-amber-500",
  red: "text-red-600"
};

export function LiveTimer({
  startedAt,
  paused,
  stage,
  avgByStage,
  countByStage
}: {
  startedAt: string;
  paused?: boolean;
  /** Pass stage + avgByStage/countByStage to enable the smart white/yellow/red coloring. */
  stage?: Stage;
  avgByStage?: Partial<Record<Stage, number>>;
  countByStage?: Partial<Record<Stage, number>>;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [paused, startedAt]);

  if (paused) return <span>—</span>;

  const ms = Date.now() - new Date(startedAt).getTime();
  const color = stage && avgByStage && countByStage ? timerColor(stage, ms, avgByStage, countByStage) : "normal";

  return <span className={`font-mono ${COLOR_CLASS[color]}`}>{formatDuration(ms)}</span>;
}
