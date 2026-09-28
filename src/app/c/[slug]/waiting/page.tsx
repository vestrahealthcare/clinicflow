"use client";

import { useEffect, useState } from "react";
import { useClinic } from "@/lib/clinicContext";
import { supabase } from "@/lib/supabaseClient";
import { CallRow } from "@/lib/types";

const WINDOW_MS = 6 * 60_000;

export default function WaitingPage() {
  const { clinic, rooms } = useClinic();
  const [calls, setCalls] = useState<CallRow[]>([]);

  useEffect(() => {
    if (!clinic) return;
    let cancelled = false;

    supabase
      .from("calls")
      .select("*")
      .eq("clinic_id", clinic.id)
      .gte("called_at", new Date(Date.now() - WINDOW_MS).toISOString())
      .order("called_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setCalls((data as CallRow[]) ?? []);
      });

    const channel = supabase
      .channel(`clinic-calls-${clinic.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "calls", filter: `clinic_id=eq.${clinic.id}` },
        (payload) => setCalls((prev) => [payload.new as CallRow, ...prev].slice(0, 8))
      )
      .subscribe();

    // Age out old entries every 30s without a full refetch.
    const prune = setInterval(() => {
      setCalls((prev) => prev.filter((c) => Date.now() - new Date(c.called_at).getTime() < WINDOW_MS));
    }, 30_000);

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      clearInterval(prune);
    };
  }, [clinic?.id]);

  return (
    <div className="max-w-2xl mx-auto text-center pt-8">
      <h1 className="text-3xl font-bold mb-2">Please make your way to your room when called</h1>
      <p className="text-slate-500 mb-10">Your ticket number and room will appear below</p>
      <div className="space-y-3">
        {calls.slice(0, 8).map((c) => {
          const room = rooms.find((r) => r.id === c.room_id);
          if (!room) return null;
          return (
            <div key={c.id} className="card px-7 py-5 flex justify-between items-center">
              <span className="font-mono text-2xl font-semibold">{room.patient_label ?? c.ticket}</span>
              <span className="text-xl font-semibold flex items-center">{room.name}</span>
            </div>
          );
        })}
        {calls.length === 0 && <div className="text-slate-400 py-10">No one called back yet.</div>}
      </div>
    </div>
  );
}
