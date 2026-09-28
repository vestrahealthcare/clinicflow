export type Stage =
  | "vacant"
  | "ready_for_nurse"
  | "prepping"
  | "ready_for_doctor"
  | "with_doctor"
  | "needs_cleanup";

export type StaffRole = "nurse" | "doctor";

export interface Staff {
  id: string;
  clinic_id: string;
  name: string;
  role: StaffRole;
  color: string;
  sort_order: number;
}

export interface Clinic {
  id: string;
  slug: string;
  name: string;
  room_count: number;
  next_ticket_num: number;
}

export interface RequestFlags {
  rsv?: boolean;
  flu?: boolean;
  strep?: boolean;
  covid?: boolean;
  nurse?: boolean;
  chaperone?: boolean;
  ecg?: boolean;
  vitals?: boolean;
  nextPatient?: boolean;
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
  flashing: boolean;
  /** Patient identifier (initials, etc). Persists across a vacancy on
   *  purpose — only replaced when the next patient is assigned. */
  patient_label: string | null;
  provider_finished_at: string | null;
  updated_at: string;
}

/** One trackable/claimable request instance — replaces the old boolean
 *  `Room.requests` flags. "Active" = cleared_at null. "Unclaimed" = active
 *  and acknowledged_at null (this is what keeps a room flashing). */
export interface RoomRequest {
  id: string;
  clinic_id: string;
  room_id: string;
  key: string;
  created_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  cleared_at: string | null;
}

export interface HuddlePost {
  id: string;
  clinic_id: string;
  author: string;
  body: string;
  category: "today" | "week";
  pinned: boolean;
  created_at: string;
}

export interface ClinicDay {
  id: string;
  clinic_id: string;
  day_date: string;
  scheduled_start: string;
  scheduled_end: string;
  opened_at: string | null;
  closed_at: string | null;
  total_visits: number | null;
  avg_ready_for_nurse_ms: number | null;
  avg_prepping_ms: number | null;
  avg_ready_for_doctor_ms: number | null;
  avg_with_doctor_ms: number | null;
  avg_needs_cleanup_ms: number | null;
}

export interface RoomHistoryRow {
  id: string;
  clinic_id: string;
  room_id: string;
  stage: Stage;
  duration_ms: number;
  provider_name: string | null;
  nurse_name: string | null;
  ended_at: string;
}

export interface CallRow {
  id: string;
  clinic_id: string;
  room_id: string;
  ticket: string;
  called_at: string;
}

/** Result row shape of get_provider_stats / get_nurse_stats RPCs. */
export interface StaffStatRow {
  provider_name?: string;
  nurse_name?: string;
  visits: number;
  avg_ms: number;
  p50_ms: number;
  p90_ms: number;
}

/** Result row shape of get_stage_percentiles. */
export interface StagePercentileRow {
  stage: Stage;
  n: number;
  avg_ms: number;
  p50_ms: number;
  p90_ms: number;
}

/** Result row shape of get_room_utilization. */
export interface RoomUtilizationRow {
  room_id: string;
  room_name: string;
  stage: Stage;
  total_ms: number;
}
