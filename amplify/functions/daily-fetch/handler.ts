import type { EventBridgeEvent, ScheduledEvent, Handler } from "aws-lambda";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import type { Schema } from "../../data/resource";
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
} from "./persistence";
import { Logger } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export const handler: Handler<
  EventBridgeEvent<"Scheduled Event", ScheduledEvent>
> = async (event) => {
  const logger = new Logger({ fn: "daily-fetch", triggeredAt: event.time });
  logger.info("Invocation started");

  // ── Validate env ──────────────────────────────────────────────────────────
  const apiKey = process.env.EXTERNAL_API_KEY;
  const apiBaseUrl = process.env.EXTERNAL_API_BASE_URL;

  if (!apiKey)      throw new Error("EXTERNAL_API_KEY is not set");
  if (!apiBaseUrl)  throw new Error("EXTERNAL_API_BASE_URL is not set");

  // ── Configure Amplify for IAM-authenticated Lambda access ─────────────────
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(
    process.env as Record<string, string>
  );
  Amplify.configure(resourceConfig, libraryOptions);
  const client = generateClient<Schema>();

  // ── Open audit record ─────────────────────────────────────────────────────
  const jobId = await openSyncJob(
    client,
    { dataSource: "external-api", triggeredBy: "schedule" },
    logger
  );

  const jobLogger = jobId ? logger.with({ jobId }) : logger;
  let weekIngested = "";

  try {
    // ── 1. Fetch ─────────────────────────────────────────────────────────────
    jobLogger.info("Fetching data from external API");
    const rawRecords = await fetchCustomers(
      { baseUrl: apiBaseUrl, apiKey },
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
    jobLogger.info("Writing snapshots to DynamoDB");
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
        // Log first 10 errors in full; the rest are counted
        errors: stats.errors.slice(0, 10),
        additionalErrors: Math.max(0, stats.errors.length - 10),
      });
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
