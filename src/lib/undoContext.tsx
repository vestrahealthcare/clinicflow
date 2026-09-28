"use client";

import React, { createContext, useCallback, useContext, useRef, useState } from "react";

type UndoOutcome = { ok: boolean; error?: string } | void;

interface UndoState {
  label: string;
  onUndo: () => Promise<UndoOutcome> | UndoOutcome;
}

interface UndoContextValue {
  /** Shows a brief "{label} Undo" toast; calling onUndo reverts the action. */
  showUndo: (label: string, onUndo: UndoState["onUndo"]) => void;
}

const UndoContext = createContext<UndoContextValue | null>(null);

const DURATION_MS = 8000;

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<UndoState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showUndo = useCallback((label: string, onUndo: UndoState["onUndo"]) => {
    setMessage(null);
    setState({ label, onUndo });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState(null), DURATION_MS);
  }, []);

  async function handleUndo() {
    if (!state) return;
    const { onUndo } = state;
    setState(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    const result = await onUndo();
    if (result && result.ok === false) {
      setMessage(result.error ?? "Couldn't undo that.");
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
      messageTimerRef.current = setTimeout(() => setMessage(null), DURATION_MS);
    }
  }

  return (
    <UndoContext.Provider value={{ showUndo }}>
      {children}
      {(state || message) && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl shadow-lg px-4 py-3 flex items-center gap-4 text-sm font-semibold max-w-[90vw]">
          {state && (
            <>
              <span>{state.label}</span>
              <button className="underline shrink-0" onClick={handleUndo}>
                Undo
              </button>
            </>
          )}
          {message && <span>{message}</span>}
        </div>
      )}
    </UndoContext.Provider>
  );
}

export function useUndo() {
  const ctx = useContext(UndoContext);
  if (!ctx) throw new Error("useUndo must be used within an UndoProvider");
  return ctx;
}
