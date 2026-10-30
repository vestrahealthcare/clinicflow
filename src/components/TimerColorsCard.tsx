"use client";

import { useEffect, useState } from "react";
import { useClinic } from "@/lib/clinicContext";
import { STAGE_LABEL, STAGE_ORDER, DEFAULT_TIMER_TARGETS } from "@/lib/constants";
import { TimerStage, TimerTargets } from "@/lib/types";

// Yellow and red minutes for each step. Every timer in the app uses these numbers.
export function TimerColorsCard() {
  const { timerTargets, actions } = useClinic();
  const [draft, setDraft] = useState<Record<string, { yellow: string; red: string }>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const fromTargets = (t: TimerTargets) =>
    Object.fromEntries(
      (Object.keys(t) as TimerStage[]).map((k) => [k, { yellow: String(t[k].yellow), red: String(t[k].red) }])
    );
  useEffect(() => {
    setDraft(fromTargets(timerTargets));
  }, [timerTargets]);

  const setField = (k: TimerStage, f: "yellow" | "red", v: string) => {
    setMessage(null);
    setDraft((d) => ({ ...d, [k]: { ...(d[k] ?? { yellow: "", red: "" }), [f]: v.replace(/[^0-9]/g, "").slice(0, 3) } }));
  };

  async function save() {
    const out = {} as TimerTargets;
    for (const k of STAGE_ORDER as TimerStage[]) {
      const y = parseInt(draft[k]?.yellow ?? "", 10);
      const r = parseInt(draft[k]?.red ?? "", 10);
      if (!Number.isFinite(y) || !Number.isFinite(r) || y < 1 || r < 1) {
        setMessage({ ok: false, text: `${STAGE_LABEL[k]}: enter whole minutes, at least 1.` });
        return;
      }
      if (r <= y) {
        setMessage({ ok: false, text: `${STAGE_LABEL[k]}: red must be later than yellow.` });
        return;
      }
      out[k] = { yellow: y, red: r };
    }
    setSaving(true);
    const err = await actions.setTimerTargets(out);
    setSaving(false);
    setMessage(err ? { ok: false, text: err } : { ok: true, text: "Saved. Every screen uses these times now." });
  }

  return (
    <div className="card p-5 mb-6">
      <h3 className="font-bold mb-1">Timer colors</h3>
      <p className="text-sm text-slate-500 mb-3">
        How long a room can stay in each step before its timer turns yellow, then red. These are fixed minutes that you
        set here, the same on every screen.
      </p>
      <table className="w-full text-sm mb-3">
        <thead>
          <tr className="text-left text-slate-500 text-xs">
            <th className="pb-2">Step</th>
            <th className="pb-2">Yellow after (min)</th>
            <th className="pb-2">Red after (min)</th>
          </tr>
        </thead>
        <tbody>
          {(STAGE_ORDER as TimerStage[]).map((k) => (
            <tr key={k} className="border-t border-slate-100 dark:border-slate-700">
              <td className="py-2 pr-3">{STAGE_LABEL[k]}</td>
              <td className="py-2 pr-3">
                <input
                  inputMode="numeric"
                  aria-label={`${STAGE_LABEL[k]} yellow minutes`}
                  className="w-20 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-md px-2 py-1.5 font-mono text-amber-600 font-bold"
                  value={draft[k]?.yellow ?? ""}
                  onChange={(e) => setField(k, "yellow", e.target.value)}
                />
              </td>
              <td className="py-2">
                <input
                  inputMode="numeric"
                  aria-label={`${STAGE_LABEL[k]} red minutes`}
                  className="w-20 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-md px-2 py-1.5 font-mono text-red-600 font-bold"
                  value={draft[k]?.red ?? ""}
                  onChange={(e) => setField(k, "red", e.target.value)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="px-4 py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm disabled:opacity-50"
          disabled={saving}
          onClick={save}
        >
          {saving ? "Saving…" : "Save timer colors"}
        </button>
        <button
          className="px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-sm"
          onClick={() => {
            setDraft(fromTargets(DEFAULT_TIMER_TARGETS));
            setMessage(null);
          }}
        >
          Put back the starting times
        </button>
        {message && (
          <span className={`text-sm font-semibold ${message.ok ? "text-emerald-600" : "text-red-600"}`}>{message.text}</span>
        )}
      </div>
    </div>
  );
}
