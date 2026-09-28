"use client";

import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "./supabaseClient";
import { Clinic, Staff, Room, RoomHistoryRow, Stage, StaffRole, ClinicDay } from "./types";
import { STAGE_ORDER, AVG_WINDOW_DAYS, MAX_STAFF_PER_ROLE, ROLE_COLOR } from "./constants";

interface ClinicActions {
  advanceStage: (roomId: string) => Promise<void>;
  setLockout: (roomId: string, on: boolean) => Promise<void>;
  toggleRequest: (roomId: string, key: string) => Promise<void>;
  setNote: (roomId: string, note: string | null) => Promise<void>;
  assignPatient: (roomId: string) => Promise<string | null>;
  setStaffing: (roomId: string, nurseId: string | null, doctorId: string | null) => Promise<void>;
  setRoomCount: (count: number) => Promise<void>;
  addStaff: (role: StaffRole) => Promise<string | null>; // returns an error message, or null on success
  renameStaff: (staffId: string, name: string) => Promise<void>;
  removeStaff: (staffId: string) => Promise<void>;
  toggleFlash: (roomId: string, on: boolean) => Promise<void>;
  startDay: () => Promise<void>;
  endDay: () => Promise<void>;
}

interface ClinicContextValue {
  clinic: Clinic | null;
  staff: Staff[];
  staffById: Record<string, Staff>;
  rooms: Room[];
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
  actions: ClinicActions;
}

const ClinicContext = createContext<ClinicContextValue | null>(null);

export function ClinicProvider({ slug, children }: { slug: string; children: React.ReactNode }) {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [history, setHistory] = useState<RoomHistoryRow[]>([]);
  const [today, setToday] = useState<ClinicDay | null>(null);
  const [pastDays, setPastDays] = useState<ClinicDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

      const [{ data: staffRows }, { data: roomRows }] = await Promise.all([
        supabase.from("staff").select("*").eq("clinic_id", clinicRow.id).order("sort_order"),
        supabase.from("rooms").select("*").eq("clinic_id", clinicRow.id).order("room_number")
      ]);

      if (cancelled) return;
      setStaff((staffRows as Staff[]) ?? []);
      setRooms((roomRows as Room[]) ?? []);
      await Promise.all([loadHistory(clinicRow.id), loadDays(clinicRow.id)]);
      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug, loadHistory, loadDays]);

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
        () => loadDays(clinic.id)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinic, loadDays]);

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

  const advanceStage = useCallback(async (roomId: string) => {
    await supabase.rpc("advance_room_stage", { p_room_id: roomId });
  }, []);

  const setLockout = useCallback(async (roomId: string, on: boolean) => {
    await supabase.rpc("set_lockout", { p_room_id: roomId, p_on: on });
  }, []);

  const toggleRequest = useCallback(async (roomId: string, key: string) => {
    await supabase.rpc("toggle_request", { p_room_id: roomId, p_key: key });
  }, []);

  const setNote = useCallback(async (roomId: string, note: string | null) => {
    await supabase.rpc("set_room_note", { p_room_id: roomId, p_note: note ?? "" });
  }, []);

  const assignPatient = useCallback(async (roomId: string) => {
    const { data, error: rpcErr } = await supabase.rpc("assign_patient", { p_room_id: roomId });
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

  const toggleFlash = useCallback(async (roomId: string, on: boolean) => {
    await supabase.rpc("toggle_room_flash", { p_room_id: roomId, p_on: on });
  }, []);

  const startDay = useCallback(async () => {
    if (!clinic) return;
    await supabase.rpc("start_clinic_day", { p_clinic_id: clinic.id });
    await loadDays(clinic.id);
  }, [clinic, loadDays]);

  const endDay = useCallback(async () => {
    if (!clinic) return;
    await supabase.rpc("end_clinic_day", { p_clinic_id: clinic.id });
    await loadDays(clinic.id);
  }, [clinic, loadDays]);

  const value: ClinicContextValue = {
    clinic,
    staff,
    staffById,
    rooms,
    history,
    today,
    pastDays,
    avgByStage,
    countByStage,
    loading,
    error,
    actions: {
      advanceStage,
      setLockout,
      toggleRequest,
      setNote,
      assignPatient,
      setStaffing,
      setRoomCount,
      addStaff,
      renameStaff,
      removeStaff,
      toggleFlash,
      startDay,
      endDay
    }
  };

  return <ClinicContext.Provider value={value}>{children}</ClinicContext.Provider>;
}

export function useClinic() {
  const ctx = useContext(ClinicContext);
  if (!ctx) throw new Error("useClinic must be used within a ClinicProvider");
  return ctx;
}
