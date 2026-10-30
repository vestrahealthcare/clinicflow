"use client";

import { DARK_TAG_BG } from "@/lib/constants";
import { ProviderTag } from "@/lib/util";

/** The visit's provider, in their color on a small tag (white, or near black for bright colors). */
export function ProviderName({ tag, className = "" }: { tag: ProviderTag | null; className?: string }) {
  if (!tag) return null;
  return (
    <span
      className={`inline-block max-w-full truncate align-middle rounded-full px-2 py-0.5 font-bold leading-tight border ${
        tag.dark ? "border-transparent" : "bg-white border-slate-300"
      } ${className}`}
      style={{ color: tag.color, ...(tag.dark ? { backgroundColor: DARK_TAG_BG } : null) }}
      title={tag.name}
    >
      {tag.name}
    </span>
  );
}
