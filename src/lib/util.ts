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
 * A room's accent color follows whoever's ROLE is up next, not a specific
 * person: every provider is blue, every nurse is green, so any nurse or any
 * provider can scan the board for their own color regardless of roster size.
 */
export function personColor(room: Room): string {
  if (room.contaminated) return LOCKOUT_COLOR;
  if (room.stage === "vacant") return VACANT_COLOR;
  if (room.stage === "needs_cleanup") return HOUSEKEEPING_COLOR;
  if (
    room.stage === "ready_for_nurse" ||
    room.stage === "prepping" ||
    room.stage === "shots" ||
    room.stage === "other"
  )
    return ROLE_COLOR.nurse;
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
  if (
    room.stage === "ready_for_nurse" ||
    room.stage === "prepping" ||
    room.stage === "shots" ||
    room.stage === "other"
  ) {
    const s = room.assigned_nurse_id ? staffById[room.assigned_nurse_id] : null;
    // Once prep has been started the nurse is in the room, so say so.
    if (room.stage === "prepping") return s ? `Nurse in progress: ${s.name}` : "Nurse in progress";
    return s ? `Nurse: ${s.name}` : "Nurse needed";
  }
  const d = room.assigned_doctor_id ? staffById[room.assigned_doctor_id] : null;
  return d ? `Doctor: ${d.name}` : "Doctor needed";
}

export function hasUrgentRequest(room: Room, urgentKeys: string[]): boolean {
  return urgentKeys.some((k) => !!room.requests?.[k]) || room.contaminated;
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

/** Today's date (YYYY-MM-DD) in the clinic's time zone, matching the database's pickup_date. */
export function clinicToday(timezone: string | undefined): string {
  return dateKeyInTz(new Date(), timezone);
}

/** YYYY-MM-DD of any moment, in the clinic's time zone. */
export function dateKeyInTz(when: Date | string, timezone: string | undefined): string {
  const d = typeof when === "string" ? new Date(when) : when;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}
