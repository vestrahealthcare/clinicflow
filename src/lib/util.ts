import { Hallway, Room, Stage, Staff, TimerStage, TimerTargets } from "./types";
import {
  BOX_COLOR,
  FLASH_COLOR,
  DEFAULT_TIMER_TARGETS,
  ANY_PROVIDER_COLOR,
  TURNOVER_MS,
  HOUSEKEEPING_COLOR,
  VACANT_COLOR,
  LOCKOUT_COLOR,
  ROLE_COLOR,
  ALL_REQUEST_KEYS,
  REQUEST_LABEL,
  FOLLOWUP_TIMEFRAME_LABEL,
  FOLLOWUP_REASON_LABEL
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
 * "Overdue" (flagging on lists): the room has been in its step longer than the
 * red minutes set for that step in Admin (Timer colors).
 */
export function isOverdue(room: Room, targets?: TimerTargets | null): boolean {
  if (room.contaminated) return false;
  const t = (targets ?? DEFAULT_TIMER_TARGETS)[room.stage as TimerStage];
  if (!t) return false;
  return elapsedMs(room) > t.red * 60000;
}

/** Seconds left in a room's 2 minute turnover (0 when it is over or the room is not turning over). */
export function turnoverMsLeft(room: Room): number {
  if (room.stage !== "turnover") return 0;
  return Math.max(0, TURNOVER_MS - elapsedMs(room));
}

/** Timer targets with any missing step filled in from the starting values. */
export function mergeTimerTargets(t: Partial<TimerTargets> | null | undefined): TimerTargets {
  const out = { ...DEFAULT_TIMER_TARGETS } as TimerTargets;
  (Object.keys(out) as TimerStage[]).forEach((k) => {
    const v = t?.[k];
    if (v && Number.isFinite(Number(v.yellow)) && Number.isFinite(Number(v.red))) {
      out[k] = { yellow: Number(v.yellow), red: Number(v.red) };
    }
  });
  return out;
}

/**
 * A room's accent color follows whoever's ROLE is up next, not a specific
 * person: every provider is blue, every nurse is green, so any nurse or any
 * provider can scan the board for their own color regardless of roster size.
 */
export function personColor(room: Room): string {
  if (room.contaminated) return LOCKOUT_COLOR;
  if (room.stage === "vacant") return VACANT_COLOR;
  if (room.stage === "turnover") return VACANT_COLOR;
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
  if (room.contaminated || room.stage === "vacant" || room.stage === "needs_cleanup" || room.stage === "turnover")
    return null;
  if (
    room.stage === "ready_for_nurse" ||
    room.stage === "prepping" ||
    room.stage === "shots" ||
    room.stage === "other"
  ) {
    const s = room.assigned_nurse_id ? staffById[room.assigned_nurse_id] : null;
    // Once prep has been started the nurse is in the room, so say which nurse tapped Start prep.
    if (room.stage === "prepping") {
      const who = room.prep_by || s?.name;
      return who ? `Nurse in progress: ${who}` : "Nurse in progress";
    }
    return s ? `Nurse: ${s.name}` : "Nurse needed";
  }
  // The provider's name is shown separately (providerTag), so Doctor in room needs no extra label.
  if (room.stage === "with_doctor") return null;
  return "Doctor needed";
}

export interface ProviderTag {
  name: string;
  color: string;
  /** Show on a near black tag instead of a white one. */
  dark?: boolean;
}

/** staff.name_color is "#RRGGBB" (white tag) or "dark:#RRGGBB" (dark tag). */
export function parseNameColor(v: string | null | undefined): { hex: string | null; dark: boolean } {
  if (!v) return { hex: null, dark: false };
  if (v.startsWith("dark:")) return { hex: v.slice(5) || null, dark: true };
  return { hex: v, dark: false };
}

/**
 * The provider for this patient's visit, shown on the square and room page for the whole
 * visit: the visit's own provider, or the room's usual provider when the visit has none,
 * or "Any provider". Null when the room has no patient.
 */
export function providerTag(room: Room, staffById: Record<string, Staff>): ProviderTag | null {
  if (room.contaminated || room.stage === "vacant" || room.stage === "turnover" || room.stage === "needs_cleanup") {
    return null;
  }
  const id = room.visit_doctor_id ?? null;
  const s = id ? staffById[id] : null;
  if (!s) return { name: "Any provider", color: ANY_PROVIDER_COLOR };
  const { hex, dark } = parseNameColor(s.name_color);
  return { name: s.name, color: hex || ANY_PROVIDER_COLOR, dark: !!hex && dark };
}

export interface AttentionItem {
  /** Key used for "I've got it": a request key, "note", "shots" or "followup". */
  key: string;
  label: string;
  claimedBy: string | null;
  /** Extra free text, such as the note typed on a follow up request. */
  detail?: string;
  /** Which flash color this item triggers while unclaimed; none for follow ups. */
  flash?: FlashKind;
}

export type FlashKind = "shots" | "support" | "message";

/**
 * Everything on a room that is calling for someone: each tapped request, a
 * message, the Shots stage, and a follow up request. Each one flashes the room
 * until a named person taps "I've got it".
 */
export function attentionItems(room: Room): AttentionItem[] {
  if (room.contaminated || room.stage === "vacant" || room.stage === "turnover") return [];
  const claims = room.claims ?? {};
  const items: AttentionItem[] = [];
  if (room.stage === "shots")
    items.push({ key: "shots", label: "Shots", claimedBy: claims.shots ?? null, flash: "shots" });
  ALL_REQUEST_KEYS.filter((k) => room.requests?.[k]).forEach((k) =>
    items.push({ key: k, label: REQUEST_LABEL[k] ?? k, claimedBy: claims[k] ?? null, flash: "support" })
  );
  if (room.followup) {
    items.push({
      key: "followup",
      label: `Schedule follow up: ${FOLLOWUP_TIMEFRAME_LABEL[room.followup.timeframe] ?? room.followup.timeframe}, ${
        FOLLOWUP_REASON_LABEL[room.followup.reason] ?? room.followup.reason
      }`,
      claimedBy: claims.followup ?? null,
      detail: room.followup.note || undefined
    });
  }
  if (room.note) items.push({ key: "note", label: "Message", claimedBy: claims.note ?? null, flash: "message" });
  return items;
}

/**
 * What a room is flashing for, or null. Priority when several are waiting:
 * contamination lockout (red), Shots (pink), then tests, support and messages (yellow).
 * Each flash stops once its item has an "I've got it". Follow ups never flash.
 */
export function flashKind(room: Room): "lockout" | FlashKind | null {
  if (room.contaminated) return "lockout";
  const open = attentionItems(room).filter((i) => i.flash && !i.claimedBy);
  for (const kind of ["shots", "support", "message"] as FlashKind[]) {
    if (open.some((i) => i.flash === kind)) return kind;
  }
  return null;
}

/** CSS class that makes a room card flash in the right color. */
export const FLASH_CLASS: Record<"lockout" | FlashKind, string> = {
  lockout: "flash-urgent",
  shots: "flash-pink",
  support: "flash-yellow",
  message: "flash-yellow"
};

/** The solid color of a room's square on the Fishbowl board. */
export function boxColor(room: Room): string {
  if (room.contaminated) return BOX_COLOR.lockout;
  if (room.stage === "vacant" || room.stage === "turnover") return BOX_COLOR.vacant;
  if (room.stage === "ready_for_doctor") return BOX_COLOR.readyForDoctor;
  return BOX_COLOR.occupied;
}

/**
 * The two colors a flashing square blinks between: its own color, and the flash color.
 * When the flash color is the same as the square (a lockout on the red square) it blinks to white instead so it still shows.
 */
export function flashColors(room: Room, kind: "lockout" | FlashKind): [string, string] {
  const base = boxColor(room);
  const flash = FLASH_COLOR[kind];
  return [base, flash.toLowerCase() === base.toLowerCase() ? "#FFFFFF" : flash];
}

/** True when the room should flash on the board. */
export function needsAttention(room: Room): boolean {
  return flashKind(room) !== null;
}

/** What to tell a patient about where the room is. Falls back to hallway and side until directions are set. */
export function roomDirections(room: Room, hallway?: Hallway | null): string {
  if (room.directions) return room.directions;
  const side = room.side === "left" ? "left" : "right";
  return hallway ? `${hallway.label}, ${side} side` : `${side} side`;
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

/** Fixed rule: yellow after the step's yellow minutes, red after its red minutes (set in Admin). */
export function timerColor(stage: Stage, elapsed: number, targets?: TimerTargets | null): TimerColor {
  const t = (targets ?? DEFAULT_TIMER_TARGETS)[stage as TimerStage];
  if (!t) return "normal";
  if (elapsed >= t.red * 60000) return "red";
  if (elapsed >= t.yellow * 60000) return "yellow";
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
