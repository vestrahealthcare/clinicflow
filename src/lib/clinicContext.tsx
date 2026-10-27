"use client";

import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
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
  FollowupReason
} from "./types";
import { clinicToday, dateKeyInTz } from "./util";
import { STAGE_ORDER, AVG_WINDOW_DAYS, MAX_STAFF_PER_ROLE, ROLE_COLOR } from "./constants";

export interface AdvanceOptions {
  /** From "with_doctor" only: "shots", "other" or "needs_cleanup" (default). */
  target?: Stage;
  /** The stage the tablet was showing when tapped; the tap is ignored if the room has already moved on. */
  expected?: Stage;
  /** On departure, add the patient to the "Call with results" list if tests are still pending. */
  addCallback?: boolean;
}

interface ClinicActions {
  advanceStage: (roomId: string, opts?: AdvanceOptions) => Promise<void>;
  /** Check-out: room goes to cleanup, patient goes to the waiting room list. */
  checkOut: (roomId: string, opts?: { expected?: Stage; addCallback?: boolean }) => Promise<void>;
  setFollowup: (roomId: string, timeframe: FollowupTimeframe | null, reason: FollowupReason | null) => Promise<void>;
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
  assignPatient: (roomId: string, initials: string) => Promise<string | null>;
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
  clinic: Clinic | null;
  followups: FollowupSummary;
  /** Patients checked out and still in the waiting room (not yet "Pt departed"), oldest first. */
  checkouts: Checkout[];
  hallways: Hallway[];
  staff: Staff[];
  staffById: Record<string, Staff>;
  rooms: Room[];
  /** Completed stage instances in the trailing AVG_WINDOW_DAYS, used for both
   *  the admin dashboard and the smart yellow/red timer coloring everywhere. */
  history: RoomHistoryRow[];
  avgByStage: Partial<Record<Stage, number>>;
  countByStage: Partial<Record<Stage, number>>;
  loading: boolean;
  error: string | null;
  actions: ClinicActions;
}

const ClinicContext = createContext<ClinicContextValue | null>(null);

export function ClinicProvider({ slug, children }: { slug: string; children: React.ReactNode }) {
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

  const loadHistory = useCallback(async (clinicId: string) => {
    const since = new Date(Date.now() - AVG_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
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
        loadHistory(clinicRow.id),
        loadFollowups(clinicRow.id, (clinicRow as Clinic).timezone)
      ]);
      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug, loadHistory, loadFollowups]);

  // Realtime subscription: keep `rooms` in sync the instant any tablet changes one.
  useEffect(() => {
    if (!clinic) return;

    const channel = supabase
      .channel(`clinic-rooms-${clinic.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `clinic_id=eq.${clinic.id}` },
        (payload) => {
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
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinic]);

  // Also refresh the clinic row itself when room_count or ticket counter change elsewhere.
  useEffect(() => {
    if (!clinic) return;
    const channel = supabase
      .channel(`clinic-row-${clinic.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "clinics", filter: `id=eq.${clinic.id}` },
        (payload) => setClinic(payload.new as Clinic)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinic?.id]);

  // Staff roster changes (names added/renamed/removed) reflected everywhere live.
  useEffect(() => {
    if (!clinic) return;
    const channel = supabase
      .channel(`clinic-staff-${clinic.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "staff", filter: `clinic_id=eq.${clinic.id}` },
        (payload) => {
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
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinic?.id]);

  // Lab pickup and callback lists: refetch whenever any of the three tables change.
  useEffect(() => {
    if (!clinic) return;
    const refetch = () => loadFollowups(clinic.id, clinic.timezone);
    let channel = supabase.channel(`clinic-followups-${clinic.id}`);
    ["lab_samples", "lab_pickups", "result_callbacks", "checkouts"].forEach((table) => {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `clinic_id=eq.${clinic.id}` },
        refetch
      );
    });
    channel.subscribe();
    const id = setInterval(refetch, 30_000);
    return () => {
      clearInterval(id);
      supabase.removeChannel(channel);
    };
  }, [clinic?.id, clinic?.timezone, loadFollowups]);

  // Averages feed the smart timer coloring; a new visit finishing every so
  // often is enough reason to refresh rather than needing this instantly.
  useEffect(() => {
    if (!clinic) return;
    const id = setInterval(() => loadHistory(clinic.id), 60_000);
    return () => clearInterval(id);
  }, [clinic, loadHistory]);

  const staffById = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff]);

  const { avgByStage, countByStage } = useMemo(() => {
    const sums: Partial<Record<Stage, number>> = {};
    const counts: Partial<Record<Stage, number>> = {};
    STAGE_ORDER.forEach((s) => {
      sums[s] = 0;
      counts[s] = 0;
    });
    history.forEach((h) => {
      if (sums[h.stage] !== undefined) {
        sums[h.stage]! += h.duration_ms;
        counts[h.stage]! += 1;
      }
    });
    const avg: Partial<Record<Stage, number>> = {};
    STAGE_ORDER.forEach((s) => {
      avg[s] = counts[s] ? sums[s]! / counts[s]! : 0;
    });
    return { avgByStage: avg, countByStage: counts };
  }, [history]);

  const advanceStage = useCallback(async (roomId: string, opts?: AdvanceOptions) => {
    await supabase.rpc("advance_room_stage", {
      p_room_id: roomId,
      p_target: opts?.target ?? null,
      p_expected_stage: opts?.expected ?? null,
      p_add_callback: opts?.addCallback ?? false
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
    async (roomId: string, timeframe: FollowupTimeframe | null, reason: FollowupReason | null) => {
      await supabase.rpc("set_followup", { p_room_id: roomId, p_timeframe: timeframe, p_reason: reason });
    },
    []
  );

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

  const assignPatient = useCallback(async (roomId: string, initials: string) => {
    const { data, error: rpcErr } = await supabase.rpc("assign_patient", {
      p_room_id: roomId,
      p_initials: initials
    });
    if (rpcErr) return null;
    return (data as string) ?? null;
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

  // Up to MAX_STAFF_PER_ROLE providers and MAX_STAFF_PER_ROLE nurses. Returns
  // an error message string on failure (e.g. cap reached), null on success.
  const addStaff = useCallback(
    async (role: StaffRole) => {
      if (!clinic) return "No clinic loaded.";
      const currentOfRole = staff.filter((s) => s.role === role);
      if (currentOfRole.length >= MAX_STAFF_PER_ROLE) {
        return `You already have ${MAX_STAFF_PER_ROLE} ${role === "doctor" ? "providers" : "nurses"}.`;
      }
      const defaultName = role === "doctor" ? "New provider" : "New nurse";
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
  const visibleRooms = useMemo(
    () => (clinic ? rooms.filter((r) => r.room_number <= clinic.room_count) : rooms),
    [rooms, clinic]
  );

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
    clinic,
    followups,
    checkouts,
    hallways,
    staff,
    staffById,
    rooms: visibleRooms,
    history,
    avgByStage,
    countByStage,
    loading,
    error,
    actions: {
      advanceStage,
      checkOut,
      setFollowup,
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
