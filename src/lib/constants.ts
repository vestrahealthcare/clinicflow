import { Stage } from "./types";

export const STAGE_LABEL: Record<Stage, string> = {
  vacant: "Vacant",
  ready_for_nurse: "Ready for nurse",
  prepping: "Nurse in room",
  ready_for_doctor: "Ready for doctor",
  with_doctor: "Doctor in room",
  needs_cleanup: "Needs cleanup"
};

// Stage the room-tablet's big button advances to, and its label. Vacant has
// none: only the front desk can move a room out of vacant (assign_patient).
// with_doctor -> vacant directly: the cleanup step is skipped on the live
// floor now (needs_cleanup -> vacant only still matters for any room that
// was already mid-cleanup before that change shipped).
export const NEXT_STAGE: Partial<Record<Stage, Stage>> = {
  ready_for_nurse: "prepping",
  prepping: "ready_for_doctor",
  ready_for_doctor: "with_doctor",
  with_doctor: "vacant",
  needs_cleanup: "vacant"
};

export const ACTION_LABEL: Partial<Record<Stage, string>> = {
  ready_for_nurse: "Start prep (nurse in room)",
  prepping: "Prep complete, ready for doctor",
  ready_for_doctor: "Start visit",
  with_doctor: "End visit",
  needs_cleanup: "Mark room clean"
};

// Minutes in a stage before the room flashes overdue on the board.
export const THRESH_MIN: Partial<Record<Stage, number>> = {
  ready_for_nurse: 5,
  prepping: 8,
  ready_for_doctor: 10,
  with_doctor: 20,
  needs_cleanup: 8
};

export const STAGE_ORDER: Stage[] = [
  "ready_for_nurse",
  "prepping",
  "ready_for_doctor",
  "with_doctor",
  "needs_cleanup"
];

export const HOUSEKEEPING_COLOR = "#8A5A34";
export const LOCKOUT_COLOR = "#B23A2C";
export const VACANT_COLOR = "#9AA6B0"; // neutral, so it never reads as "a nurse's turn"

// Fixed role colors, not per person: every provider is blue, every nurse is
// green, so anyone can scan the board for their own role regardless of how
// many providers or nurses are on the roster.
export const ROLE_COLOR = {
  doctor: "#3568C4",
  nurse: "#2F9E6E"
} as const;

export const MAX_STAFF_PER_ROLE = 20;

// Default operating hours shown on the Admin day controls; Start/End Day are
// always manual (staff press the button), this is just the expected window.
export const SCHEDULED_DAY_START = "09:00";
export const SCHEDULED_DAY_END = "17:00";

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
      { key: "chaperone", label: "Chaperone" },
      { key: "ecg", label: "ECG" },
      { key: "vitals", label: "Vitals" },
      { key: "lab", label: "Lab" },
      { key: "injection", label: "Injection" },
      { key: "dietitian", label: "Dietitian" },
      { key: "careManagement", label: "Care Management" },
      { key: "referral", label: "Referral" },
      { key: "imaging", label: "Imaging" }
    ]
  }
];
export const ALL_REQUEST_KEYS = REQUEST_GROUPS.flatMap((g) => g.items.map((i) => i.key));
export const REQUEST_LABEL: Record<string, string> = Object.fromEntries(
  REQUEST_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.label]))
);

// No login system — this is just a per-device convenience so the same
// tablet/staff member doesn't retype their name every time they post to the
// huddle board or claim a request.
export const STAFF_NAME_KEY = "clinicflow_staff_name";
