"use client";

import { useState } from "react";
import { useClinic } from "@/lib/clinicContext";
import { ensureTestClinic, isTestSlug } from "@/lib/testMode";

// Admin, Setup tab. In the live clinic: the button that opens test mode.
export function TestModeCard() {
  const { clinic } = useClinic();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!clinic) return null;
  const inTest = isTestSlug(clinic.slug);

  async function open() {
    setBusy(true);
    setError(null);
    const res = await ensureTestClinic(clinic!.slug, false);
    if (res.error || !res.slug) {
      setError(res.error);
      setBusy(false);
      return;
    }
    window.location.href = `/c/${res.slug}/frontdesk`;
  }

  return (
    <div className="card p-5 mb-6 border-fuchsia-300 dark:border-fuchsia-800">
      <h3 className="font-bold mb-1">Test mode</h3>
      {inTest ? (
        <p className="text-sm text-slate-500">
          You are in test mode right now. Everything on every screen, including this Admin page and its buttons, only
          changes the practice copy. Use the purple bar at the top to reset the practice data or exit.
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-500 mb-3">
            Opens a separate practice copy of the clinic, with the same rooms, staff and timer colors, to try things out
            or train staff. Nothing done there touches the live rooms, the Tracker or any setting. A purple bar stays at
            the top of every screen while you are in it, and Exit test mode brings you back here. Any tablet that opens
            the test link stays in test mode until it exits.
          </p>
          <button
            className="px-4 py-2.5 rounded-xl bg-fuchsia-700 text-white font-semibold text-sm disabled:opacity-50"
            disabled={busy}
            onClick={open}
          >
            {busy ? "Opening…" : "Open test mode"}
          </button>
          {error && <div className="mt-2 text-sm font-semibold text-red-600">{error}</div>}
        </>
      )}
    </div>
  );
}
