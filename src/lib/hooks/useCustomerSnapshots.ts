"use client";

import { useCallback, useEffect, useReducer } from "react";
import { dataClient } from "@/lib/data-client";
import { toCustomer } from "@/lib/mappers";
import type { Customer } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// State machine — avoids impossible states (e.g. isLoading + error both set)
// ─────────────────────────────────────────────────────────────────────────────

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: Customer[] }
  | { status: "error"; message: string };

type Action =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; data: Customer[] }
  | { type: "FETCH_ERROR"; message: string };

function reducer(_: State, action: Action): State {
  switch (action.type) {
    case "FETCH_START":   return { status: "loading" };
    case "FETCH_SUCCESS": return { status: "success", data: action.data };
    case "FETCH_ERROR":   return { status: "error", message: action.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export interface UseCustomerSnapshotsResult {
  data: Customer[];
  isLoading: boolean;
  error: string | null;
  /** Re-fetch without changing the week — useful for manual refresh buttons. */
  refresh: () => void;
}

/**
 * Fetch all CustomerSnapshots for a given week from the browser.
 * Uses the public API key — no user session required.
 *
 * Re-fetches whenever `week` changes.
 * Re-fetches when `refresh()` is called.
 *
 * Note: for SSR pages, prefer passing pre-fetched data from a Server Component
 * rather than triggering a redundant client-side fetch on mount.
 */
export function useCustomerSnapshots(
  week: string,
  limit = 1000
): UseCustomerSnapshotsResult {
  const [state, dispatch] = useReducer(reducer, { status: "idle" });
  // A simple counter that `refresh()` increments to re-trigger the effect
  const [tick, triggerRefresh] = useReducer((n: number) => n + 1, 0);

  const refresh = useCallback(() => triggerRefresh(), []);

  useEffect(() => {
    if (!week) return;

    let cancelled = false;
    dispatch({ type: "FETCH_START" });

    dataClient.models.CustomerSnapshot.listCustomerSnapshotByWeekAndCompanyName(
      { week },
      { sortDirection: "ASC", limit }
    )
      .then(({ data, errors }) => {
        if (cancelled) return;
        if (errors?.length) {
          dispatch({ type: "FETCH_ERROR", message: errors[0].message });
        } else {
          dispatch({ type: "FETCH_SUCCESS", data: (data ?? []).map(toCustomer) });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        dispatch({
          type: "FETCH_ERROR",
          message: err instanceof Error ? err.message : "Failed to load customers",
        });
      });

    return () => { cancelled = true; };
  }, [week, limit, tick]);

  return {
    data:      state.status === "success" ? state.data : [],
    isLoading: state.status === "loading" || state.status === "idle",
    error:     state.status === "error" ? state.message : null,
    refresh,
  };
}
