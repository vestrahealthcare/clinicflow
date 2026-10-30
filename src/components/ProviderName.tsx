"use client";

import { ProviderTag } from "@/lib/util";

/** The visit's provider, in their color on a small white pill so it reads on any square. */
export function ProviderName({ tag, className = "" }: { tag: ProviderTag | null; className?: string }) {
  if (!tag) return null;
  return (
    <span
      className={`inline-block max-w-full truncate align-middle rounded-full bg-white px-2 py-0.5 font-bold leading-tight border border-slate-300 ${className}`}
      style={{ color: tag.color }}
      title={tag.name}
    >
      {tag.name}
    </span>
  );
}
