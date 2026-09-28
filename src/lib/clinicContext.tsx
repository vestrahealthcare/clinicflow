"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "./supabaseClient";
import { Clinic, Staff, Room, RoomHistoryRow, RoomRequest, Stage, StaffRole, ClinicDay } from "./types";
import { STAGE_ORDER, AVG_WINDOW_DAYS, MAX_STAFF_PER_ROLE, ROLE_COLOR, STAFF_NAME_KEY } from "./constants";

export type ActionResult = { ok: boolean; error?: string };

const OFFLINE_ERROR: ActionResult = { ok: false, error: "Connection lost — try again once reconnected." };

interface ClinicActions {
  advanceStage: (roomId: string) => Promise<ActionResult & { historyId?: string | null }>;
  setLockout: (roomId: string, on: boolean) => Promise<ActionResult>;
  setNote: (roomId: string, note: string | null) => Promise<void>;
  assignPatient: (roomId: string, label?: string | null) => Promise<{ ticket: string | null } & ActionResult>;
  setPatientLabel: (roomId: string, label: string | null) => Promise<ActionResult>;
  markProviderFinished: (roomId: string) => Promise<ActionResult>;
  setStaffing: (roomId: string, nurseId: string | null, doctorId: string | null) => Promise<void>;
  setRoomCount: (count: number) => Promise<void>;
  addStaff: (role: StaffRole) => Promise<string | null>; // returns an error message, or null on success
  renameStaff: (staffId: string, name: string) => Promise<void>;
  removeStaff: (staffId: string) => Promise<ActionResult>;
  toggleFlash: (roomId: string, on: boolean) => Promise<void>;
  startDay: () => Promise<ActionResult>;
  endDay: () => Promise<ActionResult>;
  createRequest: (roomId: string, key: string) => Promise<ActionResult & { requestId?: string | null }>;
  acknowledgeRequest: (requestId: string, by: string) => Promise<ActionResult>;
  clearRequest: (requestId: string) => Promise<ActionResult>;
  restoreRequest: (requestId: string) => Promise<ActionResult>;
  resetPeriod: (since: string | null, until: string | null) => Promise<ActionResult>;
  restoreRoomSnapshot: (roomId: string, snapshot: Partial<Room>, expectedUpdatedAt: string, historyIdToDelete?: string | null) => Promise<ActionResult>;
}

interface ClinicContextValue {
  clinic: Clinic | null;
  staff: Staff[];
  staffById: Record<string, Staff>;
  rooms: Room[];
  roomRequests: RoomRequest[];
  /** Active (uncleared) requests per room, keyed by request key. */
  activeRequestsByRoom: Record<string, Record<string, RoomRequest>>;
  /** Rooms with at least one active-and-unacknowledged ("unclaimed") request. */
  unclaimedRoomIds: Set<string>;
  /** Completed stage instances in the trailing AVG_WINDOW_DAYS, used for both
   *  the admin dashboard and the smart yellow/red timer coloring everywhere. */
  history: RoomHistoryRow[];
  avgByStage: Partial<Record<Stage, number>>;
  countByStage: Partial<Record<Stage, number>>;
  /** Today's clinic_days row, if Start Day has been pressed today. */
  today: ClinicDay | null;
  /** Past clinic_days rows, most recent first. */
  pastDays: ClinicDay[];
  loading: boolean;
  error: string | null;
  connected: boolean;
  lastUpdatedAt: string | null;
  /** Per-device "who's using this tablet" name — no login system, so this is
   *  the only identity there is. Persisted to localStorage; attached to
   *  requests created, requests claimed, and notes sent. */
  staffName: string;
  setStaffName: (name: string) => void;
  actions: ClinicActions;
}

const ClinicContext = createContext<ClinicContextValue | null>(null);

export function ClinicProvider({ slug, children }: { slug: string; children: React.ReactNode }) {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomRequests, setRoomRequests] = useState<RoomRequest[]>([]);
  const [history, setHistory] = useState<RoomHistoryRow[]>([]);
  const [today, setToday] = useState<ClinicDay | null>(null);
  const [pastDays, setPastDays] = useState<ClinicDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const connectedRef = useRef(true);
  const [staffNameState, setStaffNameState] = useState("");
  const staffNameRef = useRef("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STAFF_NAME_KEY) ?? "";
      staffNameRef.current = stored;
      setStaffNameState(stored);
    } catch {
      // Private browsing / blocked storage — just start blank.
    }
  }, []);

  const setStaffName = useCallback((name: string) => {
    staffNameRef.current = name;
    setStaffNameState(name);
    try {
      localStorage.setItem(STAFF_NAME_KEY, name);
    } catch {
      // Ignore — just won't be remembered next time.
    }
  }, []);

  const bumpUpdated = useCallback(() => setLastUpdatedAt(new Date().toISOString()), []);

  const loadDays = useCallback(async (clinicId: string) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from("clinic_days")
      .select("*")
      .eq("clinic_id", clinicId)
      .order("day_date", { ascending: false })
      .limit(3660); // ~10 years of days — cheap since each row is tiny, and the All-time tab needs full history
    const rows = (data as ClinicDay[]) ?? [];
    setToday(rows.find((d) => d.day_date === todayStr) ?? null);
    setPastDays(rows.filter((d) => d.day_date !== todayStr));
  }, []);

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

  const loadRooms = useCallback(async (clinicId: string) => {
    const { data } = await supabase.from("rooms").select("*").eq("clinic_id", clinicId).order("room_number");
    setRooms((data as Room[]) ?? []);
  }, []);

  const loadStaff = useCallback(async (clinicId: string) => {
    const { data } = await supabase.from("staff").select("*").eq("clinic_id", clinicId).order("sort_order");
    setStaff((data as Staff[]) ?? []);
  }, []);

  const loadActiveRequests = useCallback(async (clinicId: string) => {
    const { data } = await supabase
      .from("room_requests")
      .select("*")
      .eq("clinic_id", clinicId)
      .is("cleared_at", null)
      .order("created_at", { ascending: true });
    setRoomRequests((data as RoomRequest[]) ?? []);
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
          setError(`No clinic found for slug "${slug}". Check the clinics table.`);
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;
      setClinic(clinicRow as Clinic);

      await Promise.all([
        loadStaff(clinicRow.id),
        loadRooms(clinicRow.id),
        loadActiveRequests(clinicRow.id),
        loadHistory(clinicRow.id),
        loadDays(clinicRow.id)
      ]);
      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug, loadHistory, loadDays, loadRooms, loadStaff, loadActiveRequests]);

  // Realtime subscription: keep `rooms` in sync the instant any tablet changes one.
  // Also doubles as the clinic's connection-status signal — its subscribe
  // callback reports SUBSCRIBED / TIMED_OUT / CLOSED / CHANNEL_ERROR, and on
  // every (re)connect we refetch everything so the app isn't just "assumed"
  // fresh after an outage.
  useEffect(() => {
    if (!clinic) return;

    const channel = supabase
      .channel(`clinic-rooms-${clinic.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `clinic_id=eq.${clinic.id}` },
        (payload) => {
          bumpUpdated();
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
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          connectedRef.current = true;
          setConnected(true);
          bumpUpdated();
          Promise.all([
            loadRooms(clinic.id),
            loadStaff(clinic.id),
            loadActiveRequests(clinic.id),
            loadHistory(clinic.id),
            loadDays(clinic.id)
          ]);
        } else if (status === "TIMED_OUT" || status === "CLOSED" || status === "CHANNEL_ERROR") {
          connectedRef.current = false;
          setConnected(false);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinic, bumpUpdated, loadRooms, loadStaff, loadActiveRequests, loadHistory, loadDays]);

  // Also refresh the clinic row itself when room_count or ticket counter change elsewhere.
  useEffect(() => {
    if (!clinic) return;
    const channel = supabase
      .channel(`clinic-row-${clinic.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "clinics", filter: `id=eq.${clinic.id}` },
        (payload) => {
          bumpUpdated();
          setClinic(payload.new as Clinic);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinic?.id, bumpUpdated]);

  // Staff roster changes (names added/renamed/removed) reflected everywhere live.
  useEffect(() => {
    if (!clinic) return;
    const channel = supabase
      .channel(`clinic-staff-${clinic.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "staff", filter: `clinic_id=eq.${clinic.id}` },
        (payload) => {
          bumpUpdated();
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
  }, [clinic?.id, bumpUpdated]);

  // Room requests (quick-tests/clinical-support) reflected live everywhere —
  // this is what drives request-based flashing and the Needs Attention strip.
  useEffect(() => {
    if (!clinic) return;
    const channel = supabase
      .channel(`clinic-requests-${clinic.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_requests", filter: `clinic_id=eq.${clinic.id}` },
        (payload) => {
          bumpUpdated();
          setRoomRequests((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((r) => r.id !== (payload.old as RoomRequest).id);
            }
            const updated = payload.new as RoomRequest;
            const idx = prev.findIndex((r) => r.id === updated.id);
            if (updated.cleared_at) {
              // Cleared requests drop out of the "active" set we keep in memory.
              return idx === -1 ? prev : prev.filter((r) => r.id !== updated.id);
            }
            if (idx === -1) return [...prev, updated];
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
  }, [clinic?.id, bumpUpdated]);

  // Averages feed the smart timer coloring; a new visit finishing every so
  // often is enough reason to refresh rather than needing this instantly.
  useEffect(() => {
    if (!clinic) return;
    const id = setInterval(() => loadHistory(clinic.id), 60_000);
    return () => clearInterval(id);
  }, [clinic, loadHistory]);

  // Start/End Day changes reflected live so every tablet's status agrees.
  useEffect(() => {
    if (!clinic) return;
    const channel = supabase
      .channel(`clinic-days-${clinic.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clinic_days", filter: `clinic_id=eq.${clinic.id}` },
        () => {
          bumpUpdated();
          loadDays(clinic.id);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinic, loadDays, bumpUpdated]);

  const staffById = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff]);

  const activeRequestsByRoom = useMemo(() => {
    const map: Record<string, Record<string, RoomRequest>> = {};
    roomRequests.forEach((r) => {
      (map[r.room_id] ||= {})[r.key] = r;
    });
    return map;
  }, [roomRequests]);

  const unclaimedRoomIds = useMemo(() => {
    const set = new Set<string>();
    roomRequests.forEach((r) => {
      if (!r.acknowledged_at) set.add(r.room_id);
    });
    return set;
  }, [roomRequests]);

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

  async function rpc<T = unknown>(name: string, params?: Record<string, unknown>): Promise<ActionResult & { data?: T }> {
    if (!connectedRef.current) return { ...OFFLINE_ERROR };
    const { data, error: rpcErr } = await supabase.rpc(name, params);
    if (rpcErr) return { ok: false, error: rpcErr.message };
    return { ok: true, data: data as T };
  }

  const advanceStage = useCallback(async (roomId: string) => {
    const res = await rpc<string | null>("advance_room_stage", { p_room_id: roomId });
    return { ...res, historyId: res.data ?? null };
  }, []);

  const setLockout = useCallback(async (roomId: string, on: boolean) => {
    return rpc("set_lockout", { p_room_id: roomId, p_on: on });
  }, []);

  const setNote = useCallback(async (roomId: string, note: string | null) => {
    await rpc("set_room_note", { p_room_id: roomId, p_note: note ?? "", p_author: staffNameRef.current });
  }, []);

  const assignPatient = useCallback(async (roomId: string, label?: string | null) => {
    const res = await rpc<string | null>("assign_patient", { p_room_id: roomId, p_label: label ?? null });
    return { ...res, ticket: res.data ?? null };
  }, []);

  const setPatientLabel = useCallback(async (roomId: string, label: string | null) => {
    return rpc("set_patient_label", { p_room_id: roomId, p_label: label ?? "" });
  }, []);

  const markProviderFinished = useCallback(async (roomId: string) => {
    return rpc("mark_provider_finished", { p_room_id: roomId });
  }, []);

  const setStaffing = useCallback(
    async (roomId: string, nurseId: string | null, doctorId: string | null) => {
      await rpc("set_room_staffing", {
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
      const res = await rpc("set_clinic_room_count", { p_clinic_id: clinic.id, p_count: count });
      if (res.ok) setClinic({ ...clinic, room_count: count });
    },
    [clinic]
  );

  // Up to MAX_STAFF_PER_ROLE providers and MAX_STAFF_PER_ROLE nurses. Returns
  // an error message string on failure (e.g. cap reached), null on success.
  const addStaff = useCallback(
    async (role: StaffRole) => {
      if (!connectedRef.current) return OFFLINE_ERROR.error!;
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

  const removeStaff = useCallback(async (staffId: string): Promise<ActionResult> => {
    if (!connectedRef.current) return { ...OFFLINE_ERROR };
    // Rooms pointing at this person fall back to "any nurse/provider"
    // automatically (schema uses ON DELETE SET NULL on those two columns).
    // Historical room_history rows store the name as plain text, so past
    // activity is untouched by this delete.
    const { error: delErr } = await supabase.from("staff").delete().eq("id", staffId);
    if (delErr) return { ok: false, error: delErr.message };
    // Realtime normally removes it from local state, but update optimistically
    // too so a slow/rare missed event doesn't make the button look like a no-op.
    setStaff((prev) => prev.filter((s) => s.id !== staffId));
    return { ok: true };
  }, []);

  const toggleFlash = useCallback(async (roomId: string, on: boolean) => {
    await rpc("toggle_room_flash", { p_room_id: roomId, p_on: on });
  }, []);

  const startDay = useCallback(async () => {
    if (!clinic) return { ok: false, error: "No clinic loaded." };
    const res = await rpc("start_clinic_day", { p_clinic_id: clinic.id });
    await loadDays(clinic.id);
    return res;
  }, [clinic, loadDays]);

  const endDay = useCallback(async () => {
    if (!clinic) return { ok: false, error: "No clinic loaded." };
    const res = await rpc("end_clinic_day", { p_clinic_id: clinic.id });
    await loadDays(clinic.id);
    return res;
  }, [clinic, loadDays]);

  const createRequest = useCallback(async (roomId: string, key: string) => {
    const res = await rpc<string | null>("create_room_request", {
      p_room_id: roomId,
      p_key: key,
      p_created_by: staffNameRef.current
    });
    return { ...res, requestId: res.data ?? null };
  }, []);

  const acknowledgeRequest = useCallback(async (requestId: string, by: string) => {
    return rpc("acknowledge_room_request", { p_request_id: requestId, p_by: by });
  }, []);

  const clearRequest = useCallback(async (requestId: string) => {
    return rpc("clear_room_request", { p_request_id: requestId });
  }, []);

  // Undo for "clear/complete a request": a cleared request is a terminal
  // state nothing else writes to, so this just needs to flip cleared_at
  // back to null — no concurrency check required like restoreRoomSnapshot's.
  const restoreRequest = useCallback(async (requestId: string): Promise<ActionResult> => {
    if (!connectedRef.current) return { ...OFFLINE_ERROR };
    const { error: updErr, data } = await supabase
      .from("room_requests")
      .update({ cleared_at: null })
      .eq("id", requestId)
      .not("cleared_at", "is", null)
      .select("id");
    if (updErr) return { ok: false, error: updErr.message };
    if (!data || data.length === 0) return { ok: false, error: "Can't undo — this was already changed." };
    return { ok: true }; // realtime delivers the restored row to every connected view
  }, []);

  const resetPeriod = useCallback(
    async (since: string | null, until: string | null) => {
      if (!clinic) return { ok: false, error: "No clinic loaded." };
      const res = await rpc("reset_period_data", { p_clinic_id: clinic.id, p_since: since, p_until: until });
      if (res.ok) {
        await Promise.all([loadHistory(clinic.id), loadDays(clinic.id)]);
      }
      return res;
    },
    [clinic, loadHistory, loadDays]
  );

  // Generic Undo support: writes a captured snapshot of a room's fields back,
  // but only if nobody else has touched the row since (compares updated_at)
  // — otherwise it would silently clobber a newer change from someone else.
  // Optionally deletes a room_history row a stage-advance created, so undoing
  // a stage change doesn't leave a phantom "completed stage" in the analytics.
  const restoreRoomSnapshot = useCallback(
    async (roomId: string, snapshot: Partial<Room>, expectedUpdatedAt: string, historyIdToDelete?: string | null) => {
      if (!connectedRef.current) return { ...OFFLINE_ERROR };
      const { data: current } = await supabase.from("rooms").select("updated_at").eq("id", roomId).single();
      if (!current || current.updated_at !== expectedUpdatedAt) {
        return { ok: false, error: "Can't undo — this was already updated by someone else." };
      }
      const { error: updErr } = await supabase
        .from("rooms")
        .update({ ...snapshot, updated_at: new Date().toISOString() })
        .eq("id", roomId);
      if (updErr) return { ok: false, error: updErr.message };
      if (historyIdToDelete) {
        await supabase.from("room_history").delete().eq("id", historyIdToDelete);
      }
      return { ok: true };
    },
    []
  );

  const value: ClinicContextValue = {
    clinic,
    staff,
    staffById,
    rooms,
    roomRequests,
    activeRequestsByRoom,
    unclaimedRoomIds,
    history,
    today,
    pastDays,
    avgByStage,
    countByStage,
    loading,
    error,
    connected,
    lastUpdatedAt,
    staffName: staffNameState,
    setStaffName,
    actions: {
      advanceStage,
      setLockout,
      setNote,
      assignPatient,
      setPatientLabel,
      markProviderFinished,
      setStaffing,
      setRoomCount,
      addStaff,
      renameStaff,
      removeStaff,
      toggleFlash,
      startDay,
      endDay,
      createRequest,
      acknowledgeRequest,
      clearRequest,
      restoreRequest,
      resetPeriod,
      restoreRoomSnapshot
    }
  };

  return <ClinicContext.Provider value={value}>{children}</ClinicContext.Provider>;
}

export function useClinic() {
  const ctx = useContext(ClinicContext);
  if (!ctx) throw new Error("useClinic must be used within a ClinicProvider");
  return ctx;
}
