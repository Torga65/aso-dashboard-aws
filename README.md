# ASO Dashboard (AWS)

Internal Adobe Sites Optimizer (ASO) customer success dashboard. Tracks engagement, health scores, meeting notes, suggestion lifecycle, and portfolio metrics for ~600 Adobe Sites customers.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [AWS Infrastructure](#aws-infrastructure)
- [Data Models](#data-models)
- [Application Pages](#application-pages)
- [API Routes](#api-routes)
- [Authentication](#authentication)
- [Daily Data Ingestion](#daily-data-ingestion)
- [Suggestion Lifecycle Tab](#suggestion-lifecycle-tab)
- [Meeting Files & Transcripts](#meeting-files--transcripts)
- [Claude / AI Integration (MCP)](#claude--ai-integration-mcp)
- [Static Embedded Pages](#static-embedded-pages)
- [Branch & Deployment Strategy](#branch--deployment-strategy)
- [Local Development](#local-development)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Developer machine (Claude Code / Cursor)                                        │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │  customer-insight-mcp/server.mjs  (MCP server — stdio transport)           │  │
│  │  Tools: get_customer_data · get_comments · get_transcripts                 │  │
│  │         list_notes · list_customers · search_customers                     │  │
│  │         list_headless_customers                                            │  │
│  └───────────────────────────────────┬────────────────────────────────────────┘  │
└──────────────────────────────────────│───────────────────────────────────────────┘
                                       │ HTTP  (ASO_BASE_URL)
┌──────────────────────────────────────▼───────────────────────────────────────────┐
│                           AWS Amplify Hosting                                    │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │                     Next.js 14  (standalone output)                        │  │
│  │                                                                            │  │
│  │   Pages (React / SSR)                 API Routes (Node / Edge)             │  │
│  │   ──────────────────────────          ──────────────────────────────────   │  │
│  │   /                 Homepage          GET  /api/customers                  │  │
│  │   /dashboard        Customer list     POST /api/customers/upsert           │  │
│  │   /engagement       Table + filters   GET  /api/comments                  │  │
│  │   /customer-history (360 iframe)      GET  /api/transcripts                │  │
│  │   /suggestion-lifecycle  (iframe)     POST /api/transcripts                │  │
│  │   /reports          (reports iframe)  GET  /api/transcripts/download       │  │
│  │   /validator        AI validator      GET  /api/org-mapping                │  │
│  │   /developer        Token + sync log  PUT  /api/org-mapping                │  │
│  │                                       GET  /api/spacecat/[...path] ──► SpaceCat
│  │                                       GET  /api/portfolio/opportunity-metrics  │
│  │                                       GET  /api/reports/headless-customers     │
│  │                                       POST /api/validator/sites/.../validate   │
│  └────────────────────────────────────────┬───────────────────────────────────┘  │
└───────────────────────────────────────────│──────────────────────────────────────┘
                                            │ AppSync  (API Key + IAM)
┌───────────────────────────────────────────▼──────────────────────────────────────┐
│                          AWS AppSync  (GraphQL)                                  │
│                   us-east-1  ·  API Key + AWS IAM auth                           │
└──────┬──────────────────┬────────────────────┬──────────────────┬────────────────┘
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
│          │                                                                      │
│          ▼                                                                      │
│  Lambda: daily-fetch  (Node 20 · 512 MB · 5 min timeout)                       │
│          ├── 1. GET ServiceNow core_company  (~600 records, paginated)          │
│          │       auth: SERVICENOW_AUTH_TOKEN  (Secrets Manager)                 │
│          ├── 2. Normalize fields + merge-preserve manual edits                  │
│          ├── 3. Upsert CustomerSnapshot + WeeklySummary  (AppSync)              │
│          ├── 4. Parse u_comments → SnowComment rows  (AppSync)                  │
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

## AWS Infrastructure

All infrastructure is defined as code using **AWS Amplify Gen 2** (CDK under the hood). No manual console configuration needed — everything is reproduced from the `amplify/` directory.

| Resource | Details |
|----------|---------|
| **Amplify Hosting** | Hosts the Next.js app; separate environments for `main` (prod) and `stage` |
| **AppSync** | GraphQL API gateway in front of all DynamoDB tables; API Key + IAM auth |
| **DynamoDB** | 7 tables (see [Data Models](#data-models)); managed by AppSync via Amplify |
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
        ├── resource.ts       ← Lambda config (memory, timeout, secrets)
        ├── handler.ts        ← Entry point + orchestration
        ├── api-client.ts     ← ServiceNow HTTP client + pagination
        ├── normalizer.ts     ← Field mapping / validation / defaults
        ├── appsync-client.ts ← Raw AppSync GraphQL client
        ├── comment-parser.ts ← Parses u_comments blob into SnowComment rows
        └── persistence.ts    ← DynamoDB write operations (merge logic)
```

---

## Data Models

### CustomerSnapshot
> One record per customer per week. Primary data store.

Fields are either written by the nightly ServiceNow sync or entered manually through the dashboard UI. Manual fields are **never overwritten** by the sync.

| Field | Type | Source | Notes |
|-------|------|--------|-------|
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
| `engagement` | String | Manual | High / Medium / Low / Unknown |
| `healthScore` | Int | Manual | 0–100 |
| `blockers` | String | Manual | Freetext — current customer blockers |
| `feedback` | String | Manual | Freetext — customer product feedback |
| `summary` | String | Manual | ESE-authored summary |
| `mau` | String | Manual | Monthly Active Users |
| `ttiv` | String | Manual | Time to Initial Value |
| `autoOptimizeButtonPressed` | String | Manual | Yes / No |
| `hidden` | Boolean | Manual | If true, excluded from all customer lists |
| `headless` | Boolean | Manual | Customer is running headless |
| `preflightEnabled` | Boolean | Manual | Customer has Preflight enabled |
| `customFields` | JSON | Manual | Arbitrary key-value pairs from the edit form |
| `dataSource` | String | System | `"ServiceNow"` or `"Manual"` |
| `ingestedAt` | DateTime | System | When the Lambda (or upsert API) wrote this record |

**Secondary indexes:**
- `byWeek(week, companyName)` — Main dashboard: all customers for a week
- `byCompany(companyName, week)` — History page: all weeks for one customer

### SnowComment
> Individual entries parsed from the ServiceNow `u_comments` blob by the Lambda. One row per dated comment.

Composite key: `(companyName, commentDate)`. Fields: `author`, `body`, `ingestedAt`.
Format parsed: `2025-10-07 12:01:17 - Author Name (Comments)`.

### WeeklySummary
> Pre-aggregated counts written by the Lambda alongside CustomerSnapshots. Eliminates N-row fan-out on the dashboard.

Primary key: `week`. Fields: `totalCustomers`, `activeCount`, `atRiskCount`, `onboardingCount`, `preProductionCount`, `churnedCount`, `avgHealthScore`, `highEngagementCount`, `mediumEngagementCount`, `lowEngagementCount`.

### MeetingTranscript
> Meeting notes and VTT transcripts uploaded by the team.

Composite key: `(companyName, meetingDate)` + auto `id`. Fields: `fileType` (notes / transcript), `fileName`, `description`, `content` (full extracted text), `uploadedBy`, `uploadedAt`.
Max file size: 350 KB (DynamoDB item limit with headroom).

### CustomerOrgMapping
> Maps a customer name → SpaceCat Org ID. Set manually when fuzzy matching fails. Persists so future loads skip the picker.

Primary key: `companyName`. Key field: `spacecatOrgId`.

### CustomerNote
> User-added annotations per customer per week, without mutating source data.

Composite key: `(companyName, week)`. Secondary index: `byCompany`.

### CustomerProgression
> Manual pipeline tracking — which customers are Moving vs. On Hold and their stage.

Composite key: `companyName`. Fields: `progressionTrack`, `progressionStage`, `migrationSource`, `migrationTech`, `stageEnteredAt`, `updatedBy`, `notes`. A separate `CustomerStageHistory` log appends a row on every stage transition.

### DataSyncJob
> Audit log for Lambda runs. One record per execution: RUNNING → COMPLETED or FAILED.

Fields: `status`, `startedAt`, `completedAt`, `weekIngested`, `recordsProcessed`, `recordsFailed`, `errorMessage`, `triggeredBy`. Visible on the `/developer` page.

---

## Application Pages

| Route | File | Description |
|-------|------|-------------|
| `/` | `src/app/page.tsx` | Homepage with customer summary tiles and quick links |
| `/dashboard` | `src/app/dashboard/page.tsx` | Full customer list — cards or table, status/engagement/ESE filters |
| `/engagement` | `src/app/engagement/page.tsx` | Detailed engagement table with full field visibility |
| `/engagement/weekly` | `src/app/engagement/weekly/page.tsx` | Week-over-week comparison — customers that changed status or engagement |
| `/customer-history` | `src/app/customer-history/page.tsx` | Customer 360 view (iframe → `customer-history.html`) |
| `/suggestion-lifecycle` | `src/app/suggestion-lifecycle/page.tsx` | SpaceCat suggestion lifecycle + portfolio view (iframe → `suggestion-lifecycle.html`) |
| `/validator` | `src/app/validator/page.tsx` | AI-assisted SpaceCat opportunity validator |
| `/reports` | `src/app/reports/page.tsx` | Customer data export + pipeline view (iframe → `reports.html`) |
| `/developer` | `src/app/developer/page.tsx` | Token debugger, sync job log, manual token entry |
| `/auth/callback` | `src/app/auth/callback/page.tsx` | IMS OAuth 2.0 callback handler |

The `customer-history` and `suggestion-lifecycle` pages embed self-contained static HTML files via `StaticPageFrame` — an `<iframe>` component that bridges the IMS access token from the React app into the iframe via `postMessage`.

---

## API Routes

### Customer Data

#### `GET /api/customers`
Returns all `CustomerSnapshot` records as a flat JSON array.

**Strategy:**
1. Query `WeeklySummary` to get known weeks
2. For each week, run a parallel GSI query (`byWeek`) — avoids full-table scan
3. Fallback: paginated `list()` if WeeklySummary is empty

#### `POST /api/customers/upsert`
Creates or updates a snapshot record (used by the manual edit form). Defaults `week` to the current Monday if omitted. Accepted fields:

`companyName` (required) · `week` · `status` · `engagement` · `healthScore` · `blockers` · `blockersStatus` · `feedback` · `feedbackStatus` · `summary` · `eseLead` · `licenseType` · `deploymentType` · `industry` · `imsOrgId` · `tenantId` · `mau` · `ttiv` · `autoOptimizeButtonPressed` · `terminationReason` · `comments` · `sourceLastUpdated` · `customFields` · `hidden` · `headless` · `preflightEnabled`

### Comments

#### `GET /api/comments?company=<name>&days=<range>`
Returns `SnowComment` records for a customer. `days` values: `latest` (default — most recent only), `30`, `60`, `90`, `all`. Falls back to parsing the raw `CustomerSnapshot.comments` blob if the SnowComment table is empty.

### Meeting Files

#### `GET /api/transcripts?company=<name>&days=<range>`
Returns file metadata for a customer (no content). `days` accepts the same values as `/api/comments`.

#### `POST /api/transcripts`
Uploads a file. Multipart form fields: `company`, `meetingDate` (YYYY-MM-DD), `fileType` (notes / transcript), `description`, `uploadedBy`, `file`. Max file size: 350 KB after text extraction.

#### `GET /api/transcripts/download?company=<name>&days=<range>`
Downloads a combined VTT file of all transcripts/notes in the date range. Each file is separated by a `NOTE` header block with date, type, filename, description, and uploader — this is the format the MCP server reads. Pass `id=<id>` to download a single file; pass `view=1` to return `text/plain` without a `Content-Disposition` header (used by the MCP server to read content directly).

### SpaceCat Proxy

#### `GET/POST/PUT/PATCH/DELETE /api/spacecat/[...path]`
Transparent proxy to `https://spacecat.experiencecloud.live/api/v1`. Forwards the caller's `Authorization: Bearer` header. Bypasses CORS restrictions in iframe/local contexts. The path after `/api/spacecat/` maps 1:1 to the SpaceCat API path.

### Portfolio & Reports

#### `GET /api/portfolio/opportunity-metrics`
Aggregates SpaceCat opportunity data across sites for the portfolio dashboard.

| Param | Description |
|-------|-------------|
| `orgId=<id>` | Fetch sites for one SpaceCat org |
| `siteIds=a,b,c` | Explicit site list |
| `from` / `to` | Date range `YYYY-MM-DD` (required) |
| `includeLlmo=1` | Include LLMO-only opportunity types |
| `includeGeneric=1` | Include generic-opportunity type |

Returns bucketed counts, status-change buckets, and summary metrics. Results cached in-memory for 30 minutes.

#### `GET /api/reports/headless-customers`
Returns customers with `deploymentType: Headless` or `headless: true`.

#### `GET /api/reports/paid-resolved-opportunities-week`
Returns weekly paid-and-resolved opportunity counts.

### Org Mapping

#### `GET /api/org-mapping?company=<name>`
Looks up a saved SpaceCat Org ID for a customer.

#### `PUT /api/org-mapping`
Body: `{ companyName, spacecatOrgId }`. Upserts the mapping into DynamoDB.

### Validator

#### `GET /api/validator/sites`
Lists sites available for the validator tool.

#### `GET /api/validator/sites/[siteId]/opportunities`
Returns opportunities for a specific site.

#### `POST /api/validator/sites/[siteId]/opportunities/[oppId]/validate`
Runs AI-assisted validation for a suggestion. Fetches the live page, runs type-specific scripted checks, and calls OpenAI where LLM assessment is needed. Returns `validation_status` (VALID / INVALID / ERROR) with an explanation.

---

## Authentication

The app uses **Adobe IMS (Identity Management System)** — normal users never create a password.

```
Browser
  └── @identity/imslib (OAuth 2.0 implicit/PKCE)
        ├── Client ID: ASO-dashboard
        ├── Scopes: openid, AdobeID, additional_info,
        │          additional_info.projectedProductContext,
        │          read_organizations, account_cluster.read
        └── Prod IMS: https://ims-na1.adobelogin.com
```

**Sign-in flow:** User clicks Sign In → redirected to Adobe IMS → on success, IMS redirects to `/auth/callback` with an authorization code → `IMSAuthContext` exchanges the code for an access token → token is forwarded into static iframe pages via `postMessage`. Tokens expire in 24 hours and are refreshed automatically.

**Key files:**
- `src/contexts/IMSAuthContext.tsx` — React context; provides `useIMSAuth()` hook
- `src/components/auth/AuthButton.tsx` — Avatar button (Behance photo) + sign-in/out dropdown
- `src/components/layout/StaticPageFrame.tsx` — Posts IMS token into iframe pages via `postMessage`
- `public/scripts/auth/imslib-adapter.js` — Receives token inside iframe; exposes same API as direct IMS

**Developer mode:** Go to `/developer` and paste a token obtained from another source. Stored in `localStorage` as `aso_manual_ims_token` (React pages) / `aso_manual_api_token` (static iframe pages).

---

## Daily Data Ingestion

The Lambda runs every night at 02:00 UTC and is the only component that calls ServiceNow directly.

```
EventBridge Scheduler (02:00 UTC)
        │
        ▼
Lambda: daily-fetch
        │
        ├─ 1. fetchCustomers()
        │      GET https://adobems.service-now.com/api/now/table/core_company
        │      Fields: name, u_ims_org_id, u_tenant_id, u_status,
        │              u_customer_success_engineer, u_product, u_env,
        │              u_industry, u_termination_reason, u_comments, u_updated
        │      Paginated: 200 records/page · retries: 3× with exponential back-off
        │
        ├─ 2. normalizeCustomer()
        │      Maps SNOW fields → CustomerSnapshot schema
        │      Status coercion: "production" → "Active", "at risk" → "At-Risk", etc.
        │      engagement/healthScore default to "Unknown"/50 (SNOW does not supply these)
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

**Failure handling:** Lambda re-throws unhandled errors → EventBridge retries 2× → permanent failures land in SQS DLQ → CloudWatch alarm fires. Monitor runs on the `/developer` page under "Sync job log."

---

## Suggestion Lifecycle Tab

The `/suggestion-lifecycle` page tracks the end-to-end lifecycle of SpaceCat suggestions across customer sites. It is a self-contained static HTML page (`public/suggestion-lifecycle.html`) embedded via `StaticPageFrame`.

### View Modes

**Site View** (default) — drill into a single customer site:

**Activity Cards** (date-filtered — last 7 / 30 / 90 days or custom):

| Card | Definition |
|------|------------|
| Total Available | Suggestions currently in an open state (NEW + APPROVED + IN_PROGRESS + PENDING_VALIDATION) |
| Moved to Fixed | Suggestions that moved to FIXED in the selected period |
| Pending Validation | Suggestions currently awaiting ESE review |
| Customer Engagement | Suggestions the customer acted on (Skipped + Fixed by customer) |

**Opportunity Trends Chart** — line chart showing opportunity counts over time in the date range.

**Suggestion Lifecycle Breakdown** (all time) — horizontal bar chart showing every suggestion grouped by status with count and % of total:

| Status | Meaning |
|--------|---------|
| NEW | Detected, not yet reviewed |
| APPROVED | ESE approved, awaiting customer action |
| IN_PROGRESS | Customer acknowledged, working on it |
| PENDING_VALIDATION | Fix submitted, awaiting ESE validation |
| FIXED | Validated and closed |
| SKIPPED | Customer chose not to act |
| REJECTED | ESE rejected the suggestion |
| ERROR | Automation error |
| OUTDATED | No longer relevant (page changed) |

**Opportunity Age Buckets** — for open opportunities (NEW + IN_PROGRESS): < 7 days / 7–30 / 30–90 / 90+ days. A proxy for stale or neglected work.

**Automation vs. Manual Fixes** — breaks FIXED suggestions into automation-resolved vs. developer-fixed. Shows automation success rate and failure counts by opportunity type.

**Opportunity Table** (date-filtered) — one row per opportunity type showing suggestion activity in the range. Each type is expandable to show individual suggestion URLs and statuses.

---

**Portfolio View** — cross-customer aggregate metrics from `/api/portfolio/opportunity-metrics`:

| Control | Description |
|---------|-------------|
| Site List | All ASO sites (default), CJA sites, or a custom list |
| Scope | All opportunities or ASO-only |
| Date range | Preset ranges or custom date picker |
| Include LLMO / Generic | Toggle to include LLMO and generic opportunity types |

Metrics are broken down by opportunity type showing which types have the most open work or the best fix rate across the portfolio. Results are cached server-side for 30 minutes.

### Suggestion Status Lifecycle

```
NEW → APPROVED → IN_PROGRESS → FIXED               (terminal: success)
                              → SKIPPED             (terminal)
                              → REJECTED            (terminal)
                              → ERROR               (terminal)
                              → OUTDATED            (terminal)
                              → PENDING_VALIDATION  (pending review)
```

Opportunity statuses: `NEW` · `IN_PROGRESS` · `RESOLVED` · `IGNORED`

Fix statuses: `PENDING` · `IN_PROGRESS` · `COMPLETED` · `FAILED`

### Data Flow

```
StaticPageFrame (React)
  └── postMessage IMS token
        ↓
  imslib-adapter.js (stores token, exposes auth API)
        ↓
  Customer/site search (autocomplete → /api/customers)
        ↓
  Site selected
        ↓
  suggestions-service.js
    ├── GET /api/spacecat/sites/{siteId}/opportunities
    ├── For each opp: GET .../opportunities/{oppId}/suggestions
    └── For each opp: GET .../opportunities/{oppId}/fixes
        ↓
  suggestions-manager.js (sessionStorage cache, 15-min TTL, 3-site LRU)
    └── suggestions-health.js (health score, aging buckets, rates)
        ↓
  UI renders activity cards, trends chart, lifecycle bars, age buckets
```

### Key Files

| File | Purpose |
|------|---------|
| `src/app/suggestion-lifecycle/page.tsx` | Route + `StaticPageFrame` wrapper |
| `public/suggestion-lifecycle.html` | Full UI (~4,100 lines, self-contained) |
| `public/scripts/suggestions-manager.js` | Cache orchestration, metrics entry point |
| `public/scripts/services/suggestions-service.js` | SpaceCat opportunity/suggestion/fix fetch |
| `public/scripts/services/org-site-service.js` | Fuzzy-match customer → SpaceCat org |
| `public/scripts/utils/suggestions-health.js` | Health score + metric calculations |
| `public/scripts/components/trend-chart.js` | Chart.js time-series visualization |
| `public/scripts/components/global-filters.js` | Shared date range state |
| `src/app/api/spacecat/[...path]/route.ts` | SpaceCat proxy (all API calls) |
| `src/app/api/portfolio/opportunity-metrics/route.ts` | Portfolio aggregation endpoint |

### `suggestions-manager.js` API

```javascript
getSuggestionsForSite(siteId, token, forceRefresh)  // cached fetch + metrics
getLifecycleReport(siteId)                           // formatted report object
getSuggestionsForSites(siteIds)                      // batch fetch multiple sites
getCacheStats() / clearCache() / clearSiteCache()    // cache management
```

Cache: `sessionStorage`, 15-minute TTL, 3-site LRU pruning to manage storage quota.

### `suggestions-service.js` API

```javascript
getSiteLifecycleData(siteId, token)        // enriched opportunities array
aggregateSuggestionCounts(suggestions)     // counts by status
aggregateFixCounts(fixes)                  // fix status distribution
```

Uses `batchRequests()` for parallel SpaceCat fetches (default page size: 5).

---

## Meeting Files & Transcripts

The Meeting Files panel on the Customer 360 view is a unified upload, browse, and view interface for all meeting artifacts associated with a customer.

### File Types Supported

| Type | Accepted Extensions | Badge |
|------|---------------------|-------|
| Meeting notes | `.pdf`, `.docx`, `.xlsx`, `.xls`, `.csv`, `.txt`, `.md`, `.rtf` | Note (blue) |
| VTT transcripts | `.vtt` | Transcript (green) |

Binary files (PDF, DOCX, XLSX) are converted to text in the browser before upload using pdf.js, mammoth.js, and SheetJS respectively.

### Uploading

1. Enter the meeting date (defaults to today)
2. Enter a title (optional — defaults to filename)
3. Select the type (Note or Transcript)
4. Add a description — shown in the file list and included in the combined download so the MCP server can locate files by keyword
5. Paste/type notes in the text area, or select a file (auto-submits)

### Browsing & Viewing

Click any filename to open the inline content viewer modal. Filter by date range (All time / Last 30 / 60 / 90 days) and type (Notes / Transcripts / Both).

### Download All

Generates a combined `.vtt` file of all files in the selected date range. Each file is separated by a `NOTE` header block:

```
NOTE ────────────────────────────────────
NOTE Meeting: Acme Corp
NOTE Date: 2026-03-15  Type: notes
NOTE File: Q1-QBR-notes.pdf
NOTE Description: Q1 QBR — blockers, roadmap discussion, action items
NOTE Uploaded by: tjones  at 2026-03-16T14:22:00Z
NOTE ────────────────────────────────────
```

This header format is what the MCP server's `list_notes` tool uses to find relevant files without downloading all content.

---

## Claude / AI Integration (MCP)

The `customer-insight-mcp/` directory contains a Model Context Protocol server that connects Claude Code or Cursor to live dashboard data.

### Setup (Claude Code)

Claude Code auto-detects `.mcp.json` at the repo root. Install dependencies once:

```bash
cd customer-insight-mcp
npm install
```

The MCP server connects to production by default. To point it at a local dev server:

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

### Available Tools

| Tool | Description |
|------|-------------|
| `get_customer_data` | Latest snapshot — status, health score, blockers, ESE lead, custom fields |
| `get_comments` | ServiceNow comments (date-filterable: latest / 30 / 60 / 90 / all) |
| `list_notes` | File metadata only — date, filename, description, type, uploader. Supports keyword filter. Use this first to find relevant files before fetching full content. |
| `get_transcripts` | Full text of all meeting notes and transcripts |
| `list_customers` | All customers, filterable by status and engagement |
| `search_customers` | Full-text search across all customer fields including custom fields |
| `list_headless_customers` | Customers with headless deployment type or flag |

### Recommended Workflow

```
1. search_customers or list_customers  ← find the right company name
2. get_customer_data                   ← latest status snapshot
3. list_notes (optional)               ← preview available files by keyword
4. get_transcripts                     ← full meeting history
5. get_comments                        ← ServiceNow comment thread
```

---

## Static Embedded Pages

`/public/suggestion-lifecycle.html`, `/public/customer-history.html`, `/public/customer-history-edit.html`, and `/public/reports.html` are self-contained single-file dashboards embedded as iframes in the Next.js app.

They share a script library under `public/scripts/`:

```
public/scripts/
├── auth/
│   ├── imslib-adapter.js       ← Receives IMS token from parent via postMessage
│   ├── ims-config.js           ← IMS client config (client ID, scopes, PKCE)
│   └── ims-auth.js             ← Sign-in flow for standalone use
├── constants/
│   └── api.js                  ← SpaceCat + portfolio endpoint constants; status enums
├── services/
│   ├── spacecat-api.js         ← apiGet / apiPatch helpers + batchRequests
│   ├── org-site-service.js     ← fetchSpaceCatOrgs, fetchOrgSites, fuzzyMatchOrg
│   ├── customer-quick-ref.js   ← Audits, pending validations, user logins per customer
│   ├── suggestions-service.js  ← Opportunity / suggestion / fix CRUD
│   └── portfolio-snapshot.js   ← Portfolio data aggregation
├── utils/
│   └── suggestions-health.js   ← Health score + lifecycle metric calculations
├── components/
│   ├── trend-chart.js          ← Chart.js time-series visualization
│   └── global-filters.js       ← Shared filter state (date range)
├── suggestions-manager.js      ← Suggestion cache + metrics orchestration
└── customer-history-quick-ref.js ← Auth wiring + UI for history quick-ref panel
```

**IMS token bridge:**
```
StaticPageFrame (React)
  ├── postMessage({ type: 'ims-token', token })  →  imslib-adapter.js
  └── postMessage({ type: 'ims-signout' })       →  imslib-adapter.js

imslib-adapter.js
  ├── Stores token in _imsToken
  ├── Parses JWT for profile (email, name, userId)
  └── Exposes: getAccessToken(), getProfile(), isAuthenticated(), onAuthStateChange()
```

---

## Branch & Deployment Strategy

| Branch | Environment | Database |
|--------|------------|---------|
| `main` | Production (`asodashboard.adobecqms.net`) | Prod AppSync / DynamoDB |
| `stage` | Staging | Stage AppSync / DynamoDB |

All changes go through pull requests — direct pushes to `stage` and `main` are blocked. Feature branches are created from `origin/stage`; after review and merge, `stage` is promoted to `main` via a separate PR.

`amplify_outputs.json` is **gitignored** — each Amplify environment generates its own at build time via `ampx generate outputs`. The file in the repo is only for local development and points at the stage database.

---

## Local Development

```bash
# Prerequisites: Node 20, AWS CLI configured, Amplify CLI v2
npm install

# Option A: Use the existing stage database (fastest)
# amplify_outputs.json already points at stage — just start the app:
npm run dev

# Option B: Deploy your own personal sandbox backend
npm run amplify:sandbox   # Deploys personal CloudFormation stack, writes amplify_outputs.json
# (in a second terminal)
npm run dev

# Set a ServiceNow auth token for Lambda testing
npx ampx secret set SERVICENOW_AUTH_TOKEN
```

Open [http://localhost:3000](http://localhost:3000). Sign in with your Adobe IMS account, or use the `/developer` page to paste a manual token.

### Running the MCP Server Locally

```bash
cd customer-insight-mcp
npm install

# Point at local dev:
ASO_BASE_URL=http://localhost:3000 node server.mjs
```

Or start Claude Code normally — it auto-starts the MCP server pointed at production. To override:

```bash
ASO_BASE_URL=http://localhost:3000 claude
```

### Useful Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server on port 3000 |
| `npm run build` | Production build |
| `npm run amplify:sandbox` | Deploy personal sandbox backend |
| `npx ampx generate outputs` | Regenerate `amplify_outputs.json` from deployed backend |
| `npx ampx secret set <NAME>` | Store a secret in Amplify Secrets Manager |
