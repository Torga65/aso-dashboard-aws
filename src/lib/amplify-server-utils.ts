import { createServerRunner } from "@aws-amplify/adapter-nextjs";
import { generateServerClientUsingCookies } from "@aws-amplify/adapter-nextjs/data";
import { cookies } from "next/headers";
import outputs from "../../amplify_outputs.json";
import type { Schema } from "../../amplify/data/resource";

/**
 * Server-side Amplify runner.
 * Used in Server Components, Route Handlers, and Server Actions.
 */
export const { runWithAmplifyServerContext } = createServerRunner({
  config: outputs,
});

/**
 * API-key client — use in Server Components for public data
 * (CustomerSnapshot, WeeklySummary).
 * No Cognito session required; safe for SSR and static generation.
 */
export function getServerClient() {
  return generateServerClientUsingCookies<Schema>({
    config: outputs,
    cookies,
    authMode: "apiKey",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed query helpers — keep data-fetching logic out of page files
// ─────────────────────────────────────────────────────────────────────────────

/** All CustomerSnapshots for a given week, sorted by company name. */
export async function getSnapshotsByWeek(week: string) {
  const client = getServerClient();
  const { data, errors } = await client.models.CustomerSnapshot.listCustomerSnapshotByWeek(
    { week },
    { sortDirection: "ASC", limit: 1000 }
  );
  if (errors) console.error("getSnapshotsByWeek", errors);
  return data ?? [];
}

/** Full history for one company, oldest-first. */
export async function getSnapshotsByCompany(companyName: string) {
  const client = getServerClient();
  const { data, errors } = await client.models.CustomerSnapshot.listCustomerSnapshotByCompany(
    { companyName },
    { sortDirection: "ASC", limit: 100 }
  );
  if (errors) console.error("getSnapshotsByCompany", errors);
  return data ?? [];
}

/** Pre-computed summary for a single week. */
export async function getWeeklySummary(week: string) {
  const client = getServerClient();
  const { data, errors } = await client.models.WeeklySummary.get({ week });
  if (errors) console.error("getWeeklySummary", errors);
  return data ?? null;
}

/** Most-recent N sync jobs — for an ops status banner. */
export async function getRecentSyncJobs(limit = 5) {
  const client = getServerClient();
  const { data, errors } = await client.models.DataSyncJob.list({ limit });
  if (errors) console.error("getRecentSyncJobs", errors);
  return data ?? [];
}
