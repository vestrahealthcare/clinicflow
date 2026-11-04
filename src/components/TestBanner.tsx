"use client";

import { useState } from "react";
import { useClinic } from "@/lib/clinicContext";
import { ensureTestClinic, isTestSlug, liveSlugOf } from "@/lib/testMode";

/** Loud strip across the top of every screen while in test mode, so nobody mistakes it for the live clinic. */
export function TestBanner() {
  const { clinic } = useClinic();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!clinic || !isTestSlug(clinic.slug)) return null;
  const liveSlug = liveSlugOf(clinic.slug);

  async function reset() {
    setBusy(true);
    setError(null);
    const res = await ensureTestClinic(liveSlug, true);
    if (res.error) {
      setError(res.error);
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  return (
    <div className="bg-fuchsia-700 text-white px-5 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
      <span className="font-extrabold tracking-wide">TEST MODE</span>
      <span className="flex-1 min-w-[12rem]">
        Practice here. Nothing you do changes the live clinic, its rooms, staff, settings or Tracker.
      </span>
      {asking ? (
        <span className="flex items-center gap-2">
          <span className="font-semibold">Erase everything in test mode and start fresh?</span>
          <button className="px-3 py-1 rounded-md bg-white text-fuchsia-800 font-bold disabled:opacity-50" disabled={busy} onClick={reset}>
            {busy ? "Resetting…" : "Yes, reset"}
          </button>
          <button className="px-3 py-1 rounded-md border border-white/70" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <button className="px-3 py-1 rounded-md border border-white/70" onClick={() => setAsking(true)}>
            Reset test data
          </button>
          <a className="px-3 py-1 rounded-md bg-white text-fuchsia-800 font-bold" href={`/c/${liveSlug}/admin`}>
            Exit test mode
          </a>
        </span>
      )}
      {error && <span className="basis-full font-semibold">{error}</span>}
    </div>
  );
}
