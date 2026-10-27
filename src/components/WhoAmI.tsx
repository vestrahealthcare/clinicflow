"use client";

import { useState } from "react";
import { useClinic } from "@/lib/clinicContext";

/**
 * "I am ..." at the top of every page. Once a name is set on this device, every
 * "I've got it" tap uses it with no extra step. Roster names are one tap; anyone
 * else can type their name for the day.
 */
export function WhoAmI() {
  const { me, setMe, staff } = useClinic();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const groups: { title: string; names: string[] }[] = [
    { title: "Nurses", names: staff.filter((s) => s.role === "nurse").map((s) => s.name) },
    { title: "Front desk", names: staff.filter((s) => s.role === "frontdesk").map((s) => s.name) },
    { title: "Providers", names: staff.filter((s) => s.role === "doctor").map((s) => s.name) }
  ].filter((g) => g.names.length > 0);

  const pick = (name: string) => {
    setMe(name);
    setTyped("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        className={`px-3 py-2 rounded-lg text-sm font-semibold border ${
          me
            ? "border-emerald-500 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950"
            : "border-amber-500 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950"
        }`}
        onClick={() => setOpen((o) => !o)}
      >
        {me ? `I am ${me}` : "Who are you?"} ▾
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] z-20 card p-4 shadow-lg">
          <div className="text-xs text-slate-500 mb-2">
            Set your name once on this device and &ldquo;I&apos;ve got it&rdquo; will use it with one tap.
          </div>
          {groups.map((g) => (
            <div key={g.title} className="mb-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">{g.title}</div>
              <div className="flex flex-wrap gap-2">
                {g.names.map((n) => (
                  <button key={n} className={`chip ${n === me ? "on" : ""}`} onClick={() => pick(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex gap-2 mt-3">
            <input
              className="flex-1 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900"
              placeholder="Someone else, type a name"
              value={typed}
              maxLength={40}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && typed.trim() && pick(typed)}
            />
            <button
              className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white font-semibold px-3 rounded-lg text-sm disabled:opacity-40"
              disabled={!typed.trim()}
              onClick={() => pick(typed)}
            >
              OK
            </button>
          </div>
          <div className="flex justify-between mt-3 text-sm">
            {me ? (
              <button className="text-slate-500" onClick={() => pick("")}>
                Clear my name
              </button>
            ) : (
              <span />
            )}
            <button className="text-slate-500" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
