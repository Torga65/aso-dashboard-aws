# ASO Dashboard (AWS)

Internal Adobe Sites Optimizer (ASO) customer success dashboard. Tracks engagement, health scores, suggestion lifecycle, and portfolio metrics for ~600 Adobe Sites customers.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [AWS Infrastructure](#aws-infrastructure)
- [Data Models](#data-models)
- [Application Pages](#application-pages)
- [API Routes](#api-routes)
- [Authentication](#authentication)
- [Daily Data Ingestion](#daily-data-ingestion)
- [Static Embedded Pages](#static-embedded-pages)
- [Branch & Deployment Strategy](#branch--deployment-strategy)
- [Local Development](#local-development)

---

## Architecture Overview

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

## AWS Infrastructure

All infrastructure is defined as code using **AWS Amplify Gen 2** (CDK under the hood).

| Resource | Details |
|----------|---------|
| **Amplify Hosting** | Hosts the Next.js app; separate environments for `main` (prod) and `stage` |
| **AppSync** | GraphQL API gateway in front of all DynamoDB tables; API Key + IAM auth |
| **DynamoDB** | 5 tables (see [Data Models](#data-models)); managed by AppSync via Amplify |
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
        └── handler.ts      ← Entry point + orchestration
            ├── api-client.ts      ← ServiceNow HTTP client
            ├── normalizer.ts      ← Field mapping / validation
            ├── appsync-client.ts  ← Raw AppSync GraphQL client
            └── persistence.ts     ← DynamoDB write operations
```

---

## Data Models

### CustomerSnapshot
> One record per customer per week. Primary data store.

| Field | Type | Notes |
|-------|------|-------|
| `companyName` | String (PK) | Customer company name |
| `week` | String (SK) | ISO Monday date e.g. `"2026-01-23"` |
| `status` | String | Active / At-Risk / Onboarding / Pre-Production / Churned |
| `engagement` | String | High / Medium / Low / Unknown |
| `healthScore` | Int | 0–100 |
| `eseLead` | String | Assigned ESE engineer |
| `licenseType` | String | License tier |
| `industry` | String | Customer industry vertical |
| `imsOrgId` | String | IMS Org ID from ServiceNow |
| `tenantId` | String | AEM tenant ID |
| `mau` | String | Monthly Active Users |
| `ttiv` | String | Time to Initial Value |
| `blockers` / `feedback` | String | Freetext from ServiceNow |
| `dataSource` | String | `"ServiceNow"` or `"Manual"` |
| `ingestedAt` | DateTime | When the Lambda wrote this record |

**Secondary indexes:**
- `byWeek(week, companyName)` — Main dashboard: all customers for a week
- `byCompany(companyName, week)` — History page: all weeks for one customer

### WeeklySummary
> Pre-aggregated counts written by the Lambda alongside CustomerSnapshots. Eliminates N-row fan-out on the dashboard.

Primary key: `week`. Fields: `totalCustomers`, `activeCount`, `atRiskCount`, `onboardingCount`, `preProductionCount`, `churnedCount`, `avgHealthScore`, `highEngagementCount`, `mediumEngagementCount`, `lowEngagementCount`.

### CustomerOrgMapping
> Maps a customer name → SpaceCat Org ID. Set manually (via UI picker) when fuzzy matching fails. Persists so future loads skip the picker.

Primary key: `companyName`. Key field: `spacecatOrgId`.

### CustomerNote
> User-added annotations per customer per week, without mutating source data.

Composite key: `(companyName, week)`. Secondary index: `byCompany`.

### DataSyncJob
> Audit log for Lambda runs. One record per execution: RUNNING → COMPLETED or FAILED.

Fields: `status`, `startedAt`, `completedAt`, `weekIngested`, `recordsProcessed`, `recordsFailed`, `errorMessage`, `triggeredBy`.

---

## Application Pages

| Route | File | Description |
|-------|------|-------------|
| `/` | `src/app/page.tsx` | Home — hero, customer overview tiles, quick links |
| `/dashboard` | `src/app/dashboard/page.tsx` | Full customer dashboard view |
| `/engagement` | `src/app/engagement/page.tsx` | Detailed engagement table with filters |
| `/engagement/weekly` | `src/app/engagement/weekly/page.tsx` | Week-over-week comparison reports |
| `/customer-history` | `src/app/customer-history/page.tsx` | Per-customer historical deep-dive (iframe → static page) |
| `/suggestion-lifecycle` | `src/app/suggestion-lifecycle/page.tsx` | SpaceCat suggestion lifecycle + portfolio view (iframe → static page) |
| `/developer` | `src/app/developer/page.tsx` | Token debugger, sync job log, manual token entry |
| `/auth/callback` | `src/app/auth/callback/page.tsx` | IMS OAuth 2.0 callback handler |

The `customer-history` and `suggestion-lifecycle` pages embed self-contained static HTML files via `StaticPageFrame` — an `<iframe>` component that bridges the IMS access token from the React app into the iframe via `postMessage`.

---

## API Routes

### `GET /api/customers`
Returns all `CustomerSnapshot` records as a flat JSON array.

**Strategy:**
1. Query `WeeklySummary` to get known weeks
2. For each week, run a parallel GSI query (`byWeek`) — avoids full-table scan
3. Fallback: paginated `list()` if WeeklySummary is empty

### `GET /api/org-mapping?company=<name>`
Looks up a saved SpaceCat Org ID for a customer from `CustomerOrgMapping`.

### `PUT /api/org-mapping`
Body: `{ companyName, spacecatOrgId }`. Upserts the mapping into DynamoDB.

### `GET /api/spacecat/[...path]`
Transparent proxy to `https://spacecat.experiencecloud.live/api/v1`. Forwards the caller's `Authorization: Bearer` header. Bypasses CORS restrictions on SpaceCat in local/iframe contexts. Supports GET, POST, PUT, PATCH, DELETE.

### `GET /api/portfolio/opportunity-metrics`
Aggregates SpaceCat opportunity data across sites for the portfolio dashboard.

| Param | Description |
|-------|-------------|
| `siteScope=global` | Fetch all sites (slow, use for org-level first) |
| `orgId=<id>` | Fetch sites for one SpaceCat org |
| `siteIds=a,b,c` | Explicit site list |
| `from` / `to` | Date range `YYYY-MM-DD` |
| `includeLlmo=1` | Include LLMO-only opportunity types |
| `includeGeneric=1` | Include generic-opportunity type |

Returns bucketed counts, status-change buckets, and summary metrics (totalAvailable, movedToFixed, pendingValidation, customerEngagement, etc.). Results are cached in-memory for 30 minutes.

---

## Authentication

The app uses **Adobe IMS (Identity Management System)** — no Cognito user-password auth for normal users.

```
Browser
  └── @identity/imslib (OAuth 2.0 implicit/PKCE)
        ├── Client ID: ASO-dashboard
        ├── Scopes: openid, AdobeID, additional_info,
        │          additional_info.projectedProductContext,
        │          read_organizations, account_cluster.read
        └── Prod IMS: https://ims-na1.adobelogin.com
```

**Key files:**
- `src/contexts/IMSAuthContext.tsx` — React context; provides `useIMSAuth()` hook
- `src/components/auth/AuthButton.tsx` — Avatar button (Behance photo) + sign-in/out dropdown
- `src/components/layout/StaticPageFrame.tsx` — Posts IMS token into iframe pages via `postMessage`
- `public/scripts/auth/imslib-adapter.js` — Receives token inside iframe; exposes same API as direct IMS

**Developer mode:** Any page accepts a manually-pasted IMS token via the `/developer` page. Stored in `localStorage` as `aso_manual_ims_token` (React) / `aso_manual_api_token` (static pages).

---

## Daily Data Ingestion

```
EventBridge Scheduler (02:00 UTC)
        │
        ▼
Lambda: daily-fetch
        │
        ├─ 1. fetchCustomers()         ← GET ServiceNow API (~600 records)
        │      auth: SERVICENOW_AUTH_TOKEN (Secrets Manager)
        │
        ├─ 2. normalizeCustomer()      ← Map ServiceNow fields → CustomerSnapshot schema
        │      (companyName, week, status, engagement, healthScore, imsOrgId, …)
        │
        ├─ 3. writeSnapshots()         ← AppSync GraphQL mutation (upsert per record)
        │      auth: APPSYNC_API_KEY (env var injected by Amplify)
        │
        ├─ 4. computeWeeklySummary()   ← Aggregate counts from snapshots
        │   upsertWeeklySummary()      ← AppSync GraphQL mutation (upsert by week)
        │
        └─ 5. DataSyncJob log          ← RUNNING → COMPLETED / FAILED
               recordsProcessed, recordsFailed, weekIngested
```

**Failure handling:** Lambda re-throws unhandled errors → EventBridge retries 2× → permanent failures land in SQS DLQ → CloudWatch alarm fires.

---

## Static Embedded Pages

`/public/suggestion-lifecycle.html` and `/public/customer-history.html` are self-contained single-file dashboards embedded as iframes in the Next.js app.

They share a script library under `public/scripts/`:

```
public/scripts/
├── auth/
│   ├── imslib-adapter.js       ← Receives IMS token from parent via postMessage
│   ├── ims-config.js           ← IMS client config (client ID, scopes, PKCE)
│   └── ims-auth.js             ← Sign-in flow for standalone use
├── constants/
│   └── api.js                  ← SpaceCat + portfolio endpoint constants
├── services/
│   ├── spacecat-api.js         ← apiGet / apiPatch helpers
│   ├── org-site-service.js     ← fetchSpaceCatOrgs, fetchOrgSites
│   ├── customer-quick-ref.js   ← Audits, pending validation, user logins per customer
│   └── suggestions-service.js  ← Opportunity / suggestion CRUD
├── components/
│   ├── trend-chart.js          ← Chart.js trend visualization
│   └── global-filters.js       ← Shared filter state
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
| `main` | Production (Amplify `main`) | Prod AppSync / DynamoDB |
| `stage` | Staging (Amplify `stage`) | Stage AppSync / DynamoDB |

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
