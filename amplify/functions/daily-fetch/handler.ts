import type { EventBridgeEvent, ScheduledEvent, Handler } from "aws-lambda";
import { AppSyncClient } from "./appsync-client";
import { fetchCustomers } from "./api-client";
import {
  normalizeCustomer,
  resolveIngestionWeek,
  computeWeeklySummary,
} from "./normalizer";
import {
  openSyncJob,
  closeSyncJob,
  writeSnapshots,
  upsertWeeklySummary,
  writeComments,
} from "./persistence";
import { Logger } from "./types";
import { parseComments } from "./comment-parser";

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export const handler: Handler<
  EventBridgeEvent<"Scheduled Event", ScheduledEvent>
> = async (event) => {
  const logger = new Logger({ fn: "daily-fetch", triggeredAt: event.time });
  logger.info("Invocation started");

  // ── Validate env ──────────────────────────────────────────────────────────
  // ServiceNow auth: accept either a pre-encoded token or user+password pair.
  const snowUser     = process.env.SERVICENOW_USER;
  const snowPassword = process.env.SERVICENOW_PASSWORD;
  const snowToken    = process.env.SERVICENOW_AUTH_TOKEN;
  const appsyncEndpoint = process.env.APPSYNC_ENDPOINT;
  const appsyncApiKey   = process.env.APPSYNC_API_KEY;

  // Build the auth token from whichever credentials are present
  let servicenowAuthToken: string;
  if (snowToken) {
    servicenowAuthToken = snowToken;
  } else if (snowUser && snowPassword) {
    servicenowAuthToken = Buffer.from(`${snowUser}:${snowPassword}`).toString("base64");
  } else {
    throw new Error(
      "ServiceNow credentials not set — provide SERVICENOW_AUTH_TOKEN or both SERVICENOW_USER and SERVICENOW_PASSWORD"
    );
  }

  if (!appsyncEndpoint) throw new Error("APPSYNC_ENDPOINT is not set");
  if (!appsyncApiKey)   throw new Error("APPSYNC_API_KEY is not set");

  // ── AppSync client (API key auth, no Amplify framework needed) ────────────
  const client = new AppSyncClient(appsyncEndpoint, appsyncApiKey);

  // ── Open audit record ─────────────────────────────────────────────────────
  const jobId = await openSyncJob(
    client,
    { dataSource: "servicenow", triggeredBy: "schedule" },
    logger
  );

  const jobLogger = jobId ? logger.with({ jobId }) : logger;
  let weekIngested = "";

  try {
    // ── 1. Fetch ─────────────────────────────────────────────────────────────
    jobLogger.info("Fetching ASO customer records from ServiceNow");
    const rawRecords = await fetchCustomers(
      { authToken: servicenowAuthToken },
      jobLogger
    );
    jobLogger.info("Fetch complete", { rawRecordCount: rawRecords.length });

    if (rawRecords.length === 0) {
      jobLogger.warn("API returned 0 records — nothing to ingest");
      if (jobId) {
        await closeSyncJob(
          client,
          jobId,
          { status: "COMPLETED", weekIngested: "", recordsProcessed: 0, recordsFailed: 0 },
          jobLogger
        );
      }
      return;
    }

    // ── 2. Normalize ─────────────────────────────────────────────────────────
    const ingestedAt = new Date().toISOString();
    const normalized = [];
    const skippedDuringNorm = [];

    for (const raw of rawRecords) {
      const snap = normalizeCustomer(raw, ingestedAt);
      if (snap) {
        normalized.push(snap);
      } else {
        skippedDuringNorm.push(raw);
      }
    }

    if (skippedDuringNorm.length > 0) {
      jobLogger.warn("Records skipped during normalization (missing companyName or week)", {
        skippedCount: skippedDuringNorm.length,
        samples: skippedDuringNorm.slice(0, 3).map((r) => ({
          companyName: r.companyName,
          week: r.week,
        })),
      });
    }

    jobLogger.info("Normalization complete", {
      normalizedCount: normalized.length,
      skippedCount: skippedDuringNorm.length,
    });

    weekIngested = resolveIngestionWeek(normalized);
    jobLogger.info("Resolved ingestion week", { weekIngested });

    // ── 3. Persist snapshots ─────────────────────────────────────────────────
    jobLogger.info("Writing snapshots to AppSync");
    const stats = await writeSnapshots(client, normalized, jobLogger);

    jobLogger.info("Snapshot write complete", {
      created: stats.created,
      updated: stats.updated,
      skipped: stats.skipped,
      failed: stats.failed,
    });

    if (stats.errors.length > 0) {
      jobLogger.error("Some snapshots failed to write", undefined, {
        errorCount: stats.errors.length,
        errors: stats.errors.slice(0, 10),
        additionalErrors: Math.max(0, stats.errors.length - 10),
      });
    }

    // ── 3b. Parse and persist ServiceNow comments ────────────────────────────
    const allComments = normalized.flatMap((snap) =>
      parseComments(snap.companyName, snap.comments ?? "")
    );
    if (allComments.length > 0) {
      jobLogger.info("Writing ServiceNow comments", { commentCount: allComments.length });
      const commentStats = await writeComments(client, allComments, ingestedAt, jobLogger);
      jobLogger.info("Comment write complete", commentStats);
    }

    // ── 4. Persist weekly summary ────────────────────────────────────────────
    if (weekIngested) {
      const summary = computeWeeklySummary(weekIngested, normalized);
      await upsertWeeklySummary(client, summary, jobLogger);
      jobLogger.info("WeeklySummary upserted", { week: weekIngested });
    }

    // ── 5. Close audit record ────────────────────────────────────────────────
    if (jobId) {
      await closeSyncJob(
        client,
        jobId,
        {
          status: stats.failed > 0 && stats.created + stats.updated === 0
            ? "FAILED"
            : "COMPLETED",
          weekIngested,
          recordsProcessed: stats.created + stats.updated + stats.skipped,
          recordsFailed: stats.failed,
        },
        jobLogger
      );
    }

    jobLogger.info("Invocation complete", {
      weekIngested,
      created: stats.created,
      updated: stats.updated,
      skipped: stats.skipped,
      failed: stats.failed,
    });
  } catch (err) {
    jobLogger.error("Invocation failed with unhandled error", err);

    if (jobId) {
      await closeSyncJob(
        client,
        jobId,
        {
          status: "FAILED",
          weekIngested,
          recordsProcessed: 0,
          recordsFailed: 0,
          errorMessage: err instanceof Error ? err.message : String(err),
        },
        jobLogger
      );
    }

    // Re-throw so EventBridge Scheduler can observe the failure and retry
    throw err;
  }
};
