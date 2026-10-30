"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import {
  Clinic,
  Hallway,
  Staff,
  Room,
  RoomHistoryRow,
  Stage,
  StaffRole,
  LabSample,
  LabPickup,
  ResultCallback,
  CallbackStatus,
  Checkout,
  FollowupTimeframe,
  FollowupReason,
  TimerTargets,
  TrackerData
} from "./types";
import { clinicToday, dateKeyInTz, mergeTimerTargets } from "./util";
import { MAX_STAFF, ROLE_COLOR, TURNOVER_MS } from "./constants";

const HISTORY_DAYS = 30;
const UPDATE_FILE = "clinicflow-update-4-2026-10-30.sql";

function missingFunction(err: { code?: string; message: string }, name: string): boolean {
  return err.code === "PGRST202" || err.code === "42883" || new RegExp(`${name}|schema cache`, "i").test(err.message);
}

const NEEDS_UPDATE = `The database update is missing. Run ${UPDATE_FILE} in the Supabase SQL Editor, then try again.`;

/**
 * A realtime subscription that rebuilds itself: if the connection errors, times out or closes,
 * it quietly subscribes again after 5 seconds, and calls onSubscribed every time it connects
 * so the screen can fetch anything it missed.
 */
function useLiveChannel(
  key: string | null,
  build: (ch: RealtimeChannel) => RealtimeChannel,
  onSubscribed: () => void
) {
  const buildRef = useRef(build);
  buildRef.current = build;
  const subRef = useRef(onSubscribed);
  subRef.current = onSubscribed;
  useEffect(() => {
    if (!key) return;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let kill: (() => void) | null = null;

    function connect() {
      if (disposed) return;
      let dead = false;
      const ch = buildRef.current(supabase.channel(`${key}-${Math.random().toString(36).slice(2, 8)}`));
      kill = () => {
        dead = true;
        supabase.removeChannel(ch);
      };
      ch.subscribe((status) => {
        if (dead || disposed) return;
        if (status === "SUBSCRIBED") {
          subRef.current();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          clearTimeout(retry);
          retry = setTimeout(() => {
            kill?.();
            connect();
          }, 5000);
        }
      });
    }
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      kill?.();
    };
  }, [key]);
}

export interface AdvanceOptions {
  /** From "with_doctor" only: "shots" or "other". Without it, use checkOut to end the visit. */
  target?: Stage;
  /** The stage the tablet was showing when tapped; the tap is ignored if the room has already moved on. */
  expected?: Stage;
  /** On departure, add the patient to the "Call with results" list if tests are still pending. */
  addCallback?: boolean;
  /** Name of the person tapping the button (shown as the prep nurse when Start prep is tapped). */
  actor?: string;
}

interface ClinicActions {
  advanceStage: (roomId: string, opts?: AdvanceOptions) => Promise<void>;
  /** Check-out: the patient goes to the waiting room list and the room shows Turning over for 2 minutes. */
  checkOut: (roomId: string, opts?: { expected?: Stage; addCallback?: boolean }) => Promise<void>;
  setFollowup: (
    roomId: string,
    timeframe: FollowupTimeframe | null,
    reason: FollowupReason | null,
    note?: string
  ) => Promise<void>;
  /** Free text results typed on a Call with results task. */
  setCallbackNote: (callbackId: string, note: string) => Promise<void>;
  /** Go back one step in the room (timer resumes from the earlier step's original start). Returns an error or null. */
  goBack: (roomId: string, expected: Stage) => Promise<string | null>;
  /** Undo check out, within the 2 minute Turning over. Returns an error or null. */
  undoCheckout: (roomId: string) => Promise<string | null>;
  /** Change the provider for this visit only (null = any provider). */
  setVisitProvider: (roomId: string, doctorId: string | null) => Promise<string | null>;
  /** Yellow and red minutes for each step. */
  setTimerTargets: (targets: TimerTargets) => Promise<string | null>;
  /** The Admin Tracker numbers for a date (YYYY-MM-DD) and everything before it. */
  getTrackerData: (day: string) => Promise<{ data: TrackerData | null; error: string | null }>;
  /** Pick the color of a provider's name (hex), or null to clear. */
  setStaffColor: (staffId: string, color: string | null) => Promise<void>;
  /** Fetch rooms, staff, settings and lists again right now. */
  refresh: () => Promise<void>;
  /** Change room: moves the patient to a vacant room. Returns an error message, or null when it worked. */
  swapRoom: (fromRoomId: string, toRoomId: string) => Promise<string | null>;
  /** Restart the Tracker's 30 day columns from now (old data is kept). */
  resetAverages: () => Promise<void>;
  /** Permanently erase all timing history and all Tracker data. Cannot be undone. */
  eraseTimingHistory: () => Promise<void>;
  /** Start of day: every room (not in lockout) back to vacant, checkout list cleared, ticket numbers restart. */
  resetDay: () => Promise<void>;
  /** "I've got it": pass the person's name, or an empty name to undo. */
  claim: (roomId: string, key: string, name: string) => Promise<void>;
  claimCheckoutFollowup: (checkoutId: string, name: string) => Promise<void>;
  departCheckout: (checkoutId: string) => Promise<void>;
  setDirections: (roomId: string, text: string) => Promise<void>;
  setSampleBoxed: (sampleId: string, boxed: boolean) => Promise<void>;
  removeSample: (sampleId: string) => Promise<void>;
  setDloCalled: (called: boolean) => Promise<void>;
  setCallbackStatus: (callbackId: string, status: CallbackStatus) => Promise<void>;
  removeCallback: (callbackId: string) => Promise<void>;
  setLockout: (roomId: string, on: boolean) => Promise<void>;
  toggleRequest: (roomId: string, key: string) => Promise<void>;
  setNote: (roomId: string, note: string | null) => Promise<void>;
  /** Returns the new ticket, or an error message to show the person (never fails silently). */
  assignPatient: (
    roomId: string,
    initials: string,
    /** Provider for this visit: id, null for any provider, or undefined to keep the room's provider. */
    doctorId?: string | null
  ) => Promise<{ ticket: string | null; error: string | null }>;
  setStaffing: (roomId: string, nurseId: string | null, doctorId: string | null) => Promise<void>;
  setRoomCount: (count: number) => Promise<void>;
  addStaff: (role: StaffRole) => Promise<string | null>; // returns an error message, or null on success
  renameStaff: (staffId: string, name: string) => Promise<void>;
  removeStaff: (staffId: string) => Promise<void>;
}

export interface FollowupSummary {
  /** Samples requested today (clinic time), boxed or not. */
  todaySamples: LabSample[];
  /** Samples from earlier days that were never marked as boxed. */
  earlierOpenSamples: LabSample[];
  /** When someone called DLO today, if they have. */
  dloCalledAt: string | null;
  /** Patients left, waiting on results. */
  waitingCallbacks: ResultCallback[];
  /** Results are in, patient still needs a call. */
  readyCallbacks: ResultCallback[];
  /** Patients called today. */
  doneTodayCallbacks: ResultCallback[];
  /** Number shown on the "Lab and calls" tab: unboxed samples, DLO not called, results ready. */
  attentionCount: number;
}

interface ClinicContextValue {
  /** Who is using this device ("I am" at the top of every page). Empty until set. */
  me: string;
  setMe: (name: string) => void;
  clinic: Clinic | null;
  followups: FollowupSummary;
  /** Patients checked out and still in the waiting room (not yet "Pt departed"), oldest first. */
  checkouts: Checkout[];
  hallways: Hallway[];
  staff: Staff[];
  staffById: Record<string, Staff>;
  rooms: Room[];
  /** Completed stage instances in the last 30 days (Admin, provider idle time). */
  history: RoomHistoryRow[];
  /** Yellow and red minutes per step (Admin, Timer colors). */
  timerTargets: TimerTargets;
  /** When this screen last got fresh data from the database (ms since 1970), or null. */
  lastSyncAt: number | null;
  loading: boolean;
  error: string | null;
  actions: ClinicActions;
}

const ClinicContext = createContext<ClinicContextValue | null>(null);

const ME_KEY = "clinicflow.me";

export function ClinicProvider({ slug, children }: { slug: string; children: React.ReactNode }) {
  const [me, setMeState] = useState("");
  useEffect(() => {
    try {
      setMeState(window.localStorage.getItem(ME_KEY) ?? "");
    } catch {
      // blocked storage: the name just is not remembered
    }
  }, []);
  const setMe = useCallback((name: string) => {
    const clean = name.trim().slice(0, 40);
    setMeState(clean);
    try {
      if (clean) window.localStorage.setItem(ME_KEY, clean);
      else window.localStorage.removeItem(ME_KEY);
    } catch {
      // ignore
    }
  }, []);
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [hallways, setHallways] = useState<Hallway[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [history, setHistory] = useState<RoomHistoryRow[]>([]);
  const [labSamples, setLabSamples] = useState<LabSample[]>([]);
  const [labPickups, setLabPickups] = useState<LabPickup[]>([]);
  const [callbacks, setCallbacks] = useState<ResultCallback[]>([]);
  const [checkouts, setCheckouts] = useState<Checkout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [expiredKey, setExpiredKey] = useState("");
  const clinicRef = useRef<Clinic | null>(null);
  clinicRef.current = clinic;
  const lastRefreshStart = useRef(0);

  const loadHistory = useCallback(async (clinicId: string, resetAt?: string | null) => {
    // The last 30 days, or since the Admin "reset averages" button was pressed if that is later.
    let sinceMs = Date.now() - HISTORY_DAYS * 24 * 3600 * 1000;
    if (resetAt) sinceMs = Math.max(sinceMs, new Date(resetAt).getTime());
    const since = new Date(sinceMs).toISOString();
    const { data } = await supabase
      .from("room_history")
      .select("*")
      .eq("clinic_id", clinicId)
      .gte("ended_at", since)
      .order("ended_at", { ascending: false })
      .limit(5000);
    setHistory((data as RoomHistoryRow[]) ?? []);
  }, []);

  // DLO pickup list and "call with results" list. Small tables, so a refetch
  // after any change (or every 30s as a safety net) is simpler than patching rows.
  const loadFollowups = useCallback(async (clinicId: string, timezone: string | undefined) => {
    const today = clinicToday(timezone);
    const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const [samples, pickups, cbs, outs] = await Promise.all([
      supabase
        .from("lab_samples")
        .select("*")
        .eq("clinic_id", clinicId)
        .or(`pickup_date.eq.${today},and(boxed_at.is.null,pickup_date.lt.${today})`)
        .order("requested_at"),
      supabase.from("lab_pickups").select("*").eq("clinic_id", clinicId).eq("pickup_date", today),
      supabase
        .from("result_callbacks")
        .select("*")
        .eq("clinic_id", clinicId)
        .or(`status.neq.called,called_at.gte.${twoDaysAgo}`)
        .order("departed_at"),
      supabase
        .from("checkouts")
        .select("*")
        .eq("clinic_id", clinicId)
        .is("departed_at", null)
        .order("checked_out_at")
    ]);
    if (!samples.error) setLabSamples((samples.data as LabSample[]) ?? []);
    if (!pickups.error) setLabPickups((pickups.data as LabPickup[]) ?? []);
    if (!cbs.error) setCallbacks((cbs.data as ResultCallback[]) ?? []);
    if (!outs.error) setCheckouts((outs.data as Checkout[]) ?? []);
  }, []);

  // Initial load.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const { data: clinicRow, error: clinicErr } = await supabase
        .from("clinics")
        .select("*")
        .eq("slug", slug)
        .single();

      if (clinicErr || !clinicRow) {
        if (!cancelled) {
          setError(
            clinicErr
              ? `Could not load clinic "${slug}": ${clinicErr.message}`
              : `No clinic found for slug "${slug}". Check the clinics table.`
          );
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;
      setClinic(clinicRow as Clinic);

      const [{ data: hallwayRows }, { data: staffRows }, { data: roomRows }] = await Promise.all([
        supabase.from("hallways").select("*").eq("clinic_id", clinicRow.id).order("sort_order"),
        supabase.from("staff").select("*").eq("clinic_id", clinicRow.id).order("sort_order"),
        supabase.from("rooms").select("*").eq("clinic_id", clinicRow.id).order("room_number")
      ]);

      if (cancelled) return;
      setHallways((hallwayRows as Hallway[]) ?? []);
      setStaff((staffRows as Staff[]) ?? []);
      setRooms((roomRows as Room[]) ?? []);
      await Promise.all([
        loadHistory(clinicRow.id, (clinicRow as Clinic).averages_reset_at),
        loadFollowups(clinicRow.id, (clinicRow as Clinic).timezone)
      ]);
      if (!cancelled) {
        setLoading(false);
        setLastSyncAt(Date.now());
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug, loadHistory, loadFollowups]);

  // Fetch rooms, staff, settings and the lists again. Runs every 30 seconds, when the tab comes
  // back or the network returns, and whenever a live connection (re)connects, so a screen that
  // missed live updates catches up on its own.
  const refreshAll = useCallback(async () => {
    const c = clinicRef.current;
    if (!c) return;
    if (Date.now() - lastRefreshStart.current < 1500) return;
    lastRefreshStart.current = Date.now();
    try {
      const [cl, ro, st] = await Promise.all([
        supabase.from("clinics").select("*").eq("id", c.id).single(),
        supabase.from("rooms").select("*").eq("clinic_id", c.id).order("room_number"),
        supabase.from("staff").select("*").eq("clinic_id", c.id).order("sort_order")
      ]);
      const same = <T,>(prev: T, next: T) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
      if (!cl.error && cl.data) setClinic((prev) => same(prev, cl.data as Clinic));
      if (!ro.error && ro.data) setRooms((prev) => same(prev, ro.data as Room[]));
      if (!st.error && st.data) setStaff((prev) => same(prev, st.data as Staff[]));
      await loadFollowups(c.id, c.timezone);
      if (!cl.error && !ro.error && !st.error) setLastSyncAt(Date.now());
    } catch {
      // offline: the "Updated" indicator turns red if this lasts
    }
  }, [loadFollowups]);

  const clinicId = clinic?.id ?? null;
  const touch = useCallback(() => setLastSyncAt(Date.now()), []);

  // Live updates for rooms, the clinic settings row, staff, and the follow up lists. Each one
  // reconnects by itself if the connection drops.
  useLiveChannel(
    clinicId ? `clinic-rooms-${clinicId}` : null,
    (ch) =>
      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `clinic_id=eq.${clinicId}` },
        (payload) => {
          touch();
          setRooms((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((r) => r.id !== (payload.old as Room).id);
            }
            const updated = payload.new as Room;
            const idx = prev.findIndex((r) => r.id === updated.id);
            if (idx === -1) return [...prev, updated].sort((a, b) => a.room_number - b.room_number);
            const next = [...prev];
            next[idx] = updated;
            return next;
          });
        }
      ),
    refreshAll
  );

  useLiveChannel(
    clinicId ? `clinic-row-${clinicId}` : null,
    (ch) =>
      ch.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "clinics", filter: `id=eq.${clinicId}` },
        (payload) => {
          touch();
          setClinic(payload.new as Clinic);
        }
      ),
    refreshAll
  );

  useLiveChannel(
    clinicId ? `clinic-staff-${clinicId}` : null,
    (ch) =>
      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "staff", filter: `clinic_id=eq.${clinicId}` },
        (payload) => {
          touch();
          setStaff((prev) => {
            if (payload.eventType === "DELETE") return prev.filter((s) => s.id !== (payload.old as Staff).id);
            const updated = payload.new as Staff;
            const idx = prev.findIndex((s) => s.id === updated.id);
            if (idx === -1) return [...prev, updated].sort((a, b) => a.sort_order - b.sort_order);
            const next = [...prev];
            next[idx] = updated;
            return next;
          });
        }
      ),
    refreshAll
  );

  // Lab pickup, callback and checking out lists: refetch whenever any of the tables change.
  useLiveChannel(
    clinicId ? `clinic-followups-${clinicId}` : null,
    (ch) => {
      let c = ch;
      ["lab_samples", "lab_pickups", "result_callbacks", "checkouts"].forEach((table) => {
        c = c.on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `clinic_id=eq.${clinicId}` },
          () => {
            touch();
            const cl = clinicRef.current;
            if (cl) loadFollowups(cl.id, cl.timezone);
          }
        );
      });
      return c;
    },
    refreshAll
  );

  // Every 30 seconds, and the moment the tab is shown, focused or back online.
  useEffect(() => {
    if (!clinicId) return;
    const id = setInterval(refreshAll, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshAll();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refreshAll);
    window.addEventListener("online", refreshAll);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refreshAll);
      window.removeEventListener("online", refreshAll);
    };
  }, [clinicId, refreshAll]);

  // Timing history (Admin, provider idle time): refresh once a minute.
  useEffect(() => {
    if (!clinicId) return;
    const id = setInterval(() => {
      const c = clinicRef.current;
      if (c) loadHistory(c.id, c.averages_reset_at);
    }, 60_000);
    return () => clearInterval(id);
  }, [clinicId, loadHistory]);

  // A room 2 minutes past check out shows as vacant. No scheduler needed: each screen works it out.
  const roomsRef = useRef<Room[]>([]);
  roomsRef.current = rooms;
  useEffect(() => {
    const id = setInterval(() => {
      const k = roomsRef.current
        .filter((r) => r.stage === "turnover" && Date.now() - new Date(r.stage_started_at).getTime() >= TURNOVER_MS)
        .map((r) => r.id)
        .join(",");
      setExpiredKey(k);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // When the averages are reset or erased (here or on another device), reload right away.
  const resetAt = clinic?.averages_reset_at ?? null;
  const clinicIdForHistory = clinic?.id;
  useEffect(() => {
    if (clinicIdForHistory) loadHistory(clinicIdForHistory, resetAt);
  }, [clinicIdForHistory, resetAt, loadHistory]);

  const staffById = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff]);

  const timerTargets = useMemo(() => mergeTimerTargets(clinic?.timer_targets), [clinic?.timer_targets]);

  const advanceStage = useCallback(async (roomId: string, opts?: AdvanceOptions) => {
    await supabase.rpc("advance_room_stage", {
      p_room_id: roomId,
      p_target: opts?.target ?? null,
      p_expected_stage: opts?.expected ?? null,
      p_add_callback: opts?.addCallback ?? false,
      p_actor: opts?.actor ?? null
    });
  }, []);

  const refreshFollowups = useCallback(() => {
    if (clinic) loadFollowups(clinic.id, clinic.timezone);
  }, [clinic, loadFollowups]);

  const checkOut = useCallback(
    async (roomId: string, opts?: { expected?: Stage; addCallback?: boolean }) => {
      await supabase.rpc("check_out_room", {
        p_room_id: roomId,
        p_expected_stage: opts?.expected ?? null,
        p_add_callback: opts?.addCallback ?? false
      });
      refreshFollowups();
    },
    [refreshFollowups]
  );

  const setFollowup = useCallback(
    async (roomId: string, timeframe: FollowupTimeframe | null, reason: FollowupReason | null, note?: string) => {
      await supabase.rpc("set_followup", {
        p_room_id: roomId,
        p_timeframe: timeframe,
        p_reason: reason,
        p_note: note ?? null
      });
    },
    []
  );

  const setCallbackNote = useCallback(
    async (callbackId: string, note: string) => {
      await supabase.rpc("set_callback_note", { p_callback_id: callbackId, p_note: note });
      refreshFollowups();
    },
    [refreshFollowups]
  );

  const swapRoom = useCallback(async (fromRoomId: string, toRoomId: string) => {
    const { data, error: rpcErr } = await supabase.rpc("swap_room", { p_from: fromRoomId, p_to: toRoomId });
    if (rpcErr) {
      return missingFunction(rpcErr, "swap_room") ? `Change room could not run. ${NEEDS_UPDATE}` : `Change room failed: ${rpcErr.message}`;
    }
    return data === true ? null : "That room is no longer available. Pick another vacant room.";
  }, []);

  const goBack = useCallback(async (roomId: string, expected: Stage) => {
    const { data, error: rpcErr } = await supabase.rpc("go_back_room", { p_room_id: roomId, p_expected_stage: expected });
    if (rpcErr) {
      return missingFunction(rpcErr, "go_back_room") ? `Go back could not run. ${NEEDS_UPDATE}` : `Go back failed: ${rpcErr.message}`;
    }
    return data === true ? null : "The room has already moved on, so nothing was changed.";
  }, []);

  const undoCheckout = useCallback(
    async (roomId: string) => {
      const { data, error: rpcErr } = await supabase.rpc("undo_checkout", { p_room_id: roomId });
      refreshFollowups();
      if (rpcErr) {
        return missingFunction(rpcErr, "undo_checkout")
          ? `Undo check out could not run. ${NEEDS_UPDATE}`
          : `Undo check out failed: ${rpcErr.message}`;
      }
      return data === true ? null : "Check out can no longer be undone (the 2 minutes are up, a new patient was checked in, or Pt departed was tapped).";
    },
    [refreshFollowups]
  );

  const setVisitProvider = useCallback(async (roomId: string, doctorId: string | null) => {
    const { error: rpcErr } = await supabase.rpc("set_visit_provider", { p_room_id: roomId, p_doctor_id: doctorId });
    if (rpcErr) {
      return missingFunction(rpcErr, "set_visit_provider")
        ? `Change provider could not run. ${NEEDS_UPDATE}`
        : `Change provider failed: ${rpcErr.message}`;
    }
    return null;
  }, []);

  const setTimerTargets = useCallback(
    async (targets: TimerTargets) => {
      if (!clinic) return "No clinic loaded.";
      const { error: rpcErr } = await supabase.rpc("set_timer_targets", { p_clinic_id: clinic.id, p_targets: targets });
      if (rpcErr) {
        return missingFunction(rpcErr, "set_timer_targets")
          ? `Timer colors could not be saved. ${NEEDS_UPDATE}`
          : `Timer colors could not be saved: ${rpcErr.message}`;
      }
      setClinic((c) => (c ? { ...c, timer_targets: targets } : c));
      return null;
    },
    [clinic]
  );

  const getTrackerData = useCallback(
    async (day: string) => {
      if (!clinic) return { data: null, error: "No clinic loaded." };
      const { data, error: rpcErr } = await supabase.rpc("tracker_data", { p_clinic_id: clinic.id, p_day: day });
      if (rpcErr) {
        return {
          data: null,
          error: missingFunction(rpcErr, "tracker_data")
            ? `The Tracker needs the database update. Run ${UPDATE_FILE} in the Supabase SQL Editor, then reload.`
            : rpcErr.message
        };
      }
      return { data: data as TrackerData, error: null };
    },
    [clinic]
  );

  const setStaffColor = useCallback(async (staffId: string, color: string | null) => {
    await supabase.from("staff").update({ name_color: color }).eq("id", staffId);
  }, []);

  const resetAverages = useCallback(async () => {
    if (!clinic) return;
    const { error: rpcErr } = await supabase.rpc("reset_timing_averages", { p_clinic_id: clinic.id });
    if (!rpcErr) {
      const now = new Date().toISOString();
      setClinic((c) => (c ? { ...c, averages_reset_at: now } : c));
    }
  }, [clinic]);

  const eraseTimingHistory = useCallback(async () => {
    if (!clinic) return;
    const { error: rpcErr } = await supabase.rpc("erase_timing_history", { p_clinic_id: clinic.id });
    if (!rpcErr) {
      setHistory([]);
      setClinic((c) => (c ? { ...c, averages_reset_at: null } : c));
    }
  }, [clinic]);

  const resetDay = useCallback(async () => {
    if (!clinic) return;
    await supabase.rpc("reset_day", { p_clinic_id: clinic.id });
    refreshFollowups();
  }, [clinic, refreshFollowups]);

  const claim = useCallback(async (roomId: string, key: string, name: string) => {
    await supabase.rpc("claim_request", { p_room_id: roomId, p_key: key, p_name: name });
  }, []);

  const claimCheckoutFollowup = useCallback(
    async (checkoutId: string, name: string) => {
      await supabase.rpc("claim_checkout_followup", { p_checkout_id: checkoutId, p_name: name });
      refreshFollowups();
    },
    [refreshFollowups]
  );

  const departCheckout = useCallback(
    async (checkoutId: string) => {
      await supabase.rpc("set_checkout_departed", { p_checkout_id: checkoutId });
      refreshFollowups();
    },
    [refreshFollowups]
  );

  const setDirections = useCallback(async (roomId: string, text: string) => {
    await supabase.rpc("set_room_directions", { p_room_id: roomId, p_text: text });
  }, []);

  const setSampleBoxed = useCallback(
    async (sampleId: string, boxed: boolean) => {
      await supabase.rpc("set_sample_boxed", { p_sample_id: sampleId, p_boxed: boxed });
      refreshFollowups();
    },
    [refreshFollowups]
  );

  const removeSample = useCallback(
    async (sampleId: string) => {
      await supabase.rpc("remove_lab_sample", { p_sample_id: sampleId });
      refreshFollowups();
    },
    [refreshFollowups]
  );

  const setDloCalled = useCallback(
    async (called: boolean) => {
      if (!clinic) return;
      await supabase.rpc("set_dlo_called", { p_clinic_id: clinic.id, p_called: called });
      refreshFollowups();
    },
    [clinic, refreshFollowups]
  );

  const setCallbackStatus = useCallback(
    async (callbackId: string, status: CallbackStatus) => {
      await supabase.rpc("set_callback_status", { p_callback_id: callbackId, p_status: status });
      refreshFollowups();
    },
    [refreshFollowups]
  );

  const removeCallback = useCallback(
    async (callbackId: string) => {
      await supabase.rpc("remove_callback", { p_callback_id: callbackId });
      refreshFollowups();
    },
    [refreshFollowups]
  );

  const setLockout = useCallback(async (roomId: string, on: boolean) => {
    await supabase.rpc("set_lockout", { p_room_id: roomId, p_on: on });
  }, []);

  const toggleRequest = useCallback(async (roomId: string, key: string) => {
    await supabase.rpc("toggle_request", { p_room_id: roomId, p_key: key });
  }, []);

  const setNote = useCallback(async (roomId: string, note: string | null) => {
    await supabase.rpc("set_room_note", { p_room_id: roomId, p_note: note ?? "" });
  }, []);

  const assignPatient = useCallback(async (roomId: string, initials: string, doctorId?: string | null) => {
    const { data, error: rpcErr } = await supabase.rpc("assign_patient", {
      p_room_id: roomId,
      p_initials: initials,
      p_doctor_id: doctorId ?? null,
      p_set_doctor: doctorId !== undefined
    });
    if (rpcErr) {
      return {
        ticket: null,
        error: missingFunction(rpcErr, "assign_patient")
          ? `Check in could not run. ${NEEDS_UPDATE}`
          : `Check in failed: ${rpcErr.message}`
      };
    }
    const ticket = (data as string) ?? null;
    return {
      ticket,
      error: ticket ? null : "That room is no longer available. Pick another room."
    };
  }, []);

  const setStaffing = useCallback(
    async (roomId: string, nurseId: string | null, doctorId: string | null) => {
      await supabase.rpc("set_room_staffing", {
        p_room_id: roomId,
        p_nurse_id: nurseId,
        p_doctor_id: doctorId
      });
    },
    []
  );

  const setRoomCount = useCallback(
    async (count: number) => {
      if (!clinic) return;
      await supabase.rpc("set_clinic_room_count", { p_clinic_id: clinic.id, p_count: count });
      setClinic({ ...clinic, room_count: count });
    },
    [clinic]
  );

  // Up to MAX_STAFF[role] people per group (providers 6, nurses 20, front desk 20). Returns
  // an error message string on failure (e.g. cap reached), null on success.
  const addStaff = useCallback(
    async (role: StaffRole) => {
      if (!clinic) return "No clinic loaded.";
      const currentOfRole = staff.filter((s) => s.role === role);
      if (currentOfRole.length >= MAX_STAFF[role]) {
        const groupName = role === "doctor" ? "providers" : role === "nurse" ? "nurses" : "front desk staff";
        return `You already have ${MAX_STAFF[role]} ${groupName}.`;
      }
      const defaultName = role === "doctor" ? "New provider" : role === "nurse" ? "New nurse" : "New front desk";
      const { error: insertErr } = await supabase.from("staff").insert({
        clinic_id: clinic.id,
        name: defaultName,
        role,
        color: ROLE_COLOR[role],
        sort_order: currentOfRole.length + 1
      });
      return insertErr ? insertErr.message : null;
    },
    [clinic, staff]
  );

  const renameStaff = useCallback(async (staffId: string, name: string) => {
    await supabase.from("staff").update({ name }).eq("id", staffId);
  }, []);

  const removeStaff = useCallback(async (staffId: string) => {
    // Rooms pointing at this person fall back to "any nurse/provider"
    // automatically (schema uses ON DELETE SET NULL on those two columns).
    await supabase.from("staff").delete().eq("id", staffId);
  }, []);

  // Rooms beyond the clinic's "rooms in service" setting are hidden everywhere
  // (room tabs, board, front desk, waiting room, admin), per the original spec.
  // A room still "Turning over" after 2 minutes shows as vacant.
  const visibleRooms = useMemo(() => {
    const list = clinic ? rooms.filter((r) => r.room_number <= clinic.room_count) : rooms;
    return list.map((r) =>
      r.stage === "turnover" && Date.now() - new Date(r.stage_started_at).getTime() >= TURNOVER_MS
        ? { ...r, stage: "vacant" as Stage, undo: null }
        : r
    );
    // expiredKey changes the moment a room's 2 minutes are up
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, clinic, expiredKey]);

  const followups = useMemo<FollowupSummary>(() => {
    const tz = clinic?.timezone;
    const today = clinicToday(tz);
    const todaySamples = labSamples.filter((s) => s.pickup_date === today);
    const earlierOpenSamples = labSamples.filter((s) => s.pickup_date < today && !s.boxed_at);
    const dloCalledAt = labPickups.find((p) => p.pickup_date === today)?.dlo_called_at ?? null;
    const waitingCallbacks = callbacks.filter((c) => c.status === "waiting");
    const readyCallbacks = callbacks.filter((c) => c.status === "ready");
    const doneTodayCallbacks = callbacks.filter(
      (c) => c.status === "called" && c.called_at && dateKeyInTz(c.called_at, tz) === today
    );
    const unboxed = [...earlierOpenSamples, ...todaySamples].filter((s) => !s.boxed_at).length;
    const needsDloCall = todaySamples.length > 0 && !dloCalledAt ? 1 : 0;
    return {
      todaySamples,
      earlierOpenSamples,
      dloCalledAt,
      waitingCallbacks,
      readyCallbacks,
      doneTodayCallbacks,
      attentionCount: unboxed + needsDloCall + readyCallbacks.length
    };
  }, [labSamples, labPickups, callbacks, clinic?.timezone]);

  const value: ClinicContextValue = {
    me,
    setMe,
    clinic,
    followups,
    checkouts,
    hallways,
    staff,
    staffById,
    rooms: visibleRooms,
    history,
    timerTargets,
    lastSyncAt,
    loading,
    error,
    actions: {
      advanceStage,
      checkOut,
      goBack,
      undoCheckout,
      setVisitProvider,
      setTimerTargets,
      getTrackerData,
      setStaffColor,
      refresh: refreshAll,
      setFollowup,
      setCallbackNote,
      swapRoom,
      resetAverages,
      eraseTimingHistory,
      resetDay,
      claim,
      claimCheckoutFollowup,
      departCheckout,
      setDirections,
      setSampleBoxed,
      removeSample,
      setDloCalled,
      setCallbackStatus,
      removeCallback,
      setLockout,
      toggleRequest,
      setNote,
      assignPatient,
      setStaffing,
      setRoomCount,
      addStaff,
      renameStaff,
      removeStaff
    }
  };

  return <ClinicContext.Provider value={value}>{children}</ClinicContext.Provider>;
}

export function useClinic() {
  const ctx = useContext(ClinicContext);
  if (!ctx) throw new Error("useClinic must be used within a ClinicProvider");
  return ctx;
}
