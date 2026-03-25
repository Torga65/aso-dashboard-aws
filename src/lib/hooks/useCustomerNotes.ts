"use client";

import { useCallback, useEffect, useReducer } from "react";
import { dataClient } from "@/lib/data-client";
import { toCustomerNote } from "@/lib/mappers";
import type { CustomerNote } from "@/lib/types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: CustomerNote[] }
  | { status: "error"; message: string };

type Action =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; data: CustomerNote[] }
  | { type: "FETCH_ERROR"; message: string };

function reducer(_: State, action: Action): State {
  switch (action.type) {
    case "FETCH_START":   return { status: "loading" };
    case "FETCH_SUCCESS": return { status: "success", data: action.data };
    case "FETCH_ERROR":   return { status: "error", message: action.message };
  }
}

export interface UseCustomerNotesResult {
  data: CustomerNote[];
  isLoading: boolean;
  error: string | null;
  /** Call after a successful create/update/delete to refresh the list. */
  refresh: () => void;
  /** Create a new note and refresh. Returns the error message on failure. */
  addNote: (note: string) => Promise<string | null>;
  /** Delete a note by id and refresh. Returns the error message on failure. */
  deleteNote: (id: string) => Promise<string | null>;
}

/**
 * Fetch and manage CustomerNotes for a specific company + week.
 * Requires the user to be signed in (owner-based auth).
 *
 * `addNote` and `deleteNote` optimistically call the Amplify mutation and
 * then refresh the list; callers should handle the returned error string.
 */
export function useCustomerNotes(
  companyName: string,
  week: string
): UseCustomerNotesResult {
  const [state, dispatch] = useReducer(reducer, { status: "idle" });
  const [tick, triggerRefresh] = useReducer((n: number) => n + 1, 0);
  const refresh = useCallback(() => triggerRefresh(), []);

  useEffect(() => {
    if (!companyName || !week) return;

    let cancelled = false;
    dispatch({ type: "FETCH_START" });

    dataClient.models.CustomerNote.listCustomerNoteByCompanyNameAndWeek(
      { companyName },
      { sortDirection: "DESC", limit: 100 }
    )
      .then(({ data, errors }) => {
        if (cancelled) return;
        if (errors?.length) {
          dispatch({ type: "FETCH_ERROR", message: errors[0].message });
          return;
        }
        // Filter to the requested week client-side
        // (the GSI sorts by week, but we want the caller interface to be simple)
        const filtered = (data ?? [])
          .filter((n) => n.week === week)
          .map(toCustomerNote);
        dispatch({ type: "FETCH_SUCCESS", data: filtered });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        dispatch({
          type: "FETCH_ERROR",
          message: err instanceof Error ? err.message : "Failed to load notes",
        });
      });

    return () => { cancelled = true; };
  }, [companyName, week, tick]);

  const addNote = useCallback(
    async (note: string): Promise<string | null> => {
      try {
        const { errors } = await dataClient.models.CustomerNote.create({
          companyName,
          week,
          note,
        });
        if (errors?.length) return errors[0].message;
        refresh();
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : "Failed to add note";
      }
    },
    [companyName, week, refresh]
  );

  const deleteNote = useCallback(
    async (id: string): Promise<string | null> => {
      try {
        const { errors } = await dataClient.models.CustomerNote.delete({ id });
        if (errors?.length) return errors[0].message;
        refresh();
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : "Failed to delete note";
      }
    },
    [refresh]
  );

  return {
    data:       state.status === "success" ? state.data : [],
    isLoading:  state.status === "loading" || state.status === "idle",
    error:      state.status === "error" ? state.message : null,
    refresh,
    addNote,
    deleteNote,
  };
}
