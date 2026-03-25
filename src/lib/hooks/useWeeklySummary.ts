"use client";

import { useEffect, useReducer } from "react";
import { dataClient } from "@/lib/data-client";
import { toWeeklySummary } from "@/lib/mappers";
import type { WeeklySummary } from "@/lib/types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: WeeklySummary | null }
  | { status: "error"; message: string };

type Action =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; data: WeeklySummary | null }
  | { type: "FETCH_ERROR"; message: string };

function reducer(_: State, action: Action): State {
  switch (action.type) {
    case "FETCH_START":   return { status: "loading" };
    case "FETCH_SUCCESS": return { status: "success", data: action.data };
    case "FETCH_ERROR":   return { status: "error", message: action.message };
  }
}

export interface UseWeeklySummaryResult {
  data: WeeklySummary | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetch the pre-computed WeeklySummary for a given week from the browser.
 * Returns null data (not an error) when no summary exists for the given week yet.
 */
export function useWeeklySummary(week: string): UseWeeklySummaryResult {
  const [state, dispatch] = useReducer(reducer, { status: "idle" });

  useEffect(() => {
    if (!week) return;

    let cancelled = false;
    dispatch({ type: "FETCH_START" });

    dataClient.models.WeeklySummary.get({ week })
      .then(({ data, errors }) => {
        if (cancelled) return;
        if (errors?.length) {
          dispatch({ type: "FETCH_ERROR", message: errors[0].message });
        } else {
          dispatch({
            type: "FETCH_SUCCESS",
            data: data ? toWeeklySummary(data) : null,
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        dispatch({
          type: "FETCH_ERROR",
          message: err instanceof Error ? err.message : "Failed to load summary",
        });
      });

    return () => { cancelled = true; };
  }, [week]);

  return {
    data:      state.status === "success" ? state.data : null,
    isLoading: state.status === "loading" || state.status === "idle",
    error:     state.status === "error" ? state.message : null,
  };
}
