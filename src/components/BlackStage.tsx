"use client";

import { useEffect } from "react";

/**
 * Black page background with white squares, used by the Fishbowl board, Room view and
 * Front desk. Everything inside stays in light colors regardless of the device's dark mode.
 */
export function BlackStage({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.body.classList.add("blackbg");
    return () => document.body.classList.remove("blackbg");
  }, []);
  return <div className="light">{children}</div>;
}
