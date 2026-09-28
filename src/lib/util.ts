import { Room, Stage } from "./types";
import {
  THRESH_MIN,
  HOUSEKEEPING_COLOR,
  VACANT_COLOR,
  LOCKOUT_COLOR,
  ROLE_COLOR,
  YELLOW_OVER_AVG,
  RED_OVER_AVG,
  MIN_SAMPLES_FOR_AVG
} from "./constants";

export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatMinutes(ms: number): string {
  return `${(ms / 60000).toFixed(1)} min`;
}

/** e.g. "2026-09-27T09:04:12.000Z" -> "9:04 AM" (browser-local time). */
export function formatClockTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** e.g. "09:00:00" (a Postgres `time`) -> "9:00 AM". */
export function formatSqlTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function elapsedMs(room: Room): number {
  return Date.now() - new Date(room.stage_started_at).getTime();
}

/**
 * "Overdue" for the board's red border flash / flagging on lists. Uses the
 * fixed fallback minutes, independent of the smart yellow/red timer text
 * coloring below, so a totally new clinic with no history yet still gets
 * sane overdue flags on day one.
 */
export function isOverdue(room: Room): boolean {
  if (room.contaminated) return false;
  const th = THRESH_MIN[room.stage];
  if (!th) return false;
  return elapsedMs(room) > th * 60000;
}

/**
 * Who's physically in the room right now, for the room tablet itself:
 * provider in the room = blue, nurse in the room = green, patient waiting
 * alone (checked in but no staff with them yet) = red, nobody in the room
 * (vacant or awaiting cleanup) = grey. This is deliberately different from
 * personColor's "whose turn is it next" logic used on the hallway board.
 */
export function roomOccupancyColor(room: Room): string {
  if (room.contaminated) return LOCKOUT_COLOR;
  switch (room.stage) {
    case "vacant":
    case "needs_cleanup":
      return VACANT_COLOR;
    case "ready_for_nurse":
    case "ready_for_doctor":
      return LOCKOUT_COLOR; // patient alone, waiting on staff
    case "prepping":
      return ROLE_COLOR.nurse;
    case "with_doctor":
      return ROLE_COLOR.doctor;
  }
}

/**
 * A room's accent color follows whoever's ROLE is up next, not a specific
 * person: every provider is blue, every nurse is green, so any nurse or any
 * provider can scan the board for their own color regardless of roster size.
 */
export function personColor(room: Room): string {
  if (room.contaminated) return LOCKOUT_COLOR;
  if (room.stage === "vacant") return VACANT_COLOR;
  if (room.stage === "needs_cleanup") return HOUSEKEEPING_COLOR;
  if (room.stage === "ready_for_nurse" || room.stage === "prepping") return ROLE_COLOR.nurse;
  return ROLE_COLOR.doctor; // ready_for_doctor or with_doctor
}

/**
 * The specific named person, if the front desk assigned one; otherwise a
 * generic "Nurse needed" / "Doctor needed" so the room stays actionable even
 * when staffing hasn't been pinned to an individual.
 */
export function personLabel(
  room: Room,
  staffById: Record<string, { name: string }>
): string | null {
  if (room.contaminated || room.stage === "vacant" || room.stage === "needs_cleanup") return null;
  if (room.stage === "ready_for_nurse" || room.stage === "prepping") {
    const s = room.assigned_nurse_id ? staffById[room.assigned_nurse_id] : null;
    return s ? `Nurse: ${s.name}` : "Nurse needed";
  }
  const d = room.assigned_doctor_id ? staffById[room.assigned_doctor_id] : null;
  return d ? `Doctor: ${d.name}` : "Doctor needed";
}

export function hasUrgentRequest(room: Room, urgentKeys: string[]): boolean {
  return urgentKeys.some((k) => !!room.requests?.[k]) || room.contaminated;
}

/**
 * Picks readable body text (near-white or near-black) for a solid fill color,
 * via the standard YIQ brightness split. Needed now that board tiles fill
 * their whole background with the status color instead of just an accent.
 */
export function contrastText(hex: string): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? "#0f172a" : "#ffffff";
}

/**
 * Real idle time, not an estimate: for each named provider, the gaps between
 * the end of one "with_doctor" visit and the start of their next one, across
 * whichever rooms they were in. Only counts gaps within the same calendar
 * day, so an overnight or weekend gap between visits never inflates the
 * number. Visits left staffed as "any provider" (no specific name) aren't
 * attributable to anyone and are excluded.
 */
export function computeDoctorIdleTime(
  history: { stage: Stage; duration_ms: number; provider_name: string | null; ended_at: string }[]
): Record<string, { visits: number; idleMs: number }> {
  const byProvider: Record<string, { start: number; end: number }[]> = {};

  history.forEach((h) => {
    if (h.stage === "with_doctor" && h.provider_name) {
      const end = new Date(h.ended_at).getTime();
      const start = end - h.duration_ms;
      (byProvider[h.provider_name] ||= []).push({ start, end });
    }
  });

  const result: Record<string, { visits: number; idleMs: number }> = {};
  Object.entries(byProvider).forEach(([name, visits]) => {
    visits.sort((a, b) => a.start - b.start);
    let idleMs = 0;
    for (let i = 1; i < visits.length; i++) {
      const prev = visits[i - 1];
      const cur = visits[i];
      const sameDay = new Date(prev.end).toDateString() === new Date(cur.start).toDateString();
      if (sameDay && cur.start > prev.end) idleMs += cur.start - prev.end;
    }
    result[name] = { visits: visits.length, idleMs };
  });
  return result;
}

/** Groups the six raw stages into the three buckets the room-utilization view shows. */
export function utilizationBucket(stage: Stage): "Vacant" | "Occupied" | "Needs cleanup" {
  if (stage === "vacant") return "Vacant";
  if (stage === "needs_cleanup") return "Needs cleanup";
  return "Occupied";
}

/** Minimal CSV encoder: quotes any field containing a comma, quote, or newline. */
export function toCsv(rows: Record<string, string | number | null>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  rows.forEach((row) => lines.push(headers.map((h) => escape(row[h])).join(",")));
  return lines.join("\n");
}

/** Triggers a browser download of a CSV string — no server round trip needed. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type TimerColor = "normal" | "yellow" | "red";

/**
 * The smart white/yellow/red rule: once a stage has at least
 * MIN_SAMPLES_FOR_AVG completed instances in the trailing window, compare
 * the room's current time in that stage against the clinic's own recent
 * average for it (20% over = yellow, 50% over = red). Until there's enough
 * history, fall back to the fixed THRESH_MIN minutes so a brand new clinic
 * still gets sensible coloring on day one.
 */
export function timerColor(
  stage: Stage,
  elapsed: number,
  avgByStage: Partial<Record<Stage, number>>,
  countByStage: Partial<Record<Stage, number>>
): TimerColor {
  const avg = avgByStage[stage];
  const count = countByStage[stage] ?? 0;

  if (avg && count >= MIN_SAMPLES_FOR_AVG) {
    if (elapsed >= avg * RED_OVER_AVG) return "red";
    if (elapsed >= avg * YELLOW_OVER_AVG) return "yellow";
    return "normal";
  }

  const fallbackMin = THRESH_MIN[stage];
  if (!fallbackMin) return "normal";
  const fallbackMs = fallbackMin * 60000;
  if (elapsed >= fallbackMs * RED_OVER_AVG) return "red";
  if (elapsed >= fallbackMs) return "yellow";
  return "normal";
}
