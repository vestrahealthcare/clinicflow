"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useClinic } from "@/lib/clinicContext";
import { LiveTimer } from "@/components/LiveTimer";
import { FollowupStrip } from "@/components/FollowupStrip";
import { ClaimPicker } from "@/components/ClaimPicker";
import { BlackStage } from "@/components/BlackStage";
import { ProviderName } from "@/components/ProviderName";
import { TurnoverCountdown } from "@/components/TurnoverCountdown";
import { STAGE_LABEL } from "@/lib/constants";
import { attentionItems, boxColor, flashColors, flashKind, personLabel, providerTag } from "@/lib/util";

const GAP = 12;

// Pick the number of columns that makes every square as big as possible while keeping a
// pleasant shape (not too tall, not too wide), so all rooms fill the screen without scrolling.
function pickLayout(n: number, w: number, h: number) {
  let best = { cols: Math.max(1, Math.min(n, 4)), rows: Math.ceil(n / Math.max(1, Math.min(n, 4))), score: -1 };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (w - GAP * (cols - 1)) / cols;
    const ch = (h - GAP * (rows - 1)) / rows;
    if (cw <= 0 || ch <= 0) continue;
    const aspect = cw / ch;
    const penalty = aspect > 2.1 ? 2.1 / aspect : aspect < 0.85 ? aspect / 0.85 : 1;
    const score = cw * ch * penalty * penalty;
    if (score > best.score) best = { cols, rows, score };
  }
  return best;
}

export default function BoardPage({ params }: { params: { slug: string } }) {
  const { rooms, staffById, actions, me } = useClinic();
  // "roomId:itemKey" of the item currently choosing a name.
  const [claiming, setClaiming] = useState<string | null>(null);
  const claimingRef = useRef<string | null>(null);
  claimingRef.current = claiming;

  // Everything else on this screen updates by itself every 30 seconds. As an extra safety net
  // for a screen that stays on all day, the whole page reloads every 5 minutes (unless someone
  // is in the middle of picking a name).
  useEffect(() => {
    const id = setInterval(() => {
      if (claimingRef.current === null) window.location.reload();
    }, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  // Size the grid to the space left on the screen, so every room square is the same size,
  // fills most of the screen, and never runs past the bottom.
  const gridRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const el = gridRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const w = el.clientWidth;
      const h = Math.max(320, Math.floor(window.innerHeight - top - 20));
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, []);
  useEffect(() => {
    // The strip above the board can appear or disappear as work changes.
    const t = setInterval(() => window.dispatchEvent(new Event("resize")), 2000);
    return () => clearInterval(t);
  }, []);

  const layout = pickLayout(rooms.length, box.w || 1200, box.h || 600);
  const cellH = (box.h - GAP * (layout.rows - 1)) / layout.rows;
  // Text grows with the square, limited by its height and width so names do not wrap.
  // 14px at about 150px tall and 230px wide, up to 2.4 times that.
  const cellW = (box.w - GAP * (layout.cols - 1)) / layout.cols;
  const scale = Math.min(2.4, Math.max(1, Math.min(cellH / 150, cellW / 230)));
  const fontPx = Math.round(14 * scale * 10) / 10;

  return (
    <BlackStage>
      <FollowupStrip slug={params.slug} />
      <div
        ref={gridRef}
        className="grid"
        style={{
          gap: GAP,
          height: box.h || undefined,
          gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`
        }}
      >
        {rooms.map((room) => {
          const flash = flashKind(room);
          const base = boxColor(room);
          const [flashA, flashB] = flash ? flashColors(room, flash) : [base, base];
          const items = attentionItems(room);
          const label = personLabel(room, staffById);
          const provider = providerTag(room, staffById);
          // A busy room (several requests) shrinks its own text a little so everything stays
          // visible without scrolling. Quiet rooms use the full size.
          const needEm = 8 + items.reduce((n, it) => n + 2.5 + (it.detail ? 1.3 : 0) + (it.key === "note" && room.note ? 1.3 : 0), 0);
          const cardPx = Math.round(Math.max(fontPx * 0.7, Math.min(fontPx, cellH / needEm)) * 10) / 10;

          return (
            <div
              key={room.id}
              className={`rounded-2xl text-slate-900 shadow-sm hover:shadow-md transition-shadow flex flex-col min-h-0 min-w-0 overflow-hidden ${
                flash ? "fb-flash" : ""
              }`}
              style={
                {
                  backgroundColor: base,
                  fontSize: cardPx,
                  "--fb-a": flashA,
                  "--fb-b": flashB
                } as React.CSSProperties
              }
            >
              {/* Tapping the top of the card opens the room's tablet page. */}
              <Link href={`/c/${params.slug}/room/${room.room_number}`} className="block shrink-0" style={{ padding: "0.9em 1em 0.4em" }}>
                <div className="flex justify-between font-bold text-[1.6em] leading-tight mb-1">
                  <span>
                    {room.name}
                  </span>
                  {room.initials && <span className="font-mono text-slate-600">{room.initials}</span>}
                </div>
                <div className="text-[0.85em] text-slate-700 mb-2">
                  {room.contaminated ? "Contamination lockout" : STAGE_LABEL[room.stage]}
                  {label ? ` · ${label}` : ""}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <div className="text-[1.6em] font-semibold leading-tight">
                    {room.contaminated ? (
                      "—"
                    ) : room.stage === "turnover" ? (
                      <TurnoverCountdown startedAt={room.stage_started_at} />
                    ) : (
                      <LiveTimer startedAt={room.stage_started_at} stage={room.stage} pill />
                    )}
                  </div>
                  {provider && <ProviderName tag={provider} className="text-[0.8em]" />}
                </div>
              </Link>

              {items.length > 0 && (
                <div className="min-h-0 flex-1 overflow-y-auto space-y-1.5" style={{ padding: "0 1em 0.9em" }}>
                  {items.map((it) => (
                    <div key={it.key}>
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-[0.8em] font-semibold px-1.5 py-0.5 rounded-full ${
                            it.claimedBy ? "bg-white text-emerald-800" : "bg-white/70 text-slate-800"
                          }`}
                        >
                          {it.label}
                        </span>
                        {it.claimedBy ? (
                          <span className="text-[0.8em] font-bold text-emerald-900 whitespace-nowrap">
                            {it.claimedBy} has it
                            <button
                              className="ml-1.5 font-normal text-slate-600 underline"
                              onClick={() => actions.claim(room.id, it.key, "")}
                            >
                              Undo
                            </button>
                          </span>
                        ) : (
                          <button
                            className="text-[0.85em] font-bold px-2 py-1 rounded-md bg-emerald-600 text-white whitespace-nowrap"
                            onClick={() =>
                              me ? actions.claim(room.id, it.key, me) : setClaiming(`${room.id}:${it.key}`)
                            }
                          >
                            I&apos;ve got it
                          </button>
                        )}
                      </div>
                      {it.detail && <div className="text-[0.85em] text-slate-700 mt-0.5">{it.detail}</div>}
                      {it.key === "note" && room.note && (
                        <div className="text-[0.85em] italic text-slate-700 mt-0.5">&ldquo;{room.note}&rdquo;</div>
                      )}
                      {claiming === `${room.id}:${it.key}` && (
                        <ClaimPicker
                          onPick={(name) => {
                            actions.claim(room.id, it.key, name);
                            setClaiming(null);
                          }}
                          onCancel={() => setClaiming(null)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </BlackStage>
  );
}
