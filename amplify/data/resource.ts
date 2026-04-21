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
      customFields: a.json(), // arbitrary key-value pairs added via the edit form
      hidden: a.boolean(),   // if true, exclude from all customer lists
      headless: a.boolean(), // customer is running headless (true = Yes)
      preflightEnabled: a.boolean(), // customer has Preflight enabled (true = Yes)
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

  /**
   * MeetingTranscript
   *
   * Stores VTT transcript and attendance files uploaded by ESEs for customer meetings.
   * Auto-generated id is the PK. GSI on companyName+meetingDate for per-customer queries.
   *
   * DynamoDB has a 400 KB item limit — the API enforces a 350 KB max on content.
   */
  MeetingTranscript: a
    .model({
      companyName: a.string().required(),
      meetingDate: a.string().required(), // "YYYY-MM-DD"
      fileType: a.string().required(),    // "transcript" | "attendance"
      fileName: a.string().required(),
      description: a.string(),            // user-provided summary / tags for MCP search
      content: a.string().required(),     // raw VTT text (≤ 350 KB)
      uploadedBy: a.string(),
      uploadedAt: a.datetime().required(),
    })
    .secondaryIndexes((index) => [
      index("companyName").sortKeys(["meetingDate"]),
    ])
    .authorization((allow) => [
      allow.publicApiKey(),
    ]),

  /**
   * CustomerProgression
   *
   * One record per customer tracking their current position in the
   * Moving / On Hold pipeline. Written by dashboard users via PUT /api/progression.
   *
   * Primary key: companyName (one row per customer, upserted on change).
   */
  CustomerProgression: a
    .model({
      companyName:      a.string().required(),
      progressionTrack: a.string().required(), // "Moving" | "On Hold"
      progressionStage: a.string().required(), // "Prod" | "POC" | "Preprod" | "Future Date" | "Migration"
      migrationSource:  a.string(),            // "On Prem" | "AMS" — only when stage=Migration
      migrationTech:    a.string(),            // "AEM" | "Not AEM" — only when source=On Prem
      stageEnteredAt:       a.string().required(), // "YYYY-MM-DD"
      updatedBy:            a.string().required(),
      updatedAt:            a.string().required(), // ISO datetime
      notes:                a.string(),
      // On Hold + Future Date fields
      projectedGoLiveDate:      a.string(),     // "YYYY-MM-DD" — only when track=On Hold & stage=Future Date
      holdReason:               a.string(),     // "Customer requested" | "Security" | "Competing priorities" | "Other"
      holdReasonOther:          a.string(),     // free text — only when holdReason=Other
      // Active (Moving) + Preprod checklist
      preprodOnboardFirstSite:   a.boolean(),  // on-board first site completed
      preprodFcmCompleted:       a.boolean(),  // FCM completed
      preprodPreflightCompleted: a.boolean(),  // pre-flight completed
      // Active (Moving) + Prod checklist
      prodAutoOptimizeEnabled:          a.boolean(), // auto-optimize enabled
      prodAutoOptimizedOpportunity:     a.boolean(), // customer deployed an auto-optimized opportunity
    })
    .identifier(["companyName"])
    .authorization((allow) => [
      allow.publicApiKey(),
    ]),

  /**
   * CustomerStageHistory
   *
   * Append-only log of every stage change for every customer.
   * Written atomically alongside CustomerProgression upserts.
   * PK: auto UUID. GSI: companyName + changedAt for per-customer timeline queries.
   */
  CustomerStageHistory: a
    .model({
      companyName:      a.string().required(),
      changedAt:        a.string().required(), // ISO datetime
      progressionTrack: a.string().required(),
      progressionStage: a.string().required(),
      migrationSource:      a.string(),
      migrationTech:        a.string(),
      changedBy:            a.string().required(),
      notes:                a.string(),
      projectedGoLiveDate:       a.string(),
      holdReason:                a.string(),
      holdReasonOther:           a.string(),
      preprodOnboardFirstSite:          a.boolean(),
      preprodFcmCompleted:              a.boolean(),
      preprodPreflightCompleted:        a.boolean(),
      prodAutoOptimizeEnabled:          a.boolean(),
      prodAutoOptimizedOpportunity:     a.boolean(),
    })
    .secondaryIndexes((index) => [
      index("companyName").sortKeys(["changedAt"]),
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
