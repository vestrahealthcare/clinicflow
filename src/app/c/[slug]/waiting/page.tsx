"use client";

import { useEffect, useState } from "react";
import { useClinic } from "@/lib/clinicContext";
import { supabase } from "@/lib/supabaseClient";
import { CallRow } from "@/lib/types";
import { roomDirections } from "@/lib/util";

const WINDOW_MS = 6 * 60_000;

export default function WaitingPage() {
  const { clinic, rooms, hallways, checkouts, actions } = useClinic();
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
      <p className="text-slate-500 mb-10">Your initials, room and directions will appear below</p>
      <div className="space-y-3">
        {calls.slice(0, 8).map((c) => {
          const room = rooms.find((r) => r.id === c.room_id);
          const hallway = room ? hallways.find((h) => h.id === room.hallway_id) : null;
          if (!room) return null;
          return (
            <div key={c.id} className="card px-7 py-5 flex justify-between items-center">
              <span className="font-mono text-3xl font-semibold text-left">
                {c.initials ?? c.ticket}
                {c.initials && <span className="block text-xs font-normal text-slate-400">{c.ticket}</span>}
              </span>
              <span className="text-right">
                <span className="text-xl font-semibold flex items-center justify-end">
                  <span className="hall-dot" style={{ backgroundColor: hallway?.color }} />
                  {room.name}
                </span>
                <span className="block text-base text-slate-500">{roomDirections(room, hallway)}</span>
              </span>
            </div>
          );
        })}
        {calls.length === 0 && <div className="text-slate-400 py-10">No one called back yet.</div>}
      </div>

      {checkouts.length > 0 && (
        <div className="mt-12 text-left">
          <h2 className="text-lg font-bold mb-1 text-center">Checking out</h2>
          <p className="text-slate-500 text-sm mb-3 text-center">Tap Pt departed once the patient has left.</p>
          <div className="space-y-3">
            {checkouts.map((c) => (
              <div key={c.id} className="card px-7 py-4 flex justify-between items-center">
                <span className="font-mono text-2xl font-semibold">{c.initials ?? c.ticket ?? "—"}</span>
                <button
                  className="px-5 py-2.5 rounded-xl bg-blue-600 text-white font-semibold"
                  onClick={() => actions.departCheckout(c.id)}
                >
                  Pt departed
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
