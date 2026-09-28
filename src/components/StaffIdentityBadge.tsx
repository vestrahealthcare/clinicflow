"use client";

import { useState } from "react";
import { useClinic } from "@/lib/clinicContext";

/** No login system, so this is the only "who's using this tablet" there is.
 *  Visible and changeable from every page, not just prompted reactively —
 *  it's what makes "ordered by X" / "sent by X" attribution possible. */
export function StaffIdentityBadge() {
  const { staffName, setStaffName } = useClinic();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(staffName);

  function startEdit() {
    setDraft(staffName);
    setEditing(true);
  }

  function save() {
    setStaffName(draft.trim());
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          className="w-28 border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 rounded-md px-2 py-1 text-xs"
          placeholder="Your name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <button className="text-xs font-semibold text-emerald-600" onClick={save}>
          Save
        </button>
      </div>
    );
  }

  return (
    <button
      className="text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-full px-2.5 py-1"
      onClick={startEdit}
      title="Set the name shown when you claim requests, send notes, etc."
    >
      {staffName ? `Acting as: ${staffName}` : "Set your name"}
    </button>
  );
}
