"use client";

import { useState } from "react";
import { useClinic } from "@/lib/clinicContext";

interface Props {
  since: string | null;
  until: string | null;
  /** Human-readable description of the range, e.g. "2026-09-28" or "Sep 22 – Sep 28, 2026" or "all-time". */
  rangeLabel: string;
  onDone?: () => void;
}

/**
 * Two separate confirmations, in order, exactly as specified: "Are you
 * sure?" then "Did you ask your supervisor if it is ok to reset this data".
 * Canceling either stops it with no partial effect.
 */
export function ResetPeriodButton({ since, until, rangeLabel, onDone }: Props) {
  const { actions } = useClinic();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmSecond() {
    setBusy(true);
    setError(null);
    const res = await actions.resetPeriod(since, until);
    setBusy(false);
    setStep(0);
    if (!res.ok) setError(res.error ?? "Reset failed.");
    else onDone?.();
  }

  return (
    <div>
      <button
        className="text-sm font-semibold text-red-600 border border-red-300 dark:border-red-800 rounded-lg px-3 py-1.5"
        onClick={() => setStep(1)}
      >
        Reset this period
      </button>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

      {step === 1 && (
        <div className="mt-3 p-4 rounded-xl bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200">
          <p className="text-sm font-semibold mb-1">Are you sure?</p>
          <p className="text-xs mb-3">
            This permanently deletes the visit records for <strong>{rangeLabel}</strong>. Nothing outside that range
            is touched — but any weekly/monthly/all-time totals that included this range will drop accordingly once
            it&apos;s gone, since those are calculated live from these same records.
          </p>
          <div className="flex gap-2">
            <button className="flex-1 py-2 rounded-lg border border-red-400 font-bold text-sm" onClick={() => setStep(0)}>
              Cancel
            </button>
            <button className="flex-1 py-2 rounded-lg bg-red-700 text-white font-bold text-sm" onClick={() => setStep(2)}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-3 p-4 rounded-xl bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200">
          <p className="text-sm font-semibold mb-3">Did you ask your supervisor if it is ok to reset this data?</p>
          <div className="flex gap-2">
            <button className="flex-1 py-2 rounded-lg border border-red-400 font-bold text-sm" onClick={() => setStep(0)}>
              Cancel
            </button>
            <button
              className="flex-1 py-2 rounded-lg bg-red-700 text-white font-bold text-sm disabled:opacity-50"
              onClick={confirmSecond}
              disabled={busy}
            >
              {busy ? "Resetting…" : "Yes, reset"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
