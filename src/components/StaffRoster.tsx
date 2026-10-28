"use client";

import { useState } from "react";
import { Staff, StaffRole } from "@/lib/types";
import { MAX_STAFF, ROLE_COLOR } from "@/lib/constants";

interface Props {
  staff: Staff[];
  onAdd: (role: StaffRole) => Promise<string | null>;
  onRename: (id: string, name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

function RoleColumn({
  role,
  label,
  people,
  onAdd,
  onRename,
  onRemove
}: {
  role: StaffRole;
  label: string;
  people: Staff[];
  onAdd: Props["onAdd"];
  onRename: Props["onRename"];
  onRemove: Props["onRemove"];
}) {
  const [error, setError] = useState<string | null>(null);
  const color = ROLE_COLOR[role];

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-sm flex items-center">
          <span className="hall-dot" style={{ backgroundColor: color }} />
          {role === "frontdesk" ? label : `${label}s`}
        </div>
        <span className="text-xs text-slate-500">
          {people.length} of {MAX_STAFF[role]}
        </span>
      </div>
      <div className="space-y-2">
        {people.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <input
              className="flex-1 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-lg px-2.5 py-1.5 text-sm"
              defaultValue={p.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== p.name) onRename(p.id, v);
              }}
            />
            <button
              className="text-slate-400 hover:text-red-600 text-sm px-1"
              title={`Remove ${p.name}`}
              onClick={() => onRemove(p.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        className="mt-2 text-sm font-semibold disabled:text-slate-300 disabled:cursor-not-allowed"
        style={{ color: people.length >= MAX_STAFF[role] ? undefined : color }}
        disabled={people.length >= MAX_STAFF[role]}
        onClick={async () => {
          setError(null);
          const err = await onAdd(role);
          if (err) setError(err);
        }}
      >
        + Add {label.toLowerCase()}
      </button>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

export function StaffRoster({ staff, onAdd, onRename, onRemove }: Props) {
  const providers = staff.filter((s) => s.role === "doctor");
  const nurses = staff.filter((s) => s.role === "nurse");
  const frontDesk = staff.filter((s) => s.role === "frontdesk");

  return (
    <div className="card p-5 mb-6">
      <h3 className="font-bold mb-1">Providers, nurses and front desk</h3>
      <p className="text-sm text-slate-500 mb-4">
        Up to {MAX_STAFF.doctor} providers, {MAX_STAFF.nurse} nurses and {MAX_STAFF.frontdesk} front desk staff.
        Providers and nurses can be assigned to rooms; everyone on these lists can pick their name for &ldquo;I&apos;ve
        got it&rdquo;.
      </p>
      <div className="grid gap-6 sm:grid-cols-3">
        <RoleColumn role="doctor" label="Provider" people={providers} onAdd={onAdd} onRename={onRename} onRemove={onRemove} />
        <RoleColumn role="nurse" label="Nurse" people={nurses} onAdd={onAdd} onRename={onRename} onRemove={onRemove} />
        <RoleColumn
          role="frontdesk"
          label="Front desk"
          people={frontDesk}
          onAdd={onAdd}
          onRename={onRename}
          onRemove={onRemove}
        />
      </div>
    </div>
  );
}
