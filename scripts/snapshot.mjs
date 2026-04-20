#!/usr/bin/env node
/**
 * Snapshot script — fetches opportunities from SpaceCat and writes
 * a JSON snapshot to public/server/data/snapshots/.
 *
 * Usage (all sites — global snapshot):
 *   node scripts/snapshot.js --token <SPACECAT_API_TOKEN>
 *
 * Usage (ASO-only sites, smaller/faster — run customer snapshot first):
 *   node scripts/snapshot.js --token <TOKEN> --customers
 *   node scripts/snapshot.js --token <TOKEN> --customers path/to/customers.json
 *
 * Usage (single org):
 *   node scripts/snapshot.js --token <TOKEN> --org <ORG_ID>
 *
 * Usage (team portfolio — ASO sites, default in Portfolio view):
 *   node scripts/snapshot.js --token <TOKEN> --portfolio
 *
 * Usage (CJA dashboard sites — comparison snapshot; updates latest-portfolio-cja.json only):
 *   node scripts/snapshot.js --token <TOKEN> --portfolio-cja
 *
 * Token: SPACECAT_TOKEN or SPACECAT_API_KEY in repo-root .env.local (see scripts/load-snapshot-env.mjs), or:
 *   SPACECAT_TOKEN=xxx node scripts/snapshot.js
 *
 * The snapshot contains only the fields needed for portfolio aggregation,
 * keeping file size manageable (~50-80 bytes per opportunity).
 */

import {
  writeFileSync, mkdirSync, existsSync, readFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// Snapshot lives under server/; portfolio site lists live at repo root (shared with the dashboard).
// eslint-disable-next-line import/no-relative-packages -- intentional cross-folder import
import { loadSnapshotEnv } from './load-snapshot-env.mjs';
import { getPortfolioAllowedSiteIds } from '../public/scripts/constants/portfolio-allowed-sites.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadSnapshotEnv();
const SNAPSHOTS_DIR = join(__dirname, '..', 'public', 'server', 'data', 'snapshots');

const SPACECAT_BASE = process.env.SPACECAT_API_BASE || 'https://spacecat.experiencecloud.live/api/v1';
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 80;

// ---- Helpers ----

async function spacecatGet(url, token) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

async function fetchAllSiteIds(token) {
  console.log('[Snapshot] Fetching all sites...');
  const data = await spacecatGet(`${SPACECAT_BASE}/sites`, token);
  const sites = Array.isArray(data) ? data : (data.sites || data.data || []);
  const ids = sites.map((s) => s.id || s.siteId).filter(Boolean);
  console.log(`[Snapshot] Found ${ids.length} sites`);
  return ids;
}

async function fetchOrgSiteIds(orgId, token) {
  console.log(`[Snapshot] Fetching sites for org ${orgId}...`);
  const url = `${SPACECAT_BASE}/organizations/${orgId}/sites`;
  const data = await spacecatGet(url, token);
  const sites = Array.isArray(data) ? data : (data.sites || data.data || []);
  const ids = sites.map((s) => s.id || s.siteId).filter(Boolean);
  console.log(`[Snapshot] Found ${ids.length} sites for org ${orgId}`);
  return ids;
}

/**
 * Load site IDs from a customer snapshot (ASO-only orgs + sites).
 * Returns array of site IDs, or null if file missing/invalid.
 */
function loadSiteIdsFromCustomerSnapshot(customersPath) {
  if (!existsSync(customersPath)) {
    return null;
  }
  try {
    const raw = readFileSync(customersPath, 'utf-8');
    const data = JSON.parse(raw);
    const { customers } = data;
    if (!Array.isArray(customers)) return null;
    const ids = [];
    for (const org of customers) {
      const { sites } = org;
      if (!Array.isArray(sites)) continue;
      for (const site of sites) {
        const id = site.siteId || site.id;
        if (id) ids.push(id);
      }
    }
    return [...new Set(ids)];
  } catch {
    return null;
  }
}

async function fetchSiteOpportunities(siteId, token) {
  const url = `${SPACECAT_BASE}/sites/${siteId}/opportunities`;
  try {
    const data = await spacecatGet(url, token);
    const opps = Array.isArray(data) ? data : (data.opportunities || data.data || []);
    return opps.map((o) => ({
      id: o.id,
      siteId: o.siteId || siteId,
      status: o.status,
      type: o.type || o.opportunityType || '',
      createdAt: o.createdAt || '',
      updatedAt: o.updatedAt || '',
    }));
  } catch {
    return [];
  }
}

async function fetchOpportunitySuggestions(siteId, oppId, token) {
  const url = `${SPACECAT_BASE}/sites/${siteId}/opportunities/${oppId}/suggestions`;
  try {
    const data = await spacecatGet(url, token);
    return Array.isArray(data) ? data : (data.suggestions || data.data || []);
  } catch {
    return [];
  }
}

/** Suggestion status enum (match client). */
const SUG = {
  FIXED: 'FIXED',
  SKIPPED: 'SKIPPED',
  REJECTED: 'REJECTED',
  APPROVED: 'APPROVED',
  IN_PROGRESS: 'IN_PROGRESS',
  PENDING_VALIDATION: 'PENDING_VALIDATION',
  ERROR: 'ERROR',
  OUTDATED: 'OUTDATED',
  NEW: 'NEW',
};

/**
 * Build compact per-suggestion state for date-filtered "moved to" metrics.
 * Each item: { s: status, u: updatedAt (YYYY-MM-DD), c: createdAt (YYYY-MM-DD) }.
 * Uses same fallbacks as client (created_at, updated_at, opp dates).
 */
function buildSuggestionStates(suggestions, opp) {
  const oppU = (opp.updatedAt || '').slice(0, 10);
  const oppC = (opp.createdAt || '').slice(0, 10);
  return suggestions.map((s) => {
    const rawU = s.updatedAt ?? s.updated_at ?? opp.updatedAt;
    const rawC = s.createdAt ?? s.created_at ?? opp.createdAt;
    return {
      s: s.status || SUG.NEW,
      u: (rawU && String(rawU).slice(0, 10)) || oppU || '',
      c: (rawC && String(rawC).slice(0, 10)) || oppC || '',
    };
  });
}

function aggregateSuggestionCounts(suggestions) {
  const counts = {
    newCount: 0,
    approvedCount: 0,
    inProgressCount: 0,
    pendingValidationCount: 0,
    fixedCount: 0,
    skippedCount: 0,
    rejectedRawCount: 0,
    errorCount: 0,
    outdatedCount: 0,
    totalCount: suggestions.length,
  };
  for (const s of suggestions) {
    const status = (s.status || SUG.NEW);
    switch (status) {
      case SUG.FIXED: counts.fixedCount++; break;
      case SUG.SKIPPED: counts.skippedCount++; break;
      case SUG.REJECTED: counts.rejectedRawCount++; break;
      case SUG.APPROVED: counts.approvedCount++; break;
      case SUG.IN_PROGRESS: counts.inProgressCount++; break;
      case SUG.PENDING_VALIDATION: counts.pendingValidationCount++; break;
      case SUG.ERROR: counts.errorCount++; break;
      case SUG.OUTDATED: counts.outdatedCount++; break;
      default: counts.newCount++; break;
    }
  }
  counts.pendingCount = counts.newCount + counts.approvedCount
    + counts.inProgressCount + counts.pendingValidationCount;
  counts.terminalCount = counts.fixedCount + counts.skippedCount
    + counts.rejectedRawCount + counts.errorCount + counts.outdatedCount;
  counts.awaitingCustomerReviewCount = counts.newCount + counts.approvedCount
   + counts.inProgressCount;
  return counts;
}

const SUGGESTION_BATCH_SIZE = 8;
const SUGGESTION_BATCH_DELAY_MS = 100;

async function enrichOpportunitiesWithSuggestionCounts(opportunities, token) {
  let done = 0;
  const total = opportunities.length;
  const logEvery = Math.max(1, Math.floor(total / 20));
  for (let i = 0; i < total; i += SUGGESTION_BATCH_SIZE) {
    const batch = opportunities.slice(i, i + SUGGESTION_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (opp) => {
        const list = await fetchOpportunitySuggestions(opp.siteId, opp.id, token);
        const counts = aggregateSuggestionCounts(list);
        const suggestionStates = buildSuggestionStates(list, opp);
        return { opp, counts, suggestionStates };
      }),
    );
    for (const { opp, counts, suggestionStates } of results) {
      opp.suggestionCounts = counts;
      opp.suggestionStates = suggestionStates;
    }
    done += batch.length;
    if (done % logEvery < SUGGESTION_BATCH_SIZE || done === total) {
      const pct = ((done / total) * 100).toFixed(0);
      console.log(`[Snapshot] Suggestions: ${done}/${total} opps (${pct}%)`);
    }
    if (i + SUGGESTION_BATCH_SIZE < total) {
      await new Promise((r) => { setTimeout(r, SUGGESTION_BATCH_DELAY_MS); });
    }
  }
}

function formatEta(elapsedMs, processed, total) {
  if (processed === 0) return '';
  const remaining = total - processed;
  const msPerItem = elapsedMs / processed;
  const etaSec = Math.round((remaining * msPerItem) / 1000);
  if (etaSec < 60) return `~${etaSec}s remaining`;
  return `~${Math.round(etaSec / 60)}m ${etaSec % 60}s remaining`;
}

function parseArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

// ---- Main ----

async function run() {
  const token = parseArg('--token') || process.env.SPACECAT_TOKEN;
  const orgId = parseArg('--org') || null;
  const customersOpt = parseArg('--customers');
  const useCustomers = hasFlag('--customers');
  const usePortfolioCja = hasFlag('--portfolio-cja');
  const usePortfolioAso = hasFlag('--portfolio') && !usePortfolioCja;

  if (!token) {
    console.error(
      'Error: no SpaceCat token. Set SPACECAT_API_KEY or SPACECAT_TOKEN in .env.local (repo root), '
        + 'or run: SPACECAT_TOKEN=your_token npm run snapshot:portfolio',
    );
    process.exit(1);
  }

  const startTime = Date.now();
  let scopeLabel = 'global';
  if (orgId) scopeLabel = `org ${orgId}`;
  else if (usePortfolioCja) scopeLabel = 'portfolio CJA (comparison)';
  else if (usePortfolioAso) scopeLabel = 'portfolio ASO (team)';
  console.log(`[Snapshot] Starting ${scopeLabel} snapshot...`);

  // 1. Get site IDs (org > portfolio-cja > portfolio-aso > customers > all sites)
  let siteIds;
  if (orgId) {
    siteIds = await fetchOrgSiteIds(orgId, token);
  } else if (usePortfolioCja) {
    siteIds = getPortfolioAllowedSiteIds('cja');
    console.log(`[Snapshot] Using ${siteIds.length} CJA dashboard sites (comparison)`);
  } else if (usePortfolioAso) {
    siteIds = getPortfolioAllowedSiteIds('aso');
    console.log(`[Snapshot] Using ${siteIds.length} team portfolio (ASO) sites`);
  } else if (useCustomers) {
    const customersPath = (customersOpt && customersOpt.length > 0 && !customersOpt.startsWith('-'))
      ? customersOpt
      : join(SNAPSHOTS_DIR, 'customers.json');
    siteIds = loadSiteIdsFromCustomerSnapshot(customersPath);
    if (siteIds && siteIds.length > 0) {
      console.log(`[Snapshot] Using ${siteIds.length} ASO sites from customer snapshot (${customersPath})`);
    } else {
      console.warn(`[Snapshot] No customer snapshot at ${customersPath} or empty; falling back to all sites`);
      siteIds = await fetchAllSiteIds(token);
    }
  } else {
    siteIds = await fetchAllSiteIds(token);
  }

  // 2. Fetch opportunities in batches
  const allOpps = [];
  let processed = 0;
  const logInterval = Math.max(1, Math.floor(siteIds.length / 20));

  for (let i = 0; i < siteIds.length; i += BATCH_SIZE) {
    const batch = siteIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((id) => fetchSiteOpportunities(id, token)));
    for (const opps of results) {
      allOpps.push(...opps);
    }
    processed += batch.length;
    if (processed % logInterval < BATCH_SIZE || processed === siteIds.length) {
      const pct = ((processed / siteIds.length) * 100).toFixed(0);
      const eta = formatEta(Date.now() - startTime, processed, siteIds.length);
      console.log(`[Snapshot] ${processed}/${siteIds.length} sites (${pct}%) — ${allOpps.length} opps ${eta}`);
    }
    if (i + BATCH_SIZE < siteIds.length) {
      await new Promise((r) => { setTimeout(r, BATCH_DELAY_MS); });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Snapshot] Fetched ${allOpps.length} opportunities from ${siteIds.length} sites in ${elapsed}s`);

  // 2b. Enrich each opportunity with suggestion counts (one request per opp)
  console.log('[Snapshot] Fetching suggestion counts per opportunity...');
  await enrichOpportunitiesWithSuggestionCounts(allOpps, token);

  // 3. Write snapshot
  const today = new Date().toISOString().slice(0, 10);
  let snapshotScope = 'global';
  if (orgId) snapshotScope = orgId;
  else if (usePortfolioCja) snapshotScope = 'portfolio-cja';
  else if (usePortfolioAso) snapshotScope = 'portfolio-aso';
  const snapshot = {
    snapshotDate: today,
    generatedAt: new Date().toISOString(),
    scope: snapshotScope,
    siteCount: siteIds.length,
    opportunityCount: allOpps.length,
    opportunities: allOpps,
  };

  if (!existsSync(SNAPSHOTS_DIR)) {
    mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }

  let filePrefix = 'global';
  if (orgId) filePrefix = `org-${orgId}`;
  else if (usePortfolioCja) filePrefix = 'portfolio-cja';
  else if (usePortfolioAso) filePrefix = 'portfolio-aso';
  const filename = `${filePrefix}-${today}.json`;
  const filepath = join(SNAPSHOTS_DIR, filename);
  const jsonStr = JSON.stringify(snapshot);
  writeFileSync(filepath, jsonStr);
  const sizeMB = (Buffer.byteLength(jsonStr) / 1024 / 1024).toFixed(1);
  console.log(`[Snapshot] Wrote ${filepath} (${sizeMB} MB)`);

  // 4. latest.json = default server snapshot; CJA comparison uses latest-portfolio-cja.json only
  if (!orgId) {
    if (usePortfolioCja) {
      const cjaLatest = join(SNAPSHOTS_DIR, 'latest-portfolio-cja.json');
      const cjaPayload = {
        file: filename,
        date: today,
        generatedAt: snapshot.generatedAt,
      };
      writeFileSync(cjaLatest, JSON.stringify(cjaPayload));
      console.log(`[Snapshot] Updated ${cjaLatest} (latest.json unchanged)`);
    } else {
      const latestPath = join(SNAPSHOTS_DIR, 'latest.json');
      const latestPayload = {
        file: filename,
        date: today,
        generatedAt: snapshot.generatedAt,
      };
      writeFileSync(latestPath, JSON.stringify(latestPayload));
      console.log(`[Snapshot] Updated ${latestPath}`);
    }
  }

  console.log('[Snapshot] Done!');
}

run().catch((err) => {
  console.error('[Snapshot] Fatal error:', err);
  process.exit(1);
});
