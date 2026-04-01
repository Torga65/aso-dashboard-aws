import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

const syncJobStatus = a.enum(["RUNNING", "COMPLETED", "FAILED"]);

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

const schema = a.schema({
  SyncJobStatus: syncJobStatus,

  /**
   * CustomerSnapshot
   *
   * One record per customer per week, written by the daily-fetch Lambda.
   * Fields map 1-to-1 with the Customer interface in src/lib/types.ts.
   *
   * Primary key:  (companyName, week)  — natural composite key that prevents
   *               duplicate ingestion if the Lambda runs more than once per day.
   *
   * Secondary indexes:
   *   - byWeek:    list all customers for a given week  (main dashboard query)
   *   - byCompany: list all weeks for one customer      (history page query)
   *
   * Access:
   *   - Lambda writes via AppSync API key (injected as APPSYNC_API_KEY env var).
   *   - Server-side Next.js reads via API key (no user session required).
   *   - Authenticated dashboard users can also read (Cognito user pool).
   */
  CustomerSnapshot: a
    .model({
      // ── Natural composite key ──────────────────────────────────────────
      companyName: a.string().required(),
      week: a.string().required(), // ISO date of the Monday, e.g. "2026-01-23"

      // ── Core customer fields ──────────────────────────────────────────
      licenseType: a.string(),
      industry: a.string(),
      eseLead: a.string(),
      status: a.string(), // "Active" | "At-Risk" | "Onboarding" | "Churned" | …
      deploymentType: a.string(),
      engagement: a.string(), // "High" | "Medium" | "Low" | "Unknown"
      blockersStatus: a.string(),
      blockers: a.string(),
      feedbackStatus: a.string(),
      feedback: a.string(),
      healthScore: a.integer(), // 0–100
      summary: a.string(),
      mau: a.string(), // Monthly Active Users (raw string from source)
      ttiv: a.string(), // Time to Initial Value
      autoOptimizeButtonPressed: a.string(),

      // ── Ingestion metadata ────────────────────────────────────────────
      imsOrgId: a.string(), // IMS Org ID from ServiceNow (u_ims_org_id)
      tenantId: a.string(), // Tenant ID from ServiceNow (u_tenant_id)
      terminationReason: a.string(), // Termination reason from ServiceNow (u_termination_reason)
      comments: a.string(), // Comments from ServiceNow (u_comments)
      sourceLastUpdated: a.string(), // "lastUpdated" from the source record
      ingestedAt: a.datetime().required(), // when the Lambda wrote this record
      dataSource: a.string(), // "ServiceNow" | "Manual"
    })
    .identifier(["companyName", "week"])
    .secondaryIndexes((index) => [
      index("week").sortKeys(["companyName"]),    // query: byWeek(week, ...)
      index("companyName").sortKeys(["week"]),    // query: byCompany(companyName, ...)
    ])
    .authorization((allow) => [
      allow.publicApiKey(), // Lambda + server-side + frontend: full CRUD via API key
    ]),

  /**
   * WeeklySummary
   *
   * Pre-computed aggregate stats for one week, written by the Lambda at the
   * end of each ingestion run. Saves the frontend from summing 600 rows.
   *
   * Primary key: week (one summary per week, overwrites on re-ingestion).
   *
   * Access: same as CustomerSnapshot — Lambda writes, everyone reads.
   */
  WeeklySummary: a
    .model({
      week: a.string().required(), // ISO date, e.g. "2026-01-23"

      // ── Counts ────────────────────────────────────────────────────────
      totalCustomers: a.integer(),
      activeCount: a.integer(),
      atRiskCount: a.integer(),
      onboardingCount: a.integer(),
      preProductionCount: a.integer(),
      churnedCount: a.integer(),

      // ── Aggregates ────────────────────────────────────────────────────
      avgHealthScore: a.float(),
      highEngagementCount: a.integer(),
      mediumEngagementCount: a.integer(),
      lowEngagementCount: a.integer(),

      // ── Ingestion metadata ────────────────────────────────────────────
      computedAt: a.datetime().required(),
      dataSource: a.string(),
    })
    .identifier(["week"])
    .authorization((allow) => [
      allow.publicApiKey(), // Lambda + server-side + frontend: full CRUD via API key
    ]),

  /**
   * DataSyncJob
   *
   * Audit log — one record per Lambda execution. Lets the dashboard show
   * "Last synced: 2026-01-24 00:03 UTC" and surface failed runs for ops.
   *
   * Auto-generated `id` (UUID) is used as the primary key; multiple jobs can
   * run on the same day (manual re-triggers, retries).
   *
   * Access:
   *   - Lambda writes via AppSync API key.
   *   - Only authenticated users can read (not exposed to public API key callers).
   */
  DataSyncJob: a
    .model({
      status: a.ref("SyncJobStatus").required(),
      startedAt: a.datetime().required(),
      completedAt: a.datetime(),
      weekIngested: a.string(), // which week's data was processed
      recordsProcessed: a.integer(),
      recordsFailed: a.integer(),
      errorMessage: a.string(),
      dataSource: a.string(), // origin of the data
      triggeredBy: a.string(), // "schedule" | "manual"
    })
    .secondaryIndexes((index) => [
      index("status").sortKeys(["startedAt"]), // query: list recent failures, etc.
    ])
    .authorization((allow) => [
      allow.publicApiKey(), // Lambda writes + frontend reads via API key
    ]),

  /**
   * CustomerNote
   *
   * Authenticated-user annotations layered on top of ingested snapshots.
   * Supports the "edit" workflow from customer-history-edit.html without
   * mutating source records.
   *
   * (companyName + week) links a note to the corresponding CustomerSnapshot.
   *
   * Access:
   *   - Owners can create, update, and delete their own notes.
   *   - Any authenticated user can read all notes (shared across the team).
   *   - Not accessible to unauthenticated / API key callers.
   */
  CustomerNote: a
    .model({
      companyName: a.string().required(),
      week: a.string().required(),
      note: a.string().required(),
    })
    .secondaryIndexes((index) => [
      index("companyName").sortKeys(["week"]), // list all notes for a company
    ])
    .authorization((allow) => [
      allow.publicApiKey(), // full CRUD via API key (site protected by Hosting Basic Auth)
    ]),

  /**
   * CustomerOrgMapping
   *
   * Persists the manually-confirmed SpaceCat org UUID for each customer.
   * Written when an ESE selects an org from the org-picker on the history page.
   * Read by the quick-ref service so subsequent loads skip the fuzzy-match step.
   *
   * Primary key: companyName (one record per customer, upserted on change).
   */
  CustomerOrgMapping: a
    .model({
      companyName: a.string().required(),
      spacecatOrgId: a.string().required(),
      updatedBy: a.string(),
    })
    .identifier(["companyName"])
    .authorization((allow) => [
      allow.publicApiKey(),
    ]),

  /**
   * SnowComment
   *
   * Individual comment entries parsed from the ServiceNow u_comments field.
   * One row per comment entry per customer. Keyed by (companyName, commentDate)
   * so re-ingestion is idempotent.
   *
   * commentDate: raw "YYYY-MM-DD HH:MM:SS" string from the comment header.
   */
  SnowComment: a
    .model({
      companyName: a.string().required(),
      commentDate: a.string().required(), // "2025-10-07 12:01:17"
      author: a.string(),
      body: a.string(),
      ingestedAt: a.datetime().required(),
    })
    .identifier(["companyName", "commentDate"])
    .secondaryIndexes((index) => [
      index("companyName").sortKeys(["commentDate"]),
    ])
    .authorization((allow) => [
      allow.publicApiKey(),
    ]),
});

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "apiKey",
    apiKeyAuthorizationMode: {
      expiresInDays: 365,
    },
  },
});
