import type { AppSyncClient } from "./appsync-client";
import type {
  NormalizedSnapshot,
  WeeklySummaryInput,
  UpsertResult,
  SyncStats,
  Logger,
} from "./types";
import type { ParsedComment } from "./comment-parser";

// ─────────────────────────────────────────────────────────────────────────────
// GraphQL documents
// ─────────────────────────────────────────────────────────────────────────────

const GET_SNAPSHOT = /* GraphQL */ `
  query GetCustomerSnapshot($companyName: String!, $week: String!) {
    getCustomerSnapshot(companyName: $companyName, week: $week) {
      companyName
      week
      sourceLastUpdated
    }
  }
`;

const CREATE_SNAPSHOT = /* GraphQL */ `
  mutation CreateCustomerSnapshot($input: CreateCustomerSnapshotInput!) {
    createCustomerSnapshot(input: $input) {
      companyName
      week
    }
  }
`;

const UPDATE_SNAPSHOT = /* GraphQL */ `
  mutation UpdateCustomerSnapshot($input: UpdateCustomerSnapshotInput!) {
    updateCustomerSnapshot(input: $input) {
      companyName
      week
    }
  }
`;

const CREATE_SYNC_JOB = /* GraphQL */ `
  mutation CreateDataSyncJob($input: CreateDataSyncJobInput!) {
    createDataSyncJob(input: $input) {
      id
    }
  }
`;

const UPDATE_SYNC_JOB = /* GraphQL */ `
  mutation UpdateDataSyncJob($input: UpdateDataSyncJobInput!) {
    updateDataSyncJob(input: $input) {
      id
    }
  }
`;

const GET_WEEKLY_SUMMARY = /* GraphQL */ `
  query GetWeeklySummary($week: String!) {
    getWeeklySummary(week: $week) {
      week
    }
  }
`;

const CREATE_WEEKLY_SUMMARY = /* GraphQL */ `
  mutation CreateWeeklySummary($input: CreateWeeklySummaryInput!) {
    createWeeklySummary(input: $input) {
      week
    }
  }
`;

const UPDATE_WEEKLY_SUMMARY = /* GraphQL */ `
  mutation UpdateWeeklySummary($input: UpdateWeeklySummaryInput!) {
    updateWeeklySummary(input: $input) {
      week
    }
  }
`;

const GET_SNOW_COMMENT = /* GraphQL */ `
  query GetSnowComment($companyName: String!, $commentDate: String!) {
    getSnowComment(companyName: $companyName, commentDate: $commentDate) {
      companyName
      commentDate
    }
  }
`;

const CREATE_SNOW_COMMENT = /* GraphQL */ `
  mutation CreateSnowComment($input: CreateSnowCommentInput!) {
    createSnowComment(input: $input) {
      companyName
      commentDate
    }
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Response shapes (only the fields we select)
// ─────────────────────────────────────────────────────────────────────────────

interface SnapshotKey {
  companyName: string;
  week: string;
  sourceLastUpdated?: string | null;
}

interface SyncJobId {
  id: string;
}

interface CommentKey {
  companyName: string;
  commentDate: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync-job lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export async function openSyncJob(
  client: AppSyncClient,
  input: { dataSource: string; triggeredBy: string },
  logger: Logger
): Promise<string | null> {
  try {
    const result = await client.request<{ createDataSyncJob: SyncJobId }>(
      CREATE_SYNC_JOB,
      {
        input: {
          status: "RUNNING",
          startedAt: new Date().toISOString(),
          dataSource: input.dataSource,
          triggeredBy: input.triggeredBy,
        },
      }
    );

    if (result.errors?.length) {
      logger.warn("DataSyncJob.create had errors", { errors: result.errors });
    }

    return result.data?.createDataSyncJob?.id ?? null;
  } catch (err) {
    logger.error("Failed to open DataSyncJob — continuing without audit record", err);
    return null;
  }
}

export async function closeSyncJob(
  client: AppSyncClient,
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
    const res = await client.request<{ updateDataSyncJob: SyncJobId }>(
      UPDATE_SYNC_JOB,
      {
        input: {
          id: jobId,
          status: result.status,
          completedAt: new Date().toISOString(),
          weekIngested: result.weekIngested,
          recordsProcessed: result.recordsProcessed,
          recordsFailed: result.recordsFailed,
          errorMessage: result.errorMessage,
        },
      }
    );

    if (res.errors?.length) {
      logger.warn("DataSyncJob.update had errors", { errors: res.errors });
    }
  } catch (err) {
    logger.error("Failed to close DataSyncJob", err, { jobId });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer snapshot upsert
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertSnapshot(
  client: AppSyncClient,
  snapshot: NormalizedSnapshot,
  logger: Logger
): Promise<UpsertResult> {
  const key = { companyName: snapshot.companyName, week: snapshot.week };
  const log = logger.with(key);

  // 1. Check for an existing record
  const getResult = await client.request<{ getCustomerSnapshot: SnapshotKey | null }>(
    GET_SNAPSHOT,
    key
  );

  if (getResult.errors?.length) {
    log.warn("CustomerSnapshot.get returned errors", { errors: getResult.errors });
  }

  const existing = getResult.data?.getCustomerSnapshot ?? null;

  // 2. No record — create
  if (!existing) {
    const createResult = await client.request<{ createCustomerSnapshot: SnapshotKey }>(
      CREATE_SNAPSHOT,
      { input: snapshot }
    );
    if (createResult.errors?.length) {
      const msg = createResult.errors.map((e) => e.message).join(", ");
      // DynamoDB conditional check failure means the record was created by a concurrent
      // write between our get and create — treat as skipped rather than failed
      if (msg.includes("conditional request failed")) {
        return { action: "skipped", ...key };
      }
      throw new Error(`CustomerSnapshot.create failed: ${msg}`);
    }
    return { action: "created", ...key };
  }

  // 3. Record exists with identical source date — skip
  if (existing.sourceLastUpdated === snapshot.sourceLastUpdated) {
    return { action: "skipped", ...key };
  }

  // 4. Record exists but source has newer data — update
  const updateResult = await client.request<{ updateCustomerSnapshot: SnapshotKey }>(
    UPDATE_SNAPSHOT,
    { input: snapshot }
  );

  if (updateResult.errors?.length) {
    throw new Error(
      `CustomerSnapshot.update failed: ${updateResult.errors.map((e) => e.message).join(", ")}`
    );
  }

  return { action: "updated", ...key };
}

export async function writeSnapshots(
  client: AppSyncClient,
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

export async function upsertWeeklySummary(
  client: AppSyncClient,
  summary: WeeklySummaryInput,
  logger: Logger
): Promise<void> {
  const log = logger.with({ week: summary.week });

  const getResult = await client.request<{ getWeeklySummary: { week: string } | null }>(
    GET_WEEKLY_SUMMARY,
    { week: summary.week }
  );

  if (!getResult.data?.getWeeklySummary) {
    const createResult = await client.request(CREATE_WEEKLY_SUMMARY, { input: summary });
    if (createResult.errors?.length) {
      log.error("WeeklySummary.create failed", undefined, { errors: createResult.errors });
    }
  } else {
    const updateResult = await client.request(UPDATE_WEEKLY_SUMMARY, { input: summary });
    if (updateResult.errors?.length) {
      log.error("WeeklySummary.update failed", undefined, { errors: updateResult.errors });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Snow comment persistence
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertComment(
  client: AppSyncClient,
  comment: ParsedComment & { ingestedAt: string },
  logger: Logger
): Promise<"created" | "skipped"> {
  const key = { companyName: comment.companyName, commentDate: comment.commentDate };

  const getResult = await client.request<{ getSnowComment: CommentKey | null }>(
    GET_SNOW_COMMENT,
    key
  );

  if (getResult.data?.getSnowComment) return "skipped";

  const createResult = await client.request<{ createSnowComment: CommentKey }>(
    CREATE_SNOW_COMMENT,
    { input: comment }
  );

  if (createResult.errors?.length) {
    const msg = createResult.errors.map((e) => e.message).join(", ");
    if (msg.includes("conditional request failed")) return "skipped";
    throw new Error(`SnowComment.create failed: ${msg}`);
  }

  return "created";
}

export async function writeComments(
  client: AppSyncClient,
  comments: ParsedComment[],
  ingestedAt: string,
  logger: Logger,
  concurrency = 20
): Promise<{ created: number; skipped: number; failed: number }> {
  const stats = { created: 0, skipped: 0, failed: 0 };
  if (comments.length === 0) return stats;

  const withTs = comments.map((c) => ({ ...c, ingestedAt }));

  const results = await batchProcess(
    withTs,
    (c) => upsertComment(client, c, logger),
    concurrency
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      stats[r.value]++;
    } else {
      stats.failed++;
    }
  }

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency helper
// ─────────────────────────────────────────────────────────────────────────────

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
