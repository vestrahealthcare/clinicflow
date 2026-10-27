"use client";

import { useEffect, useState } from "react";
import { useClinic } from "@/lib/clinicContext";

const KEY = "clinicflow.me";

export function rememberedName(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function remember(name: string) {
  try {
    window.localStorage.setItem(KEY, name);
  } catch {
    // private window or blocked storage: nothing to remember, still works
  }
}

/**
 * "I've got it": no logins, so the person says who they are. Roster names are one
 * tap, anyone else (front desk, medical assistants) can type a name. The last name
 * used on this device is offered first.
 */
export function ClaimPicker({ onPick, onCancel }: { onPick: (name: string) => void; onCancel: () => void }) {
  const { staff } = useClinic();
  const [typed, setTyped] = useState("");
  const [last, setLast] = useState("");

  useEffect(() => setLast(rememberedName()), []);

  const choose = (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    remember(clean);
    onPick(clean);
  };

  const roster = staff.map((s) => s.name);

  return (
    <div className="mt-2 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
      <div className="text-xs text-slate-500 mb-2">Who has it?</div>
      <div className="flex flex-wrap gap-2 mb-2">
        {last && !roster.includes(last) && (
          <button className="chip on" onClick={() => choose(last)}>
            {last}
          </button>
        )}
        {roster.map((n) => (
          <button key={n} className={`chip ${n === last ? "on" : ""}`} onClick={() => choose(n)}>
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
