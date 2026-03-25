#!/usr/bin/env node
/**
 * One-time migration: imports CustomerSnapshot records from the legacy
 * cm-p186978-s23215-asodashboard JSON export into the AppSync/DynamoDB backend.
 *
 * Usage (two options):
 *
 *   Option A — provide credentials via environment variables (no local AWS creds needed):
 *     APPSYNC_ENDPOINT=https://xxx.appsync-api.us-east-1.amazonaws.com/graphql \
 *     APPSYNC_API_KEY=da2-xxxxxxxxxxxx \
 *     node scripts/import-legacy-data.mjs
 *
 *   Option B — generate amplify_outputs.json first (requires local AWS credentials):
 *     npx ampx generate outputs --branch main --app-id d26pj15s9ci49q
 *     node scripts/import-legacy-data.mjs
 *
 * Get the values from: AWS Console → AppSync → your API → Settings → API Keys
 */

import { readFileSync, existsSync } from "fs";

// ─── Config ───────────────────────────────────────────────────────────────────

const OUTPUTS_PATH = "./amplify_outputs.json";
const SOURCE_PATH =
  "/Users/tgardner/Documents/unified-dashboard/cm-p186978-s23215-asodashboard/data/customers.json";

const BATCH_SIZE = 10;    // mutations sent in parallel per batch
const BATCH_DELAY_MS = 300; // pause between batches to stay inside AppSync limits

// ─── Bootstrap ────────────────────────────────────────────────────────────────

let ENDPOINT = process.env.APPSYNC_ENDPOINT;
let API_KEY   = process.env.APPSYNC_API_KEY;

if (!ENDPOINT || !API_KEY) {
  // Fall back to amplify_outputs.json
  if (!existsSync(OUTPUTS_PATH)) {
    console.error(
      "No credentials found.\n" +
      "Either set APPSYNC_ENDPOINT and APPSYNC_API_KEY environment variables,\n" +
      "or run: npx ampx generate outputs --branch main --app-id d26pj15s9ci49q"
    );
    process.exit(1);
  }
  const outputs = JSON.parse(readFileSync(OUTPUTS_PATH, "utf8"));
  ENDPOINT = outputs.data.url;
  API_KEY  = outputs.data.api_key;
}

if (!ENDPOINT || !API_KEY) {
  console.error("Could not resolve AppSync endpoint or API key.");
  process.exit(1);
}

// ─── GraphQL helper ───────────────────────────────────────────────────────────

async function gql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

const CREATE_SNAPSHOT = `
  mutation CreateCustomerSnapshot($input: CreateCustomerSnapshotInput!) {
    createCustomerSnapshot(input: $input) {
      companyName
      week
    }
  }
`;

const CREATE_SUMMARY = `
  mutation CreateWeeklySummary($input: CreateWeeklySummaryInput!) {
    createWeeklySummary(input: $input) {
      week
    }
  }
`;

// ─── Field mapping ────────────────────────────────────────────────────────────

const INGESTED_AT = new Date().toISOString();

function toSnapshot(r) {
  const healthScore =
    typeof r.healthScore === "number"
      ? r.healthScore
      : r.healthScore
      ? parseInt(r.healthScore, 10)
      : null;

  return {
    companyName:              r.companyName,
    week:                     r.week,
    licenseType:              r.licenseType              || null,
    industry:                 r.industry                 || null,
    eseLead:                  r.eseLead                  || null,
    status:                   r.status                   || null,
    deploymentType:           r.deploymentType           || null,
    engagement:               r.engagement               || null,
    blockersStatus:           r.blockersStatus           || null,
    blockers:                 r.blockers                 || null,
    feedbackStatus:           r.feedbackStatus           || null,
    feedback:                 r.feedback                 || null,
    healthScore:              Number.isFinite(healthScore) ? healthScore : null,
    summary:                  r.summary                  || null,
    mau:                      r.mau                      || null,
    ttiv:                     r.ttiv                     || null,
    autoOptimizeButtonPressed: r.autoOptimizeButtonPressed || null,
    sourceLastUpdated:        r.lastUpdated              || null,
    ingestedAt:               INGESTED_AT,
    dataSource:               "legacy-json-import",
  };
}

function computeWeeklySummary(weekRecords, week) {
  const sl = (s) => (s || "").toLowerCase();

  const totalCustomers     = weekRecords.length;
  const activeCount        = weekRecords.filter((r) =>
    sl(r.status).includes("production") && !sl(r.status).includes("pre")
  ).length;
  const preProductionCount = weekRecords.filter((r) =>
    sl(r.status).includes("pre")
  ).length;
  const atRiskCount        = weekRecords.filter((r) =>
    sl(r.status).includes("hold") || sl(r.status).includes("risk")
  ).length;
  const onboardingCount    = weekRecords.filter((r) =>
    sl(r.status).includes("onboard")
  ).length;
  const churnedCount       = weekRecords.filter((r) =>
    sl(r.status).includes("dead") ||
    sl(r.status).includes("terminat") ||
    sl(r.status) === "sandbox"
  ).length;

  const scores = weekRecords
    .map((r) =>
      typeof r.healthScore === "number"
        ? r.healthScore
        : r.healthScore
        ? parseInt(r.healthScore, 10)
        : NaN
    )
    .filter((n) => Number.isFinite(n));
  const avgHealthScore =
    scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
      : null;

  // Old engagement values: "Active" → High, "At Risk" → Medium, "Critical" → Low
  const highEngagementCount   = weekRecords.filter((r) => sl(r.engagement) === "active").length;
  const mediumEngagementCount = weekRecords.filter((r) => sl(r.engagement) === "at risk").length;
  const lowEngagementCount    = weekRecords.filter((r) => sl(r.engagement) === "critical").length;

  return {
    week,
    totalCustomers,
    activeCount,
    atRiskCount,
    onboardingCount,
    preProductionCount,
    churnedCount,
    avgHealthScore,
    highEngagementCount,
    mediumEngagementCount,
    lowEngagementCount,
    computedAt: INGESTED_AT,
    dataSource: "legacy-json-import",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const source  = JSON.parse(readFileSync(SOURCE_PATH, "utf8"));
  const records = source.data ?? source;

  console.log(`\nEndpoint : ${ENDPOINT}`);
  console.log(`Records  : ${records.length} CustomerSnapshots across multiple weeks\n`);

  // ── 1. Import CustomerSnapshots ────────────────────────────────────────────
  console.log("Step 1/2 — Importing CustomerSnapshot records...");
  let ok = 0, failed = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (r) => {
        try {
          await gql(CREATE_SNAPSHOT, { input: toSnapshot(r) });
          ok++;
        } catch (err) {
          failed++;
          console.error(`\n  ✗ ${r.companyName} / ${r.week}: ${err.message}`);
        }
      })
    );

    process.stdout.write(
      `\r  ${Math.min(i + BATCH_SIZE, records.length)}/${records.length} ` +
      `(${ok} ok, ${failed} failed)`
    );

    if (i + BATCH_SIZE < records.length) await sleep(BATCH_DELAY_MS);
  }

  console.log(`\n\n  Done: ${ok} written, ${failed} failed.\n`);

  // ── 2. Compute and write WeeklySummary ────────────────────────────────────
  const byWeek = {};
  for (const r of records) {
    (byWeek[r.week] ??= []).push(r);
  }
  const weeks = Object.keys(byWeek).sort();

  console.log(`Step 2/2 — Writing ${weeks.length} WeeklySummary records...`);
  let sumOk = 0, sumFailed = 0;

  for (const week of weeks) {
    try {
      await gql(CREATE_SUMMARY, { input: computeWeeklySummary(byWeek[week], week) });
      sumOk++;
      process.stdout.write(`\r  ${sumOk}/${weeks.length}`);
    } catch (err) {
      sumFailed++;
      console.error(`\n  ✗ WeeklySummary ${week}: ${err.message}`);
    }
    await sleep(100);
  }

  console.log(`\n\n  Done: ${sumOk} written, ${sumFailed} failed.\n`);
  console.log("Import complete.\n");
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
