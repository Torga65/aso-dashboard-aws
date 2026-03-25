import type { Client } from "aws-amplify/data";
import type { Schema } from "../../data/resource";
import type {
  NormalizedSnapshot,
  WeeklySummaryInput,
  UpsertResult,
  SyncStats,
  Logger,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Sync-job lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open a DataSyncJob record in status RUNNING.
 * Returns null on failure — the handler continues without an audit record
 * rather than aborting the entire run over a metadata write.
 */
export async function openSyncJob(
  client: Client<Schema>,
  input: { dataSource: string; triggeredBy: string },
  logger: Logger
): Promise<string | null> {
  try {
    const { data, errors } = await client.models.DataSyncJob.create({
      status: "RUNNING",
      startedAt: new Date().toISOString(),
      dataSource: input.dataSource,
      triggeredBy: input.triggeredBy,
    });

    if (errors?.length) {
      logger.warn("DataSyncJob.create had errors", { errors });
    }

    return data?.id ?? null;
  } catch (err) {
    logger.error("Failed to open DataSyncJob — continuing without audit record", err);
    return null;
  }
}

/**
 * Close an open DataSyncJob with the final status and stats.
 * Errors here are logged but not re-thrown — the run already succeeded or failed.
 */
export async function closeSyncJob(
  client: Client<Schema>,
  jobId: string,
  result: {
    status: "COMPLETED" | "FAILED";
    weekIngested: string;
    recordsProcessed: number;
    recordsFailed: number;
    errorMessage?: string;
  },
  logger: Logger
): Promise<void> {
  try {
    const { errors } = await client.models.DataSyncJob.update({
      id: jobId,
      status: result.status,
      completedAt: new Date().toISOString(),
      weekIngested: result.weekIngested,
      recordsProcessed: result.recordsProcessed,
      recordsFailed: result.recordsFailed,
      errorMessage: result.errorMessage,
    });

    if (errors?.length) {
      logger.warn("DataSyncJob.update had errors", { errors });
    }
  } catch (err) {
    logger.error("Failed to close DataSyncJob", err, { jobId });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer snapshot upsert
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Idempotent upsert for a single CustomerSnapshot.
 *
 * Strategy:
 *   1. GET the existing record by the composite key (companyName, week).
 *   2. If it doesn't exist → CREATE.
 *   3. If it exists and sourceLastUpdated hasn't changed → SKIP (no write).
 *   4. If it exists and sourceLastUpdated changed → UPDATE only changed fields.
 *
 * This means running the Lambda twice with the same source data produces
 * exactly one write on the first run and zero writes on subsequent runs.
 */
export async function upsertSnapshot(
  client: Client<Schema>,
  snapshot: NormalizedSnapshot,
  logger: Logger
): Promise<UpsertResult> {
  const key = { companyName: snapshot.companyName, week: snapshot.week };
  const log = logger.with(key);

  // 1. Check for an existing record
  const { data: existing, errors: getErrors } =
    await client.models.CustomerSnapshot.get(key);

  if (getErrors?.length) {
    log.warn("CustomerSnapshot.get returned errors", { errors: getErrors });
  }

  // 2. No record — create
  if (!existing) {
    const { errors } = await client.models.CustomerSnapshot.create(snapshot);
    if (errors?.length) {
      throw new Error(
        `CustomerSnapshot.create failed: ${errors.map((e) => e.message).join(", ")}`
      );
    }
    return { action: "created", ...key };
  }

  // 3. Record exists with identical source date — skip
  if (existing.sourceLastUpdated === snapshot.sourceLastUpdated) {
    return { action: "skipped", ...key };
  }

  // 4. Record exists but source has newer data — update
  const { errors } = await client.models.CustomerSnapshot.update({
    ...snapshot,
    // Re-stamp ingestedAt so we know when this refresh happened
    ingestedAt: snapshot.ingestedAt,
  });

  if (errors?.length) {
    throw new Error(
      `CustomerSnapshot.update failed: ${errors.map((e) => e.message).join(", ")}`
    );
  }

  return { action: "updated", ...key };
}

/**
 * Write all snapshots to DynamoDB with controlled concurrency.
 * Processes items in batches of `concurrency` to avoid flooding AppSync.
 * Returns aggregated SyncStats including per-record errors.
 */
export async function writeSnapshots(
  client: Client<Schema>,
  snapshots: NormalizedSnapshot[],
  logger: Logger,
  concurrency = 20
): Promise<SyncStats> {
  const stats: SyncStats = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const results = await batchProcess(
    snapshots,
    (snap) => upsertSnapshot(client, snap, logger),
    concurrency
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      stats[result.value.action]++;
    } else {
      stats.failed++;
      const snap = snapshots[i];
      const reason =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      stats.errors.push({ companyName: snap.companyName, week: snap.week, reason });
      logger.error("Snapshot upsert failed", result.reason, {
        companyName: snap.companyName,
        week: snap.week,
      });
    }
  }

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekly summary upsert
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create or replace the WeeklySummary for a given week.
 * Always overwrites — the summary is fully recomputed from the batch.
 */
export async function upsertWeeklySummary(
  client: Client<Schema>,
  summary: WeeklySummaryInput,
  logger: Logger
): Promise<void> {
  const log = logger.with({ week: summary.week });

  // WeeklySummary uses week as its identifier — check first to decide create vs update
  const { data: existing } = await client.models.WeeklySummary.get({
    week: summary.week,
  });

  if (!existing) {
    const { errors } = await client.models.WeeklySummary.create(summary);
    if (errors?.length) {
      log.error("WeeklySummary.create failed", undefined, { errors });
    }
  } else {
    const { errors } = await client.models.WeeklySummary.update(summary);
    if (errors?.length) {
      log.error("WeeklySummary.update failed", undefined, { errors });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process `items` with at most `concurrency` in-flight promises at a time.
 * Unlike Promise.all, this never starts more than `concurrency` requests
 * simultaneously, keeping DynamoDB/AppSync write traffic predictable.
 */
async function batchProcess<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fn));
    results.push(...batchResults);
  }

  return results;
}
