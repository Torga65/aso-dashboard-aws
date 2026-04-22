# ASO Dashboard — User & Developer Wiki

Internal Adobe Sites Optimizer (ASO) customer success dashboard. Tracks engagement, health scores, meeting notes, suggestion lifecycle, and portfolio metrics for ~600 Adobe Sites customers.

---

## Table of Contents

1. [What Is This Dashboard?](#1-what-is-this-dashboard)
2. [Architecture Overview](#2-architecture-overview)
3. [AWS Infrastructure](#3-aws-infrastructure)
4. [Data Models](#4-data-models)
5. [How Data Gets In — The Nightly SNOW Sync](#5-how-data-gets-in--the-nightly-snow-sync)
6. [Manual Data Entry & Field Ownership](#6-manual-data-entry--field-ownership)
7. [Application Pages](#7-application-pages)
8. [API Routes Reference](#8-api-routes-reference)
9. [Authentication](#9-authentication)
10. [Meeting Files & Transcripts](#10-meeting-files--transcripts)
11. [Claude / AI Integration (MCP)](#11-claude--ai-integration-mcp)
12. [Branch & Deployment Strategy](#12-branch--deployment-strategy)
13. [Local Development](#13-local-development)

---

## 1. What Is This Dashboard?

The ASO Dashboard gives the ESE and CSM team a single place to:

- **See all ASO customers at a glance** — status, engagement, health score, ESE lead, license type
- **Drill into any customer** — full history, ServiceNow comments, meeting notes and transcripts, pending SpaceCat validations
- **Manually enrich data** — add/edit engagement level, health score, blockers, feedback, custom fields, and progression stage without touching ServiceNow
- **Generate reports** — filterable customer data export, headless customer list, pipeline tracking, paid-resolved opportunity counts
- **Validate SpaceCat opportunities** — run AI-assisted validation against live site data per opportunity type
- **Ask Claude about customers** — via an MCP server that connects Claude Code / Cursor directly to live dashboard data

Data arrives primarily from a **nightly ServiceNow sync** (Lambda runs at 02:00 UTC). All other enrichment is done manually through the dashboard UI and stored independently in DynamoDB so that the sync never overwrites it.

---

## 2. Architecture Overview

```
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │  Developer machine (Claude Code / Cursor)                                         │
 │  ┌────────────────────────────────────────────────────────────────────────────┐  │
 │  │  customer-insight-mcp/server.mjs  (MCP server — stdio transport)           │  │
 │  │  Tools: get_customer_data · get_comments · get_transcripts                 │  │
 │  │         list_notes · list_customers · search_customers                     │  │
 │  │         list_headless_customers                                             │  │
 │  └───────────────────────────────────┬────────────────────────────────────────┘  │
 └──────────────────────────────────────│────────────────────────────────────────────┘
                                        │ HTTP  (ASO_BASE_URL)
 ┌──────────────────────────────────────▼────────────────────────────────────────────┐
 │                           AWS Amplify Hosting                                      │
 │  ┌─────────────────────────────────────────────────────────────────────────────┐  │
 │  │                     Next.js 14  (standalone output)                          │  │
 │  │                                                                              │  │
 │  │   Pages (React / SSR)                 API Routes (Node / Edge)              │  │
 │  │   ──────────────────────────          ────────────────────────────────────  │  │
 │  │   /                 Homepage          GET  /api/customers                   │  │
 │  │   /dashboard        Customer list     POST /api/customers/upsert            │  │
 │  │   /engagement       Table + filters   GET  /api/comments                   │  │
 │  │   /customer-history (360 iframe)      GET  /api/transcripts                │  │
 │  │   /suggestion-lifecycle  (iframe)     POST /api/transcripts                │  │
 │  │   /reports          (reports iframe)  GET  /api/transcripts/download       │  │
 │  │   /validator        AI validator      GET  /api/org-mapping                │  │
 │  │   /developer        Token + sync log  PUT  /api/org-mapping                │  │
 │  │                                       GET  /api/spacecat/[...path] ──────► SpaceCat
 │  │                                       GET  /api/portfolio/opportunity-metrics
 │  │                                       GET  /api/reports/headless-customers │  │
 │  │                                       POST /api/validator/sites/.../validate│  │
 │  └───────────────────────────────────────┬────────────────────────────────────┘  │
 └─────────────────────────────────────────│─────────────────────────────────────────┘
                                           │ AppSync  (API Key + IAM)
 ┌─────────────────────────────────────────▼─────────────────────────────────────────┐
 │                          AWS AppSync  (GraphQL)                                    │
 │                   us-east-1  ·  API Key + AWS IAM auth                            │
 └──────┬──────────────────┬────────────────────┬──────────────────┬─────────────────┘
        │                  │                    │                  │
        ▼                  ▼                    ▼                  ▼
 ┌────────────┐   ┌──────────────┐   ┌──────────────────┐   ┌──────────────────────┐
 │ Customer   │   │ Weekly       │   │ SnowComment      │   │ MeetingTranscript    │
 │ Snapshot   │   │ Summary      │   │ CustomerOrgMap   │   │ CustomerProgression  │
 │ (DynamoDB) │   │ (DynamoDB)   │   │ CustomerNote     │   │ DataSyncJob          │
 └────────────┘   └──────────────┘   │ (DynamoDB)       │   │ (DynamoDB)           │
                                     └──────────────────┘   └──────────────────────┘

 ┌─────────────────────────────────────────────────────────────────────────────────┐
 │  EventBridge Scheduler  (cron 02:00 UTC daily)                                  │
 │          │                                                                       │
 │          ▼                                                                       │
 │  Lambda: daily-fetch  (Node 20 · 512 MB · 5 min timeout)                       │
 │          ├── 1. GET ServiceNow core_company  (~600 records, paginated)           │
 │          │       auth: SERVICENOW_AUTH_TOKEN  (Secrets Manager)                 │
 │          ├── 2. Normalize fields + merge-preserve manual edits                  │
 │          ├── 3. Upsert CustomerSnapshot + WeeklySummary  (AppSync)              │
 │          ├── 4. Parse u_comments → SnowComment rows  (AppSync)                 │
 │          └── 5. DataSyncJob audit log  (RUNNING → COMPLETED / FAILED)           │
 │                 Retries: 2×  ·  Dead-letter queue (SQS) → CloudWatch Alarm      │
 └─────────────────────────────────────────────────────────────────────────────────┘

 External APIs
   ServiceNow  https://adobems.service-now.com   (Lambda only — server-side)
   SpaceCat    https://spacecat.experiencecloud.live/api/v1  (browser via proxy)
   Adobe IMS   https://ims-na1.adobelogin.com    (browser — OAuth / PKCE)
   Behance     https://cc-api-behance.adobe.io   (browser — avatar fetch)
   OpenAI      (server-side — AI validator LLM calls)
```

---

## 3. AWS Infrastructure

All infrastructure is defined as code using **AWS Amplify Gen 2** (CDK under the hood). No manual console configuration needed — everything is reproduced from the `amplify/` directory.

| Resource | Details |
|---|---|
| **Amplify Hosting** | Hosts the Next.js app; separate environments for `main` (prod) and `stage` |
| **AppSync** | GraphQL API gateway in front of all DynamoDB tables; API Key + IAM auth |
| **DynamoDB** | 7 tables (see [Data Models](#4-data-models)); fully managed by AppSync via Amplify |
| **Lambda** | `daily-fetch` — Node 20, 512 MB RAM, 5-min timeout, triggered by EventBridge |
| **EventBridge Scheduler** | Fires at `cron(0 2 * * ? *)` (02:00 UTC) with ±60-min flexible window |
| **SQS** | Dead-letter queue for permanently failed Lambda invocations |
| **CloudWatch Alarm** | Fires when any message arrives in the DLQ |
| **Secrets Manager** | `SERVICENOW_AUTH_TOKEN` injected into Lambda at runtime |
| **Region** | `us-east-1` |

### Key File Locations

```
amplify/
├── backend.ts              ← EventBridge schedule, DLQ, Lambda wiring
├── auth/resource.ts        ← Cognito User Pool config
├── data/resource.ts        ← All DynamoDB table schemas (AppSync)
└── functions/
    └── daily-fetch/
        ├── resource.ts     ← Lambda config (memory, timeout, secrets)
        ├── handler.ts      ← Entry point + orchestration
        ├── api-client.ts   ← ServiceNow HTTP client + pagination
        ├── normalizer.ts   ← Field mapping / validation / defaults
        ├── appsync-client.ts ← Raw AppSync GraphQL client
        ├── comment-parser.ts ← Parses u_comments blob into rows
        └── persistence.ts  ← DynamoDB write operations (merge logic)
```

---

## 4. Data Models

### CustomerSnapshot
> **The primary data store.** One record per customer per week.

| Field | Type | Source | Notes |
|---|---|---|---|
| `companyName` | String (PK) | ServiceNow | Customer company name |
| `week` | String (SK) | ServiceNow | ISO Monday date e.g. `"2026-01-23"` |
| `status` | String | ServiceNow | Active / At-Risk / Onboarding / Pre-Production / Churned / On-Hold |
| `eseLead` | String | ServiceNow | Assigned ESE engineer |
| `licenseType` | String | ServiceNow | License tier |
| `industry` | String | ServiceNow | Customer industry vertical |
| `imsOrgId` | String | ServiceNow | IMS Org ID (`u_ims_org_id`) |
| `tenantId` | String | ServiceNow | AEM tenant ID |
| `deploymentType` | String | ServiceNow | Cloud / Headless / On-Prem |
| `terminationReason` | String | ServiceNow | Churn reason |
| `comments` | String | ServiceNow | Raw `u_comments` blob (parsed separately into SnowComment) |
| `sourceLastUpdated` | String | ServiceNow | `u_updated` from SNOW — used by sync to detect changes |
| `engagement` | String | **Manual** | High / Medium / Low / Unknown |
| `healthScore` | Int | **Manual** | 0–100 |
| `blockers` | String | **Manual** | Freetext — current customer blockers |
| `feedback` | String | **Manual** | Freetext — customer product feedback |
| `summary` | String | **Manual** | ESE-authored summary |
| `mau` | String | **Manual** | Monthly Active Users |
| `ttiv` | String | **Manual** | Time to Initial Value |
| `autoOptimizeButtonPressed` | String | **Manual** | Yes / No |
| `hidden` | Boolean | **Manual** | If true, excluded from all customer lists |
| `headless` | Boolean | **Manual** | Customer is running headless |
| `preflightEnabled` | Boolean | **Manual** | Customer has Preflight enabled |
| `customFields` | JSON | **Manual** | Arbitrary key-value pairs from the edit form |
| `dataSource` | String | System | `"ServiceNow"` or `"Manual"` |
| `ingestedAt` | DateTime | System | When the Lambda (or upsert API) wrote this record |

**Secondary indexes:**
- `byWeek(week, companyName)` — Main dashboard: all customers for a week
- `byCompany(companyName, week)` — History page: all weeks for one customer

### SnowComment
> Parsed individual entries from the `u_comments` blob. Created by the Lambda; queried by `/api/comments`.

Composite key: `(companyName, commentDate)`. Fields: `author`, `body`, `ingestedAt`.
Format parsed: `2025-10-07 12:01:17 - Author Name (Comments)`.

### WeeklySummary
> Pre-aggregated counts written by the Lambda. Eliminates N-row fan-out on the dashboard.

Primary key: `week`. Fields: `totalCustomers`, `activeCount`, `atRiskCount`, `onboardingCount`, `preProductionCount`, `churnedCount`, `avgHealthScore`, `highEngagementCount`, `mediumEngagementCount`, `lowEngagementCount`.

### MeetingTranscript
> Meeting notes and VTT transcripts uploaded by the team.

Composite key: `(companyName, meetingDate)` + auto `id`. Fields: `fileType` (notes / transcript), `fileName`, `description`, `content` (full text), `uploadedBy`, `uploadedAt`.
Max file size: 350 KB (DynamoDB item limit with headroom).

### CustomerOrgMapping
> Maps a customer name → SpaceCat Org ID. Set manually when fuzzy matching fails.

Primary key: `companyName`. Key field: `spacecatOrgId`.

### CustomerProgression
> Manual pipeline tracking — which customers are Moving vs. On Hold and their stage.

Composite key: `(companyName)` + history log in `CustomerStageHistory`. Fields: `progressionTrack`, `progressionStage`, `migrationSource`, `migrationTech`, `stageEnteredAt`, `updatedBy`, `notes`.

### DataSyncJob
> Audit log for Lambda runs. One record per execution.

Fields: `status` (RUNNING / COMPLETED / FAILED), `startedAt`, `completedAt`, `weekIngested`, `recordsProcessed`, `recordsFailed`, `errorMessage`, `triggeredBy`. Visible on the `/developer` page.

---

## 5. How Data Gets In — The Nightly SNOW Sync

The Lambda runs every night at **02:00 UTC** and is the only component that calls ServiceNow directly.

```
EventBridge Scheduler (02:00 UTC)
        │
        ▼
Lambda: daily-fetch
        │
        ├─ 1. fetchCustomers()
        │      GET https://adobems.service-now.com/api/now/table/core_company
        │      Query: nameSTARTSWITHASO -^u_active=true
        │      Fields: name, u_ims_org_id, u_tenant_id, u_status,
        │              u_customer_success_engineer, u_product, u_env,
        │              u_industry, u_termination_reason, u_comments, u_updated
        │      Paginated: 200 records/page · retries: 3× with exponential back-off
        │
        ├─ 2. normalizeCustomer()
        │      Maps SNOW fields → CustomerSnapshot schema
        │      Status coercion: "production" → "Active", "at risk" → "At-Risk", etc.
        │      Engagement/healthScore default to "Unknown"/50 (SNOW does not supply these)
        │
        ├─ 3. writeSnapshots()  ← merge-aware upsert
        │      For each customer:
        │        a. GET existing record from DynamoDB
        │        b. If sourceLastUpdated unchanged → skip (no-op)
        │        c. If changed → update SNOW-owned fields only;
        │           preserve manual fields (engagement, healthScore, blockers, etc.)
        │
        ├─ 4. parseComments() + writeComments()
        │      Splits u_comments blob into individual dated entries
        │      Creates SnowComment rows (skips if already exists)
        │
        ├─ 5. computeWeeklySummary() + upsertWeeklySummary()
        │      Aggregate counts from all snapshots for the week
        │
        └─ 6. DataSyncJob log → COMPLETED / FAILED
               recordsProcessed, recordsFailed, weekIngested
```

**Failure handling:** Lambda re-throws unhandled errors → EventBridge retries 2× → permanent failures land in SQS DLQ → CloudWatch alarm fires. Monitor on the `/developer` page under "Sync job log."

---

## 6. Manual Data Entry & Field Ownership

This is the most important concept to understand when working with the dashboard.

### Field ownership

The nightly sync **only refreshes SNOW-owned fields**. It will never overwrite what you enter manually:

| Owned by ServiceNow (refreshed nightly) | Owned by the team (manual, never overwritten) |
|---|---|
| `status` | `engagement` |
| `eseLead` | `healthScore` |
| `licenseType` | `blockers` |
| `deploymentType` | `blockersStatus` |
| `industry` | `feedback` |
| `imsOrgId` / `tenantId` | `feedbackStatus` |
| `terminationReason` | `summary` |
| `comments` (raw blob) | `mau` / `ttiv` |
| `sourceLastUpdated` | `autoOptimizeButtonPressed` |
| | `hidden` / `headless` / `preflightEnabled` |
| | `customFields` (all custom fields) |

### How to edit a customer

1. Navigate to any customer's **360 view** (Customer History page).
2. Click the **Edit** button in the info bar at the top.
3. This opens `customer-history-edit.html` which POSTs to `/api/customers/upsert`.
4. The upsert API creates or updates the record for the current week with `dataSource: "Manual"`.

### Custom fields

The edit form has a **Custom Fields** section where you can define arbitrary key-value pairs grouped into named sections. These are stored as JSON and displayed in the customer info bar. Use them for any data that doesn't fit the standard schema.

---

## 7. Application Pages

### `/` — Home
Landing page with a customer summary tile grid, quick navigation links, and a weekly health overview. No filters — intended as a fast orientation view.

### `/dashboard` — Full Customer Dashboard
The main working view. Shows all active customers as cards or in a table. Supports:
- Filtering by status, engagement, ESE lead, search term
- Sorting by health score, company name, last updated
- Quick-click to open a customer's 360 view

Churned and terminated customers are hidden by default. The `hidden` flag on a record also excludes it from this view.

### `/engagement` — Engagement Table
Tabular view of all customers with full field visibility. Primary use: identifying engagement gaps, preparing for QBRs, exporting data.

- **Weekly sub-route (`/engagement/weekly`):** Week-over-week comparison — shows which customers changed status or engagement tier since the prior week.

### `/customer-history` — Customer 360 View

The deepest single-customer view in the dashboard. Rendered as a self-contained static page (`customer-history.html`) embedded in a Next.js iframe. The customer is selected from the dashboard or engagement table and passed via query string.

#### Info Bar

The top bar shows a snapshot of the customer's current state pulled from the latest `CustomerSnapshot`:

| Field | Source |
|---|---|
| IMS Org ID | ServiceNow |
| ESE Lead | ServiceNow |
| License Type | ServiceNow |
| Industry | ServiceNow |
| Deployment Type | ServiceNow |
| Status | ServiceNow |
| Engagement | Manual |
| Health Score | Manual |
| MAU / TTIV | Manual |
| Headless / Preflight / Hidden toggles | Manual |
| Custom Fields | Manual (grouped by section) |

The **Edit** button opens `customer-history-edit.html` in the same frame, which posts to `/api/customers/upsert`. Changes take effect on the next page reload.

#### Timeline Table

A scrollable table of every weekly `CustomerSnapshot` for this customer, oldest to newest. Columns: week, status, engagement, health score, ESE lead, license type, deployment type, and the SNOW `sourceLastUpdated` date. Used to see how a customer's status has changed over time.

#### ServiceNow Comments

Fetches from the `SnowComment` table (parsed individual entries, not the raw blob). Controls:
- **Date range** — Latest only / Last 30 / 60 / 90 days / All time
- **Copy AI prompt** — Copies a Claude-ready prompt with all comments in the selected range for summarization or analysis

The most recent comment is shown inline. All others collapse and load on demand. Each comment shows date, author, and the full text.

#### Meeting Files

Unified panel for all meeting artifacts (see [Section 10](#10-meeting-files--transcripts) for full details). Supports notes and transcripts, with inline viewer, date/type filtering, and a combined download.

#### SpaceCat Audits Panel

Fetches live data from SpaceCat for the customer's mapped org. The org is resolved by:
1. Checking `CustomerOrgMapping` (saved from a previous session)
2. Fuzzy-matching the customer name against all SpaceCat orgs
3. Showing a picker if no confident match is found (saves the selection for future visits)

The panel shows three sub-sections:

**Enabled Audits** — Which SpaceCat audit types are active for this org's sites. Collapsed by default; expand to see the full list.

**Pending Validations** — Suggestions currently in `PENDING_VALIDATION` status across all sites for this org. Shows opportunity type, count, and a direct link to the Validator page pre-loaded with that site. This is the primary signal for ESEs that action is needed.

**User Logins** — Recent sign-in events for this org from SpaceCat, showing which users are actively using Sites Optimizer. Used as a proxy for customer engagement.

#### Progression / Pipeline

Tracks the customer's migration or onboarding journey. Fields:

| Field | Values |
|---|---|
| Track | Moving / On Hold |
| Stage | Prod / POC / Preprod / Future Date / Migration |
| Migration Source | On Prem / AMS |
| Migration Tech | AEM / Not AEM |
| Stage Entered | Date when current stage began |
| Updated By | Who last changed this record |
| Notes | Freetext notes |

A collapsible history log shows all previous stage transitions with timestamps. Updates write to `CustomerProgression` and append a row to `CustomerStageHistory`.

### `/suggestion-lifecycle` — Suggestion Lifecycle

Portfolio-level view of SpaceCat opportunity and suggestion health across ASO customers. Rendered as a self-contained static page (`suggestion-lifecycle.html`) embedded in a Next.js iframe.

The page has **two main views** selectable via tabs at the top:

---

#### Site View

Drill into a single customer site. Select a customer from the search box — it searches both customer names and site base URLs. Once a site is loaded, the page shows:

**Activity Cards (date-filtered)**

Four headline metrics for the selected date range (last 7 / 30 / 90 days, or custom):

| Card | What it counts |
|---|---|
| Total Available | Suggestions currently in an open state (NEW + APPROVED + IN_PROGRESS + PENDING_VALIDATION) |
| Moved to Fixed | Suggestions that moved to FIXED status in the period |
| Pending Validation | Suggestions currently awaiting ESE review |
| Customer Engagement | Suggestions the customer acted on (Skipped + Fixed by customer) |

**Opportunity Trends Chart**

Line chart showing opportunity counts over time in the date range. Helps spot whether open opportunities are growing or shrinking.

**Suggestion Lifecycle Breakdown** (all time)

A horizontal bar chart showing every suggestion ever seen for this site grouped by status. Each bar shows count and % of total. Statuses:

| Status | Meaning |
|---|---|
| `NEW` | Detected, not yet reviewed |
| `APPROVED` | ESE approved, awaiting customer action |
| `IN_PROGRESS` | Customer acknowledged, working on it |
| `PENDING_VALIDATION` | Fix submitted, awaiting ESE validation |
| `FIXED` | Validated and closed |
| `SKIPPED` | Customer chose not to act |
| `REJECTED` | ESE rejected the suggestion |
| `ERROR` | Automation error |
| `OUTDATED` | No longer relevant (page changed) |

**Opportunity Age Buckets**

For open opportunities only (NEW + IN_PROGRESS), shows how long they've been open: < 7 days / 7–30 / 30–90 / 90+ days. A proxy for stale or neglected work.

**Automation vs Manual Fixes**

Breaks down FIXED suggestions into those resolved by automation (linked to a completed fix job) vs. manually fixed by a developer. Shows automation success rate and failure counts by opportunity type.

**Opportunity Table** (date-filtered)

A row per opportunity type. For each row, shows how many suggestions had activity in the date range, and lets you filter by range or change the view. Each opportunity type is expandable to show individual suggestion URLs and statuses.

---

#### Portfolio View

Cross-customer aggregate metrics pulled from `/api/portfolio/opportunity-metrics`. Designed for management reporting and identifying trends across the entire ASO customer base.

**Controls:**
- **Site List** — All ASO sites (default), CJA sites, or a custom list
- **Scope** — All opportunities or ASO-only
- **Date range** — Preset ranges or custom date picker
- **Include LLMO / Generic** — Toggle to include LLMO and generic opportunity types in counts
- **Load** button — Fetches data (results are cached server-side for 30 min)

**Portfolio Metrics displayed:**

| Metric | Description |
|---|---|
| Total Available | Open suggestions across all sites in scope |
| Moved to Fixed | Suggestions fixed in the period |
| Pending Validation | Awaiting ESE review across all sites |
| Customer Engagement | Customer-driven actions (skipped + fixed) |
| Sites with Opportunities | How many sites have at least one open opportunity |

Results are broken down by opportunity type so you can see which types have the most open work or the best fix rate across the portfolio.

### `/reports` — Customer Reports
Embedded static page (`reports.html`) with two tabs:

**Customer Data tab**
- Filterable table: status, engagement, ESE lead, license type, deployment type, industry, headless flag, preflight flag
- Select which fields to show/hide
- Export button generates a CSV of visible rows

**Pipeline View tab**
- Tracks customers in the progression pipeline
- Grouped by track: Moving / On Hold / Unset
- Shows stage, migration source, migration tech, days in current stage, last updated by

### `/validator` — SpaceCat Opportunity Validator

AI-assisted tool for ESEs to validate SpaceCat opportunities against live site data. This is where pending validations get reviewed and closed. Requires an active IMS session.

#### Step-by-step workflow

**1. Select a site**

Type a base URL or customer name in the site selector. It queries SpaceCat's org-scoped API to match the site. If the URL is already known (e.g., navigating from the 360 view's Pending Validations panel via a `?baseURL=` query param), it auto-loads.

**2. Review the Pending Validation summary**

Once a site is selected, a **Validation Highlights** table appears showing every opportunity type that has suggestions in `PENDING_VALIDATION` status. Each row shows:
- Opportunity type
- Number of pending suggestions
- An info button (ℹ) to preview those suggestions inline without leaving the summary

This gives a quick at-a-glance view of what needs attention before drilling in.

The opportunity type column uses color-coded classification:
- **Green** — Scripted validators (fully automated, high confidence): `broken-internal-links`, `hreflang`, `meta-tags`, `a11y-color-contrast`, `a11y-assistive`, `canonical`, `cwv`, `headings`, etc.
- **Blue** — PR candidates (semi-automated, requires review): `alt-text`, `high-page-views`, `paid-traffic`, `readability`, etc.
- **Gray** — Manual review required: all other types

**3. Select an opportunity type**

Below the highlights table, the full opportunity list shows all `NEW` status opportunities for the site. Filter by ASO vs. LLMO origin using the toggle. Click an opportunity to drill in.

**4. Review suggestions**

The suggestions table shows every suggestion for the selected opportunity. Columns vary by opportunity type:

| Type | Key columns |
|---|---|
| `broken-internal-links` | Source URL, broken target URL, issue type |
| `hreflang` | Page URL, issue type, affected hreflang tags |
| `meta-tags` | Page URL, current vs. expected meta content |
| `a11y-color-contrast` | Page URL, element, contrast ratio |
| `a11y-assistive` | Page URL, element, ARIA issue |
| `sitemap` | URL, issue type |

Each suggestion shows its current status badge: NEW / PENDING_VALIDATION / FIXED / SKIPPED / etc.

**5. Select and validate**

Check one or more suggestions and click **Validate**. The validator:
1. Fetches the live page (via Playwright-rendered HTML for JS-heavy pages where needed)
2. Runs the type-specific validation logic
3. Uses an LLM (OpenAI) to assess the result where scripted checks aren't sufficient
4. Returns a `validation_status` (VALID / INVALID / ERROR) with an explanation

Results appear inline next to each suggestion:
- ✅ Green — Fix confirmed valid
- ❌ Red — Issue still present or fix not valid
- ⚠ Yellow — Uncertain, needs manual review

**6. Update status**

After reviewing validation results, use the **Mark as Fixed** / **Won't Fix** / **Reset** buttons to update the suggestion status in SpaceCat. The status change is written back to SpaceCat via `PATCH /api/spacecat/sites/{siteId}/opportunities/{oppId}/suggestions/status`.

#### Opportunity types and validators

| Type | Validation approach | Notes |
|---|---|---|
| `broken-internal-links` | HTTP HEAD/GET check on the target URL | Scripted; no LLM needed |
| `hreflang` | Fetch page, parse `<link rel="alternate" hreflang>` tags | Checks format, language codes, x-default |
| `meta-tags` | Fetch page, parse `<title>` and `<meta name="description">` | LLM assesses quality |
| `a11y-color-contrast` | Fetch rendered page, compute contrast ratios | Scripted against WCAG AA |
| `a11y-assistive` | Fetch rendered page, inspect ARIA roles and alt text | LLM-assisted |
| `sitemap` | Fetch and parse sitemap XML | Checks URLs, format, reachability |

#### Deep-linking from the 360 view

The 360 view's Pending Validations panel links directly to the validator pre-loaded with a site:
```
/validator?baseURL=https://www.example.com
```
This skips the site selector and lands directly on the opportunity list for that site.

### `/developer` — Developer Tools
Intended for the engineering team. Contains:
- **Token debugger** — Paste or inspect an IMS access token; shows decoded claims
- **Manual token entry** — Set a token without going through the IMS sign-in flow (useful when the OAuth redirect is blocked)
- **Sync job log** — Live list of recent `DataSyncJob` records showing Lambda run history, record counts, and any error messages

---

## 8. API Routes Reference

### Customer Data

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/customers` | All `CustomerSnapshot` records as flat JSON array |
| `POST` | `/api/customers/upsert` | Create or update a snapshot (manual edit form) |

`GET /api/customers` strategy:
1. Query `WeeklySummary` to get known week keys
2. Parallel GSI queries (`byWeek`) for each week — avoids full-table scan
3. Fallback to paginated `list()` if WeeklySummary is empty

`POST /api/customers/upsert` body fields:
- `companyName` (required)
- `week` (optional, defaults to current Monday)
- Any of: `status`, `engagement`, `healthScore`, `blockers`, `blockersStatus`, `feedback`, `feedbackStatus`, `summary`, `eseLead`, `licenseType`, `deploymentType`, `industry`, `imsOrgId`, `tenantId`, `mau`, `ttiv`, `autoOptimizeButtonPressed`, `terminationReason`, `comments`, `sourceLastUpdated`
- `customFields` (JSON object)
- `hidden`, `headless`, `preflightEnabled` (booleans)

### Comments

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/comments?company=&days=` | ServiceNow comments for a customer |

`days` values: `latest` (default — most recent only), `30`, `60`, `90`, `all`.
Falls back to parsing the raw `CustomerSnapshot.comments` blob if `SnowComment` table is empty.

### Meeting Files

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/transcripts?company=&days=` | List file metadata (no content) |
| `POST` | `/api/transcripts` | Upload a file (multipart form) |
| `GET` | `/api/transcripts/download?company=&days=&id=&view=1` | Download combined VTT or single file |

POST form fields: `company`, `meetingDate` (YYYY-MM-DD), `fileType` (notes/transcript), `description`, `uploadedBy`, `file`.
Max file size: 350 KB after text extraction.

`/api/transcripts/download` with `view=1` returns `text/plain` (no Content-Disposition) — used by the MCP server to read file content directly.

### SpaceCat Proxy

| Method | Route | Description |
|---|---|---|
| `GET/POST/PUT/PATCH/DELETE` | `/api/spacecat/[...path]` | Transparent proxy to SpaceCat API |

Forwards the caller's `Authorization: Bearer` header. Bypasses CORS restrictions in iframe/local contexts. The path after `/api/spacecat/` maps 1:1 to the SpaceCat API path.

### Portfolio & Reports

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/portfolio/opportunity-metrics` | Aggregated SpaceCat opportunity data |
| `GET` | `/api/reports/headless-customers` | Customers with headless deployment type or flag |
| `GET` | `/api/reports/paid-resolved-opportunities-week` | Resolved opportunity counts for paid customers |

`/api/portfolio/opportunity-metrics` params:

| Param | Description |
|---|---|
| `orgId=<id>` | Fetch for one SpaceCat org |
| `siteIds=a,b,c` | Explicit site list |
| `from` / `to` | Date range `YYYY-MM-DD` |
| `includeLlmo=1` | Include LLMO opportunity types |
| `includeGeneric=1` | Include generic opportunity type |

Results cached in-memory for 30 minutes.

### Org Mapping

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/org-mapping?company=` | Look up saved SpaceCat Org ID for a customer |
| `PUT` | `/api/org-mapping` | Save a mapping `{ companyName, spacecatOrgId }` |

---

## 9. Authentication

The app uses **Adobe IMS (Identity Management System)**. Normal users never create a password — they sign in with their Adobe account.

```
Browser
  └── @identity/imslib (OAuth 2.0 implicit/PKCE)
        ├── Client ID: ASO-dashboard
        ├── Scopes: openid, AdobeID, additional_info,
        │          additional_info.projectedProductContext,
        │          read_organizations, account_cluster.read
        └── Prod IMS: https://ims-na1.adobelogin.com
```

### Sign-in flow

1. User clicks **Sign In** → redirected to Adobe IMS login
2. On success, IMS redirects to `/auth/callback` with an authorization code
3. `IMSAuthContext` exchanges the code for an access token and stores it in React state
4. The token is forwarded into static iframe pages via `postMessage`

### Token lifetime

IMS tokens expire in 24 hours. The app automatically refreshes the token in the background when it detects expiry.

### Manual token (developer mode)

If the OAuth redirect is blocked (e.g., in local dev behind a proxy), go to `/developer` and paste a token obtained from another source. Stored in `localStorage` as `aso_manual_ims_token` (React pages) / `aso_manual_api_token` (static iframe pages).

### Key auth files

| File | Purpose |
|---|---|
| `src/contexts/IMSAuthContext.tsx` | React context; provides `useIMSAuth()` hook |
| `src/components/auth/AuthButton.tsx` | Avatar button (Behance photo) + sign-in/out dropdown |
| `src/components/layout/StaticPageFrame.tsx` | Posts IMS token into iframe pages via `postMessage` |
| `public/scripts/auth/imslib-adapter.js` | Receives token inside iframe; exposes same auth API |

---

## 10. Meeting Files & Transcripts

The **Meeting Files** panel on the Customer 360 view is a unified upload, browse, and view interface for all meeting artifacts associated with a customer.

### File types supported

| Type | Extensions | Dashboard label |
|---|---|---|
| Meeting notes | `.pdf`, `.docx`, `.xlsx`, `.xls`, `.csv`, `.txt`, `.md`, `.rtf` | Note (blue badge) |
| VTT transcripts | `.vtt` | Transcript (green badge) |

Binary files (PDF, DOCX, XLSX) are converted to text in the browser before upload using:
- **PDF** — pdf.js
- **DOCX** — mammoth.js
- **XLSX/XLS** — SheetJS
- **All others** — raw text read

### Uploading a file

1. Enter the **meeting date** (defaults to today)
2. Enter a **title** (optional — defaults to filename)
3. Select the **type** (Note or Transcript)
4. Add a **description/tags** — this is shown in the file list and included in the combined transcript download so the MCP server can find it
5. Either **paste/type notes** in the text area, or **select a file** (which auto-submits)
6. Click **Save**

### Viewing a file

Click any filename in the list to open the **content viewer modal** — shows the full text inline without downloading. Press Escape or click outside to close.

### Date range filter

Use the dropdown to filter the file list: All time / Last 30 / 60 / 90 days.

### Type filter

Filter to show Notes only, Transcripts only, or both.

### Download all

Downloads a combined `.vtt` file containing all transcripts/notes in the selected date range. Each file is separated by a `NOTE` header block that includes the date, type, filename, description, and uploader — this is what the MCP server reads.

### Description field (MCP hint)

The description field is stored in the database and appears in the `NOTE` header of combined downloads:
```
NOTE ────────────────────────────────────
NOTE Meeting: Acme Corp
NOTE Date: 2026-03-15  Type: notes
NOTE File: Q1-QBR-notes.pdf
NOTE Description: Q1 QBR — blockers, roadmap discussion, action items
NOTE Uploaded by: tjones  at 2026-03-16T14:22:00Z
NOTE ────────────────────────────────────
```

This allows the Claude MCP tool `list_notes` to find relevant files by keyword without downloading all content.

---

## 11. Claude / AI Integration (MCP)

The `customer-insight-mcp/` directory contains a **Model Context Protocol server** that connects Claude Code or Cursor to live dashboard data.

### What it enables

Instead of manually navigating the dashboard, you can ask Claude:
- *"Summarize the last 3 months of activity for Acme Corp"*
- *"Which At-Risk customers have Low engagement?"*
- *"Find any customers mentioning performance blockers"*
- *"Get the meeting notes for WKND and pull out any open action items"*

### Setup (Claude Code)

Claude Code auto-detects `.mcp.json` at the repo root. Install dependencies once:

```bash
cd customer-insight-mcp
npm install
```

The MCP server connects to the production dashboard by default (`asodashboard.adobecqms.net`). To point it at a local dev server:

```bash
ASO_BASE_URL=http://localhost:3000 claude
```

### Setup (Cursor)

Create `.cursor/mcp.json` in the repository root:

```json
{
  "mcpServers": {
    "aso-dashboard": {
      "command": "node",
      "args": ["${workspaceFolder}/customer-insight-mcp/server.mjs"],
      "env": {
        "ASO_BASE_URL": "https://www.asodashboard.adobecqms.net"
      }
    }
  }
}
```

Fully quit and reopen Cursor after adding this.

### Available tools

| Tool | Description |
|---|---|
| `get_customer_data` | Latest snapshot — status, health score, blockers, ESE lead, custom fields |
| `get_comments` | ServiceNow comments (date-filterable: latest / 30 / 60 / 90 / all) |
| `list_notes` | File metadata only — date, filename, description, type, uploader. Supports keyword filter. Use this first to find relevant files. |
| `get_transcripts` | Full text of all meeting notes and transcripts (always full history) |
| `list_customers` | All customers, filterable by status and engagement |
| `search_customers` | Full-text search across all customer fields including custom fields |
| `list_headless_customers` | Customers with headless deployment type or flag |

### Recommended workflow for customer questions

```
1. search_customers or list_customers  ← find the right company name
2. get_customer_data                   ← latest status snapshot
3. list_notes (optional)              ← preview available files by keyword
4. get_transcripts                    ← full meeting history
5. get_comments                       ← ServiceNow comment thread
```

---

## 12. Branch & Deployment Strategy

| Branch | Environment | Database |
|---|---|---|
| `main` | Production (`asodashboard.adobecqms.net`) | Prod AppSync / DynamoDB |
| `stage` | Staging | Stage AppSync / DynamoDB |

### PR workflow

All changes go through pull requests — direct pushes to `stage` and `main` are blocked.

1. Create a feature branch from `origin/stage`
2. Develop and commit
3. Open a PR targeting `stage`
4. After review and merge, promote `stage` → `main` via a separate PR when ready for production

### `amplify_outputs.json`

This file is **gitignored**. Each Amplify environment generates its own at build time via `ampx generate outputs`. The file in the repo (if present) is only for local development and points at the stage database.

---

## 13. Local Development

### Prerequisites

- Node 20
- AWS CLI configured with access to the ASO AWS account
- Amplify CLI v2 (`npm install -g @aws-amplify/backend-cli`)

### Quick start (using stage database)

```bash
# Install dependencies
npm install

# Start the dev server — amplify_outputs.json already points at stage
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in with your Adobe IMS account, or use the `/developer` page to paste a manual token.

### Personal sandbox backend

If you need an isolated database for testing schema changes:

```bash
# Deploy a personal CloudFormation stack (writes amplify_outputs.json)
npm run amplify:sandbox

# In a second terminal:
npm run dev

# Set the ServiceNow auth token for Lambda testing
npx ampx secret set SERVICENOW_AUTH_TOKEN
```

### Running the MCP server locally

```bash
cd customer-insight-mcp
npm install

# Point at local dev:
ASO_BASE_URL=http://localhost:3000 node server.mjs
```

Or just start Claude Code normally — it auto-starts the MCP server but pointed at production. To override:

```bash
ASO_BASE_URL=http://localhost:3000 claude
```

### Useful scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Next.js dev server on port 3000 |
| `npm run build` | Production build |
| `npm run amplify:sandbox` | Deploy personal sandbox backend |
| `npx ampx generate outputs` | Regenerate `amplify_outputs.json` from deployed backend |
| `npx ampx secret set <NAME>` | Store a secret in Amplify Secrets Manager |

---

*Last updated: April 2026*
