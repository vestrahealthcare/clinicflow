import { TrackerRow } from "./types";

export type WindowKey = "day" | "d7" | "d30" | "all";

export const WINDOW_LABEL: Record<WindowKey, string> = {
  day: "That day",
  d7: "Last 7 days",
  d30: "Last 30 days",
  all: "All time"
};
export const WINDOWS: WindowKey[] = ["day", "d7", "d30", "all"];

/** YYYY-MM-DD plus a number of days (calendar math, no time zones involved). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/**
 * Which rows belong to a column of the Tracker, for the chosen day D:
 *   That day = D only, Last 7 days = D-6 to D, Last 30 days = D-29 to D (and only visits since the
 *   30 day reset), All time = everything up to D. The 7 day and all time columns ignore the reset.
 */
export function rowsFor(rows: TrackerRow[], day: string, w: WindowKey): TrackerRow[] {
  switch (w) {
    case "day":
      return rows.filter((r) => r.visit_date === day);
    case "d7": {
      const from = addDays(day, -6);
      return rows.filter((r) => r.visit_date >= from && r.visit_date <= day);
    }
    case "d30": {
      const from = addDays(day, -29);
      return rows.filter((r) => r.visit_date >= from && r.visit_date <= day && r.after_reset);
    }
    default:
      return rows.filter((r) => r.visit_date <= day);
  }
}

export interface Totals {
  visits: number;
  /** Number of clinic days in the window that had at least one visit. */
  days: number;
  /** Number of clinic days in the window that had at least one live recorded visit. */
  liveDays: number;
}

export function totals(rows: TrackerRow[]): Totals {
  const days = new Set<string>();
  const liveDays = new Set<string>();
  let visits = 0;
  rows.forEach((r) => {
    visits += r.visits;
    days.add(r.visit_date);
    if (r.new_visits > 0) liveDays.add(r.visit_date);
  });
  return { visits, days: days.size, liveDays: liveDays.size };
}

export type StepKey = "rfn" | "prep" | "rfd" | "wd" | "sh" | "ot" | "d2d";

/** Average minutes for one step over some rows, or null when nothing was recorded. */
export function avgStepMs(rows: TrackerRow[], k: StepKey): { avgMs: number | null; n: number } {
  let sum = 0;
  let n = 0;
  rows.forEach((r) => {
    sum += Number(r[`${k}_sum` as keyof TrackerRow] ?? 0);
    n += Number(r[`${k}_n` as keyof TrackerRow] ?? 0);
  });
  return { avgMs: n > 0 ? sum / n : null, n };
}

export const UNASSIGNED = "Unassigned";
export const providerKey = (r: TrackerRow) => r.provider_name || UNASSIGNED;
