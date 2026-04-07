#!/usr/bin/env node
/**
 * Copies data between main and stage AppSync environments.
 *
 * Usage — always pass SRC/DST explicitly via env vars:
 *   SRC_ENDPOINT=https://…  SRC_API_KEY=da2-…
 *   DST_ENDPOINT=https://…  DST_API_KEY=da2-…
 *   node scripts/copy-db-to-stage.mjs [options]
 *
 * Known endpoints:
 *   main:  https://n6oaqan4jraftkdj6e4sjjcegq.appsync-api.us-east-1.amazonaws.com/graphql  key: da2-l6dhwbjv5rhv5bdznbdpqesw24
 *   stage: https://r5niq6rmfbcgvbd2s2l2j4zx7q.appsync-api.us-east-1.amazonaws.com/graphql  key: da2-gzfsjnnvx5g3bilwcvryy52hli
 *
 * Options:
 *   --dry-run              Print counts but don't write anything
 *   --skip-summary         Skip WeeklySummary table
 *   --only-transcripts     Copy ONLY MeetingTranscript records (e.g. stage → main)
 */

import { readFileSync, existsSync } from "fs";

// ─── Config ───────────────────────────────────────────────────────────────────

const DRY_RUN            = process.argv.includes("--dry-run");
const SKIP_SUMMARY       = process.argv.includes("--skip-summary");
const ONLY_TRANSCRIPTS   = process.argv.includes("--only-transcripts");
const BATCH_SIZE    = 10;
const BATCH_DELAY   = 300; // ms between write batches to stay inside AppSync limits

const SRC_OUTPUTS  = "./amplify_outputs.json";
const DST_OUTPUTS  = "./scripts/stage-outputs/amplify_outputs.json";

// ─── Resolve credentials ──────────────────────────────────────────────────────

function loadOutputs(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

let SRC_ENDPOINT = process.env.SRC_ENDPOINT;
let SRC_API_KEY  = process.env.SRC_API_KEY;
let DST_ENDPOINT = process.env.DST_ENDPOINT;
let DST_API_KEY  = process.env.DST_API_KEY;

if (!SRC_ENDPOINT || !SRC_API_KEY) {
  const src = loadOutputs(SRC_OUTPUTS);
  if (!src) {
    console.error(`Source outputs not found at ${SRC_OUTPUTS}`);
    console.error("Run: npx ampx generate outputs --branch main --app-id d26pj15s9ci49q");
    process.exit(1);
  }
  SRC_ENDPOINT = src.data.url;
  SRC_API_KEY  = src.data.api_key;
}

if (!DST_ENDPOINT || !DST_API_KEY) {
  const dst = loadOutputs(DST_OUTPUTS);
  if (!dst) {
    console.error(`Stage outputs not found at ${DST_OUTPUTS}`);
    console.error("Run: npx ampx generate outputs --branch stage --app-id d26pj15s9ci49q --out-dir scripts/stage-outputs");
    console.error("Or set DST_ENDPOINT and DST_API_KEY environment variables.");
    process.exit(1);
  }
  DST_ENDPOINT = dst.data.url;
  DST_API_KEY  = dst.data.api_key;
}

if (SRC_ENDPOINT === DST_ENDPOINT) {
  console.error("Source and destination endpoints are the same — aborting to prevent data corruption.");
  process.exit(1);
}

console.log("Source:", SRC_ENDPOINT);
console.log("Destination:", DST_ENDPOINT);
if (DRY_RUN) console.log("DRY RUN — no writes will be made.");
console.log();

// ─── GraphQL helpers ──────────────────────────────────────────────────────────

async function gql(endpoint, apiKey, query, variables = {}) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${endpoint}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join("; "));
  return json.data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Queries (source reads) ───────────────────────────────────────────────────

const LIST_SNAPSHOTS = `
  query ListSnapshots($limit: Int, $nextToken: String) {
    listCustomerSnapshots(limit: $limit, nextToken: $nextToken) {
      items {
        companyName week licenseType industry eseLead status deploymentType
        engagement blockersStatus blockers feedbackStatus feedback healthScore
        summary mau ttiv autoOptimizeButtonPressed sourceLastUpdated ingestedAt dataSource
      }
      nextToken
    }
  }
`;

const LIST_SUMMARIES = `
  query ListSummaries($limit: Int, $nextToken: String) {
    listWeeklySummaries(limit: $limit, nextToken: $nextToken) {
      items {
        week totalCustomers activeCount atRiskCount onboardingCount preProductionCount
        churnedCount avgHealthScore highEngagementCount mediumEngagementCount
        lowEngagementCount computedAt dataSource
      }
      nextToken
    }
  }
`;

const LIST_TRANSCRIPTS = `
  query ListTranscripts($limit: Int, $nextToken: String) {
    listMeetingTranscripts(limit: $limit, nextToken: $nextToken) {
      items {
        id companyName meetingDate fileType fileName content uploadedBy uploadedAt
      }
      nextToken
    }
  }
`;

async function fetchAll(endpoint, apiKey, query, listKey) {
  const items = [];
  let nextToken = null;
  do {
    const data = await gql(endpoint, apiKey, query, { limit: 500, nextToken });
    const page = data[listKey];
    items.push(...page.items);
    nextToken = page.nextToken ?? null;
    process.stdout.write(`\r  Fetched ${items.length} records…`);
  } while (nextToken);
  process.stdout.write("\n");
  return items;
}

// ─── Mutations (destination writes) ──────────────────────────────────────────

const UPSERT_SNAPSHOT = `
  mutation UpsertSnapshot($input: CreateCustomerSnapshotInput!) {
    createCustomerSnapshot(input: $input) { companyName week }
  }
`;

const UPSERT_SUMMARY = `
  mutation UpsertSummary($input: CreateWeeklySummaryInput!) {
    createWeeklySummary(input: $input) { week }
  }
`;

const UPSERT_TRANSCRIPT = `
  mutation UpsertTranscript($input: CreateMeetingTranscriptInput!) {
    createMeetingTranscript(input: $input) { id }
  }
`;

// AppSync will throw ConflictUnhandled if the item already exists with the
// default conflict handler — catch it and retry with update instead.
const UPDATE_SNAPSHOT = `
  mutation UpdateSnapshot($input: UpdateCustomerSnapshotInput!) {
    updateCustomerSnapshot(input: $input) { companyName week }
  }
`;

const UPDATE_SUMMARY = `
  mutation UpdateSummary($input: UpdateWeeklySummaryInput!) {
    updateWeeklySummary(input: $input) { week }
  }
`;

const UPDATE_TRANSCRIPT = `
  mutation UpdateTranscript($input: UpdateMeetingTranscriptInput!) {
    updateMeetingTranscript(input: $input) { id }
  }
`;

async function upsertOne(endpoint, apiKey, item, createMutation, updateMutation) {
  try {
    await gql(endpoint, apiKey, createMutation, { input: item });
    return "created";
  } catch (err) {
    if (/ConflictUnhandled|already exists|conditional/i.test(err.message)) {
      await gql(endpoint, apiKey, updateMutation, { input: item });
      return "updated";
    }
    throw err;
  }
}

async function writeAll(endpoint, apiKey, items, createMutation, updateMutation, label) {
  let created = 0, updated = 0, failed = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((item) => upsertOne(endpoint, apiKey, item, createMutation, updateMutation))
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        r.value === "created" ? created++ : updated++;
      } else {
        failed++;
        console.error("\n  Write error:", r.reason?.message);
      }
    }
    process.stdout.write(`\r  ${label}: ${created + updated}/${items.length} written (${failed} errors)…`);
    if (i + BATCH_SIZE < items.length) await sleep(BATCH_DELAY);
  }
  process.stdout.write("\n");
  return { created, updated, failed };
}

// ─── Strip read-only fields before writing ────────────────────────────────────

function prepSnapshot(r) {
  // eslint-disable-next-line no-unused-vars
  const { createdAt, updatedAt, __typename, ...rest } = r;
  return rest;
}

function prepSummary(r) {
  // eslint-disable-next-line no-unused-vars
  const { createdAt, updatedAt, __typename, ...rest } = r;
  return rest;
}

// Generic — strips only the Amplify-managed read-only timestamps
function prepItem(r) {
  // eslint-disable-next-line no-unused-vars
  const { createdAt, updatedAt, __typename, ...rest } = r;
  return rest;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const stats = {};

  if (ONLY_TRANSCRIPTS) {
    // ── Transcripts only (e.g. stage → main) ──────────────────────────────────
    console.log("Reading MeetingTranscripts from source…");
    const transcripts = await fetchAll(SRC_ENDPOINT, SRC_API_KEY, LIST_TRANSCRIPTS, "listMeetingTranscripts");
    console.log(`  Total: ${transcripts.length} transcripts`);

    if (DRY_RUN) { console.log("\nDry run complete. No data was written."); return; }

    console.log("\nWriting MeetingTranscripts to destination…");
    stats.transcripts = await writeAll(
      DST_ENDPOINT, DST_API_KEY,
      transcripts.map(prepItem),
      UPSERT_TRANSCRIPT, UPDATE_TRANSCRIPT,
      "MeetingTranscripts"
    );
  } else {
    // ── Full copy (snapshots + summaries) ─────────────────────────────────────
    console.log("Reading CustomerSnapshots from source…");
    const snapshots = await fetchAll(SRC_ENDPOINT, SRC_API_KEY, LIST_SNAPSHOTS, "listCustomerSnapshots");
    console.log(`  Total: ${snapshots.length} snapshots`);

    let summaries = [];
    if (!SKIP_SUMMARY) {
      console.log("Reading WeeklySummaries from source…");
      summaries = await fetchAll(SRC_ENDPOINT, SRC_API_KEY, LIST_SUMMARIES, "listWeeklySummaries");
      console.log(`  Total: ${summaries.length} weekly summaries`);
    }

    if (DRY_RUN) { console.log("\nDry run complete. No data was written."); return; }

    console.log("\nWriting CustomerSnapshots to destination…");
    stats.snapshots = await writeAll(
      DST_ENDPOINT, DST_API_KEY,
      snapshots.map(prepSnapshot),
      UPSERT_SNAPSHOT, UPDATE_SNAPSHOT,
      "CustomerSnapshots"
    );

    if (!SKIP_SUMMARY && summaries.length > 0) {
      console.log("Writing WeeklySummaries to destination…");
      stats.summaries = await writeAll(
        DST_ENDPOINT, DST_API_KEY,
        summaries.map(prepSummary),
        UPSERT_SUMMARY, UPDATE_SUMMARY,
        "WeeklySummaries"
      );
    }
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log("\n── Results ──────────────────────────────────────");
  let anyFailed = false;
  for (const [table, s] of Object.entries(stats)) {
    console.log(`${table.padEnd(20)}: ${s.created} created, ${s.updated} updated, ${s.failed} failed`);
    if (s.failed > 0) anyFailed = true;
  }
  if (anyFailed) { console.log("\nSome records failed — check errors above."); process.exit(1); }
  else console.log("\nDone.");
})();
