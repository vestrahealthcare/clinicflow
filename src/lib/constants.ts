import { Stage } from "./types";

export const STAGE_LABEL: Record<Stage, string> = {
  vacant: "Vacant",
  ready_for_nurse: "Ready for nurse",
  prepping: "Prepping",
  ready_for_doctor: "Ready for doctor",
  with_doctor: "Doctor in room",
  shots: "Shots",
  other: "Other (nurse task)",
  needs_cleanup: "Needs cleanup"
};

// Stage the room-tablet's big button advances to, and its label. Vacant has
// none: only the front desk can move a room out of vacant (assign_patient).
export const NEXT_STAGE: Partial<Record<Stage, Stage>> = {
  ready_for_nurse: "prepping",
  prepping: "ready_for_doctor",
  ready_for_doctor: "with_doctor",
  with_doctor: "vacant",
  shots: "vacant",
  other: "vacant"
};

export const ACTION_LABEL: Partial<Record<Stage, string>> = {
  ready_for_nurse: "Start prep (nurse in room)",
  prepping: "Prep complete, ready for doctor",
  ready_for_doctor: "Start visit",
  with_doctor: "Check-out",
  shots: "Check-out",
  other: "Check-out",
  needs_cleanup: "Mark room clean" // only for a room still left in the old cleaning step
};

// Minutes in a stage before the room flashes overdue on the board.
export const THRESH_MIN: Partial<Record<Stage, number>> = {
  ready_for_nurse: 5,
  prepping: 8,
  ready_for_doctor: 10,
  with_doctor: 20,
  shots: 10,
  other: 10
};

export const STAGE_ORDER: Stage[] = [
  "ready_for_nurse",
  "prepping",
  "ready_for_doctor",
  "with_doctor",
  "shots",
  "other"
];

export const HOUSEKEEPING_COLOR = "#8A5A34";
export const LOCKOUT_COLOR = "#B23A2C";
export const VACANT_COLOR = "#9AA6B0"; // neutral, so it never reads as "a nurse's turn"

// Fixed role colors, not per person: every provider is blue, every nurse is
// green, so anyone can scan the board for their own role regardless of how
// many providers or nurses are on the roster.
export const ROLE_COLOR = {
  doctor: "#3568C4",
  nurse: "#2F9E6E",
  frontdesk: "#64748B"
} as const;

// Roster size limits per group (providers stay at 6, nurses and front desk up to 20).
export const MAX_STAFF: Record<"doctor" | "nurse" | "frontdesk", number> = {
  doctor: 6,
  nurse: 20,
  frontdesk: 20
};

// Fishbowl square colors. The whole square is one solid color:
//   vacant white, occupied light gray, ready for doctor blue, contamination lockout red.
export const BOX_COLOR = {
  vacant: "#FFFFFF",
  occupied: "#E2E8F0",
  readyForDoctor: "#60A5FA",
  lockout: "#EF4444"
} as const;

// Fishbowl flash colors: the whole square blinks between its own color and the flash color
// (or white, when the flash color is the same as the square). Tests and support requests
// blue, Shots pink, messages orange, contamination lockout red. Follow ups never flash.
export const FLASH_COLOR = {
  support: "#60A5FA",
  shots: "#F472B6",
  message: "#FB923C",
  lockout: "#EF4444"
} as const;

// Smart overdue coloring: white/default while normal, yellow once a room is
// running meaningfully over the clinic's own recent average for that step,
// red once it's running well over. Falls back to fixed minute thresholds
// (THRESH_MIN) until a stage has enough completed samples to trust its
// average.
export const YELLOW_OVER_AVG = 1.2; // 20% over average
export const RED_OVER_AVG = 1.5; // 50% over average
export const MIN_SAMPLES_FOR_AVG = 20;
export const AVG_WINDOW_DAYS = 30;

export interface RequestDef {
  key: string;
  label: string;
}
export const REQUEST_GROUPS: { title: string; items: RequestDef[] }[] = [
  {
    title: "Quick tests",
    items: [
      { key: "rsv", label: "RSV" },
      { key: "flu", label: "Flu" },
      { key: "strep", label: "Strep" },
      { key: "covid", label: "COVID" }
    ]
  },
  {
    title: "Clinical support",
    items: [
      { key: "nurse", label: "Call nurse" },
      { key: "vitals", label: "Vitals" },
      { key: "hgb", label: "Hgb" },
      { key: "fluoride", label: "Fluoride" },
      { key: "glucose", label: "Glucose" },
      { key: "urinalysis", label: "Urinalysis" },
      { key: "hcg", label: "HCG" },
      { key: "throat_culture", label: "Throat culture" },
      { key: "strep_culture", label: "Strep culture" },
      { key: "viral_panel", label: "Viral panel" },
      { key: "sendout_lab", label: "Send out lab" },
      { key: "nebulizer", label: "Nebulizer" }
    ]
  }
];
export const ALL_REQUEST_KEYS = REQUEST_GROUPS.flatMap((g) => g.items.map((i) => i.key));
export const REQUEST_LABEL: Record<string, string> = Object.fromEntries(
  REQUEST_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.label]))
);

// Urgent flags that should flash on the central board (per Nick: flash, no sound).

// Every request, a message, the Shots stage and a follow up request flash the
// room on the board until someone taps "I've got it" (see attentionItems in util.ts).

// Running timers show from the moment a room enters a step (0). Set to 5 to hide them
// until a room has been in its step 5 minutes.
export const TIMER_VISIBLE_AFTER_MIN = 0;

export const FOLLOWUP_TIMEFRAMES: { key: "1_week" | "3_months" | "6_months" | "other"; label: string }[] = [
  { key: "1_week", label: "1 week" },
  { key: "3_months", label: "3 months" },
  { key: "6_months", label: "6 months" },
  { key: "other", label: "Other" }
];
export const FOLLOWUP_REASONS: { key: "weight_check" | "asthma" | "medication_fu" | "wcc" | "generic"; label: string }[] = [
  { key: "weight_check", label: "Weight check" },
  { key: "asthma", label: "Asthma" },
  { key: "medication_fu", label: "Medication f/u" },
  { key: "wcc", label: "WCC" },
  { key: "generic", label: "Generic" }
];
export const FOLLOWUP_TIMEFRAME_LABEL: Record<string, string> = Object.fromEntries(
  FOLLOWUP_TIMEFRAMES.map((t) => [t.key, t.label])
);
export const FOLLOWUP_REASON_LABEL: Record<string, string> = Object.fromEntries(
  FOLLOWUP_REASONS.map((r) => [r.key, r.label])
);
// Tests whose results may still be pending when the patient leaves. If any of
// these are still marked on the room at "Pt departed", the room asks whether to
// add the patient to the "Call with results" list.
export const TEST_KEYS = ["rsv", "flu", "strep", "covid"];

// Requests that create a DLO pickup reminder (sample goes in the pickup box,
// and someone calls DLO to come get it).
export const LAB_PICKUP_KEYS = ["throat_culture", "strep_culture", "viral_panel", "sendout_lab"];

// Call with results timers (minutes). Placeholders until we know how long the
// molecular tests really take at Red Berry; adjust here.
export const CALLBACK_WAITING_YELLOW_MIN = 30;
export const CALLBACK_WAITING_RED_MIN = 60;
export const CALLBACK_READY_YELLOW_MIN = 10;
export const CALLBACK_READY_RED_MIN = 30;
