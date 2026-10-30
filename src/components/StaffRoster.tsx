"use client";

import { useState } from "react";
import { Staff, StaffRole } from "@/lib/types";
import { MAX_STAFF, ROLE_COLOR, NAME_COLORS, NAME_COLORS_DARK_TAG, DARK_TAG_BG, ANY_PROVIDER_COLOR } from "@/lib/constants";
import { parseNameColor } from "@/lib/util";
import { ProviderName } from "@/components/ProviderName";

interface Props {
  staff: Staff[];
  onAdd: (role: StaffRole) => Promise<string | null>;
  onRename: (id: string, name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onColor: (id: string, color: string | null) => Promise<void>;
}

function RoleColumn({
  role,
  label,
  people,
  onAdd,
  onRename,
  onRemove,
  onColor
}: {
  role: StaffRole;
  label: string;
  people: Staff[];
  onAdd: Props["onAdd"];
  onRename: Props["onRename"];
  onRemove: Props["onRemove"];
  onColor: Props["onColor"];
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
          <div key={p.id}>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-lg px-2.5 py-1.5 text-sm font-semibold"
                style={role === "doctor" && parseNameColor(p.name_color).hex && !parseNameColor(p.name_color).dark ? { color: parseNameColor(p.name_color).hex! } : undefined}
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
            {role === "doctor" && (() => {
              const cur = parseNameColor(p.name_color);
              const same = (a: string | null, b: string) => !!a && a.toLowerCase() === b.toLowerCase();
              return (
                <div className="mt-1.5 mb-2 space-y-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap" aria-label={`White tag colors for ${p.name}`}>
                    <span className="text-xs text-slate-500 w-16 shrink-0">White tag</span>
                    {NAME_COLORS.map((c) => (
                      <button
                        key={c.hex}
                        title={c.name}
                        aria-label={`${c.name} on a white tag`}
                        className={`w-6 h-6 rounded-full border-2 ${
                          !cur.dark && same(cur.hex, c.hex) ? "border-slate-900 dark:border-white scale-110" : "border-transparent"
                        }`}
                        style={{ backgroundColor: c.hex }}
                        onClick={() => onColor(p.id, c.hex)}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap" aria-label={`Dark tag colors for ${p.name}`}>
                    <span className="text-xs text-slate-500 w-16 shrink-0">Dark tag</span>
                    {NAME_COLORS_DARK_TAG.map((c) => (
                      <button
                        key={c.hex}
                        title={c.name}
                        aria-label={`${c.name} on a dark tag`}
                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                          cur.dark && same(cur.hex, c.hex) ? "border-sky-500 scale-110" : "border-slate-500"
                        }`}
                        style={{ backgroundColor: DARK_TAG_BG }}
                        onClick={() => onColor(p.id, `dark:${c.hex}`)}
                      >
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c.hex }} />
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 w-16 shrink-0">Preview</span>
                    <ProviderName
                      tag={{ name: p.name, color: cur.hex || ANY_PROVIDER_COLOR, dark: !!cur.hex && cur.dark }}
                      className="text-sm"
                    />
                    {p.name_color && (
                      <button className="text-xs text-slate-400 underline" onClick={() => onColor(p.id, null)}>
                        None
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
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

export function StaffRoster({ staff, onAdd, onRename, onRemove, onColor }: Props) {
  const providers = staff.filter((s) => s.role === "doctor");
  const nurses = staff.filter((s) => s.role === "nurse");
  const frontDesk = staff.filter((s) => s.role === "frontdesk");

  return (
    <div className="card p-5 mb-6">
      <h3 className="font-bold mb-1">Providers, nurses and front desk</h3>
      <p className="text-sm text-slate-500 mb-4">
        Up to {MAX_STAFF.doctor} providers, {MAX_STAFF.nurse} nurses and {MAX_STAFF.frontdesk} front desk staff.
        Providers and nurses can be assigned to rooms. A provider's name color is how their name shows on the board and room pages. Everyone on these lists can pick their name for &ldquo;I&apos;ve
        got it&rdquo;.
      </p>
      <div className="grid gap-6 sm:grid-cols-3">
        <RoleColumn
          role="doctor"
          label="Provider"
          people={providers}
          onAdd={onAdd}
          onRename={onRename}
          onRemove={onRemove}
          onColor={onColor}
        />
        <RoleColumn
          role="nurse"
          label="Nurse"
          people={nurses}
          onAdd={onAdd}
          onRename={onRename}
          onRemove={onRemove}
          onColor={onColor}
        />
        <RoleColumn
          role="frontdesk"
          label="Front desk"
          people={frontDesk}
          onAdd={onAdd}
          onRename={onRename}
          onRemove={onRemove}
          onColor={onColor}
        />
      </div>
    </div>
  );
}
