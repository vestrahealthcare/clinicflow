"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { Clinic } from "@/lib/types";

export default function Home() {
  const [clinics, setClinics] = useState<Clinic[]>([]);

  useEffect(() => {
    supabase
      .from("clinics")
      .select("*")
      .order("name")
      .then(({ data }) => setClinics((data as Clinic[]) ?? []));
  }, []);

  return (
    <main className="max-w-xl mx-auto p-10">
      <h1 className="text-2xl font-bold mb-1">ClinicFlow</h1>
      <p className="text-slate-500 mb-8">Pick a clinic to open its board, room tablets, front desk, or admin view.</p>
      <div className="space-y-3">
        {clinics.map((c) => (
          <div key={c.id} className="card p-4 flex items-center justify-between">
            <div>
              <div className="font-semibold">{c.name}</div>
              <div className="text-sm text-slate-500">{c.room_count} rooms in service</div>
            </div>
            <div className="flex gap-2 text-sm">
              <Link className="chip" href={`/c/${c.slug}/board`}>
                Board
              </Link>
              <Link className="chip" href={`/c/${c.slug}/admin`}>
                Admin
              </Link>
            </div>
          </div>
        ))}
        {clinics.length === 0 && (
          <p className="text-sm text-slate-500">
            No clinics yet. Run <code>supabase/schema.sql</code> against your Supabase project first.
          </p>
        )}
      </div>
    </main>
  );
}
