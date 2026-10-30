"use client";

import { useEffect, useState } from "react";
import { useClinic } from "@/lib/clinicContext";

// Shown in the top bar of every screen. Gray while data is arriving normally, red only if the
// screen has not been able to sync for over 4 minutes. Tap it to refresh right now.
const STALE_MS = 4 * 60_000;

export function SyncStatus() {
  const { lastSyncAt, actions } = useClinic();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const age = lastSyncAt ? Math.max(0, now - lastSyncAt) : null;
  const stale = age === null || age > STALE_MS;
  let label = "Updating…";
  if (age !== null) {
    if (age < 10_000) label = "Updated just now";
    else if (age < 60_000) label = `Updated ${Math.floor(age / 1000)}s ago`;
    else label = `Updated ${Math.floor(age / 60_000)} min ago`;
  }

  return (
    <button
      type="button"
      title="Tap to refresh now"
      onClick={async () => {
        setBusy(true);
        await actions.refresh();
        setNow(Date.now());
        setBusy(false);
      }}
      className={`text-xs whitespace-nowrap rounded-md px-2 py-1 ${
        stale ? "bg-red-600 text-white font-semibold" : "text-slate-500"
      }`}
    >
      {stale && age !== null ? "Not updating. Tap to refresh. " : ""}
      {busy ? "Refreshing…" : label}
    </button>
  );
}
