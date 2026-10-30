export type Stage =
  | "vacant"
  | "ready_for_nurse"
  | "prepping"
  | "ready_for_doctor"
  | "with_doctor"
  | "shots"
  | "other"
  | "needs_cleanup"
  /** The 2 minutes after check out. The board shows "Turning over", then the room shows as vacant. */
  | "turnover";

export type StaffRole = "nurse" | "doctor" | "frontdesk";

export interface Staff {
  id: string;
  clinic_id: string;
  name: string;
  role: StaffRole;
  color: string;
  sort_order: number;
  /** Provider name color on the board and room pages (hex), set in Admin. */
  name_color?: string | null;
}

export interface Hallway {
  id: string;
  clinic_id: string;
  key: string;
  label: string;
  color: string;
  sort_order: number;
}

export interface Clinic {
  id: string;
  slug: string;
  name: string;
  room_count: number;
  next_ticket_num: number;
  timezone?: string;
  /** The 30 day timing averages only count visits after this moment (Admin reset). */
  averages_reset_at?: string | null;
  /** Yellow and red minutes per step, editable in Admin. */
  timer_targets?: TimerTargets | null;
}

export type TimerStage = "ready_for_nurse" | "prepping" | "ready_for_doctor" | "with_doctor" | "shots" | "other";
export type TimerTargets = Record<TimerStage, { yellow: number; red: number }>;

export interface RequestFlags {
  rsv?: boolean;
  flu?: boolean;
  strep?: boolean;
  covid?: boolean;
  nurse?: boolean;
  vitals?: boolean;
  hgb?: boolean;
  fluoride?: boolean;
  glucose?: boolean;
  urinalysis?: boolean;
  hcg?: boolean;
  throat_culture?: boolean;
  strep_culture?: boolean;
  viral_panel?: boolean;
  sendout_lab?: boolean;
  nebulizer?: boolean;
  [key: string]: boolean | undefined;
}

export interface Room {
  id: string;
  clinic_id: string;
  room_number: number;
  name: string;
  hallway_id: string | null;
  side: "left" | "right";
  stage: Stage;
  stage_started_at: string;
  contaminated: boolean;
  assigned_nurse_id: string | null;
  assigned_doctor_id: string | null;
  ticket: string | null;
  note: string | null;
  requests: RequestFlags;
  /** Patient initials from check in; cleared at check-out. */
  initials: string | null;
  /** Door directions shown to patients, editable in Admin. */
  directions: string | null;
  /** Who tapped "I've got it", keyed by request key, "note", "shots" or "followup". */
  claims: Record<string, string>;
  /** Follow up requested from the room, moves to the check-out list at check-out. */
  followup: { timeframe: FollowupTimeframe; reason: FollowupReason; note?: string } | null;
  /** The nurse who tapped Start prep, shown while the room is in Prepping. */
  prep_by?: string | null;
  /** The provider for this patient's visit (can differ from the room's usual provider). */
  visit_doctor_id?: string | null;
  visit_started_at?: string | null;
  visit_id?: string | null;
  /** Saved copy of the last visit for "Undo check out" during turnover. */
  undo?: Record<string, unknown> | null;
  updated_at: string;
}

export type FollowupTimeframe = "1_week" | "3_months" | "6_months" | "other";
export type FollowupReason = "weight_check" | "asthma" | "medication_fu" | "wcc" | "generic";

/** A patient who checked out and is back in the waiting room until "Pt departed". */
export interface Checkout {
  id: string;
  clinic_id: string;
  room_name: string | null;
  ticket: string | null;
  initials: string | null;
  followup_timeframe: FollowupTimeframe | null;
  followup_reason: FollowupReason | null;
  followup_note: string | null;
  followup_claimed_by: string | null;
  checked_out_at: string;
  departed_at: string | null;
}

export interface RoomHistoryRow {
  id: string;
  clinic_id: string;
  room_id: string;
  stage: Stage;
  duration_ms: number;
  provider_name: string | null;
  ended_at: string;
}

export interface CallRow {
  id: string;
  clinic_id: string;
  room_id: string;
  ticket: string;
  initials: string | null;
  called_at: string;
}

export type SampleType = "throat_culture" | "strep_culture" | "viral_panel" | "sendout_lab";

/** A lab sample waiting for DLO pickup. No patient name: ticket and room only. */
export interface LabSample {
  id: string;
  clinic_id: string;
  room_id: string | null;
  room_name: string | null;
  ticket: string | null;
  initials: string | null;
  sample_type: SampleType;
  pickup_date: string; // YYYY-MM-DD in the clinic's time zone
  requested_at: string;
  boxed_at: string | null;
}

export interface LabPickup {
  id: string;
  clinic_id: string;
  pickup_date: string;
  dlo_called_at: string | null;
}

export type CallbackStatus = "waiting" | "ready" | "called";

/** A patient who left while rapid or molecular tests were still running. */
export interface ResultCallback {
  id: string;
  clinic_id: string;
  room_id: string | null;
  room_name: string | null;
  ticket: string | null;
  initials: string | null;
  tests: string[];
  /** Free text results typed by staff. */
  result_note: string | null;
  status: CallbackStatus;
  departed_at: string;
  ready_at: string | null;
  called_at: string | null;
}

/** One row of Tracker data: a day, a provider, counts and time totals (see tracker_data in the SQL). */
export interface TrackerRow {
  visit_date: string;
  provider_name: string | null;
  after_reset: boolean;
  visits: number;
  /** Visits recorded live (not filled in from older history); only these have swabs and step times. */
  new_visits: number;
  d2d_sum: number | null;
  d2d_n: number;
  rfn_sum: number | null;
  rfn_n: number;
  prep_sum: number | null;
  prep_n: number;
  rfd_sum: number | null;
  rfd_n: number;
  wd_sum: number | null;
  wd_n: number;
  sh_sum: number | null;
  sh_n: number;
  ot_sum: number | null;
  ot_n: number;
  sw_rsv: number;
  sw_flu: number;
  sw_strep: number;
  sw_covid: number;
  sw_throat_culture: number;
  sw_strep_culture: number;
  sw_viral_panel: number;
}

export interface TrackerData {
  reset_at: string | null;
  rows: TrackerRow[];
}
