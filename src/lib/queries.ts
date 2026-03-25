/**
 * queries.ts  — server-side data access layer
 *
 * All functions run in React Server Components (or Route Handlers).
 * They MUST NOT be imported by Client Components — use the hooks in
 * lib/hooks/ for browser-side fetching instead.
 *
 * Every function returns a typed QueryResult<T>:
 *   { data: T;    error: null }   — success
 *   { data: null; error: string } — failure
 *
 * Callers decide how to handle each path; nothing is silently swallowed.
 */
import { getServerClient } from "./amplify-server-utils";
import type { Customer, WeeklySummary, SyncJobRecord, CustomerNote, QueryResult } from "./types";
import { toCustomer, toWeeklySummary, toSyncJob, toCustomerNote } from "./mappers";

// ─────────────────────────────────────────────────────────────────────────────
// CustomerSnapshot queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All CustomerSnapshots for a given week, sorted alphabetically by company.
 * Primary query for the overview and engagement table pages.
 */
export async function getCustomersByWeek(
  week: string,
  limit = 1000
): Promise<QueryResult<Customer[]>> {
  try {
    const client = getServerClient();
    const { data, errors } =
      await client.models.CustomerSnapshot.listCustomerSnapshotByWeek(
        { week },
        { sortDirection: "ASC", limit }
      );
    if (errors?.length) {
      return { data: null, error: errors[0].message };
    }
    return { data: (data ?? []).map(toCustomer), error: null };
  } catch (err) {
    return { data: null, error: toMessage(err, "Failed to load customers") };
  }
}

/**
 * Full week-by-week history for one company, oldest first.
 * Used by the customer history page.
 */
export async function getCustomerHistory(
  companyName: string
): Promise<QueryResult<Customer[]>> {
  try {
    const client = getServerClient();
    const { data, errors } =
      await client.models.CustomerSnapshot.listCustomerSnapshotByCompany(
        { companyName },
        { sortDirection: "ASC", limit: 100 }
      );
    if (errors?.length) {
      return { data: null, error: errors[0].message };
    }
    return { data: (data ?? []).map(toCustomer), error: null };
  } catch (err) {
    return { data: null, error: toMessage(err, "Failed to load customer history") };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WeeklySummary queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pre-computed stats for one week — used by the stat cards on the overview page.
 * Returns null data (not an error) when the week hasn't been ingested yet.
 */
export async function getWeeklySummaryStats(
  week: string
): Promise<QueryResult<WeeklySummary | null>> {
  try {
    const client = getServerClient();
    const { data, errors } = await client.models.WeeklySummary.get({ week });
    if (errors?.length) {
      return { data: null, error: errors[0].message };
    }
    return { data: data ? toWeeklySummary(data) : null, error: null };
  } catch (err) {
    return { data: null, error: toMessage(err, "Failed to load weekly summary") };
  }
}

/**
 * All weeks that have a WeeklySummary record, newest first.
 * Used to populate the week selector in the engagement table.
 */
export async function getAvailableWeeks(): Promise<QueryResult<string[]>> {
  try {
    const client = getServerClient();
    // WeeklySummary has at most one record per week (≤52 records/year).
    // Listing all and sorting client-side is cheaper than a full scan of CustomerSnapshot.
    const { data, errors } = await client.models.WeeklySummary.list({ limit: 200 });
    if (errors?.length) {
      return { data: null, error: errors[0].message };
    }
    const weeks = (data ?? [])
      .map((r) => r.week)
      .sort((a, b) => b.localeCompare(a)); // newest first
    return { data: weeks, error: null };
  } catch (err) {
    return { data: null, error: toMessage(err, "Failed to load available weeks") };
  }
}

/**
 * Resolve the most recent week that has data.
 * Returns null if no data has been ingested yet.
 */
export async function getLatestWeek(): Promise<QueryResult<string | null>> {
  const result = await getAvailableWeeks();
  if (result.error) return result;
  const latest = result.data[0] ?? null;
  return { data: latest, error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// DataSyncJob queries  (authenticated — requires a signed-in user)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The single most recent sync job — used in the SyncStatusBanner.
 * Returns null data (not an error) if no jobs have run yet.
 */
export async function getLatestSyncJob(): Promise<QueryResult<SyncJobRecord | null>> {
  try {
    const client = getServerClient();
    // List is sorted by createdAt DESC by default; we only need 1.
    const { data, errors } = await client.models.DataSyncJob.list({ limit: 1 });
    if (errors?.length) {
      return { data: null, error: errors[0].message };
    }
    const latest = data?.[0] ?? null;
    return { data: latest ? toSyncJob(latest) : null, error: null };
  } catch (err) {
    return { data: null, error: toMessage(err, "Failed to load sync status") };
  }
}

/**
 * Recent sync jobs for an ops log view.
 */
export async function getRecentSyncJobs(
  limit = 10
): Promise<QueryResult<SyncJobRecord[]>> {
  try {
    const client = getServerClient();
    const { data, errors } = await client.models.DataSyncJob.list({ limit });
    if (errors?.length) {
      return { data: null, error: errors[0].message };
    }
    return { data: (data ?? []).map(toSyncJob), error: null };
  } catch (err) {
    return { data: null, error: toMessage(err, "Failed to load sync jobs") };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CustomerNote queries  (authenticated — requires a signed-in user)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All notes for a given company across all weeks.
 */
export async function getNotesByCompany(
  companyName: string
): Promise<QueryResult<CustomerNote[]>> {
  try {
    const client = getServerClient();
    const { data, errors } =
      await client.models.CustomerNote.listCustomerNoteByCompanyName(
        { companyName },
        { sortDirection: "DESC", limit: 100 }
      );
    if (errors?.length) {
      return { data: null, error: errors[0].message };
    }
    return { data: (data ?? []).map(toCustomerNote), error: null };
  } catch (err) {
    return { data: null, error: toMessage(err, "Failed to load notes") };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper
// ─────────────────────────────────────────────────────────────────────────────

function toMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
