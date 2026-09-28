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
  updated_at: string;
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
  ended_at: string;
}

export interface CallRow {
  id: string;
  clinic_id: string;
  room_id: string;
  ticket: string;
  called_at: string;
}
