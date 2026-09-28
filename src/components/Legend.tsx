import { ROLE_COLOR, HOUSEKEEPING_COLOR } from "@/lib/constants";

/**
 * Role level legend, not per person: blue always means "a provider's turn,"
 * green always means "a nurse's turn," regardless of which of up to 6
 * providers or 6 nurses is actually assigned. Specific names show as text
 * next to the room, not as a separate color.
 */
export function Legend() {
  const items = [
    { label: "Provider", color: ROLE_COLOR.doctor },
    { label: "Nurse", color: ROLE_COLOR.nurse },
    { label: "Housekeeping", color: HOUSEKEEPING_COLOR }
  ];
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {items.map((it) => (
        <span
          key={it.label}
          className="text-xs font-semibold px-2.5 py-1 rounded-full border"
          style={{ borderColor: it.color, color: it.color }}
        >
          <span className="hall-dot" style={{ backgroundColor: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
