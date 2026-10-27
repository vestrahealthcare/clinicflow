"use client";

import { useState } from "react";
import { useClinic } from "@/lib/clinicContext";

/**
 * Fallback for "I've got it" when nobody has set their name at the top of the page.
 * Roster names are one tap; anyone else can type a name. It does not change the
 * name set at the top, so a shared tablet never silently credits the wrong person.
 */
export function ClaimPicker({ onPick, onCancel }: { onPick: (name: string) => void; onCancel: () => void }) {
  const { staff } = useClinic();
  const [typed, setTyped] = useState("");

  const choose = (name: string) => {
    const clean = name.trim();
    if (clean) onPick(clean);
  };

  const roster = Array.from(new Set(staff.map((s) => s.name)));

  return (
    <div className="mt-2 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
      <div className="text-xs text-slate-500 mb-2">
        Who has it? Tip: set your name at the top of the page and this becomes one tap.
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        {roster.map((n) => (
          <button key={n} className="chip" onClick={() => choose(n)}>
            {n}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800"
          placeholder="Someone else, type a name"
          value={typed}
          maxLength={40}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && choose(typed)}
        />
        <button
          className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white font-semibold px-4 rounded-lg text-sm disabled:opacity-40"
          disabled={!typed.trim()}
          onClick={() => choose(typed)}
        >
          OK
        </button>
        <button className="text-sm text-slate-500 px-2" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
