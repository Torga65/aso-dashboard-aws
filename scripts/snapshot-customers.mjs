#!/usr/bin/env node
/**
 * Customer snapshot script — fetches organizations and sites from SpaceCat,
 * filters to ASO-entitled orgs only, and writes public/server/data/snapshots/customers.json.
 *
 * Usage:
 *   node scripts/snapshot-customers.js --token <SPACECAT_API_TOKEN>
 *   SPACECAT_TOKEN=xxx node scripts/snapshot-customers.js
 *
 * Env: same as snapshot.mjs (repo-root .env.local — see scripts/load-snapshot-env.mjs).
 *
 * The dashboard uses this via GET /api/customers so the customer dropdown
 * shows ~100 ASO customers instead of 5000+.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSnapshotEnv } from './load-snapshot-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadSnapshotEnv();
const SNAPSHOTS_DIR = join(__dirname, '..', 'public', 'server', 'data', 'snapshots');
const CUSTOMERS_FILE = 'customers.json';

const SPACECAT_BASE = process.env.SPACECAT_API_BASE || 'https://spacecat.experiencecloud.live/api/v1';
const ENTITLEMENT_BATCH_SIZE = 10;
const ENTITLEMENT_BATCH_DELAY_MS = 100;
const ASO_PRODUCT_CODE = 'ASO';

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

function hasASOEntitlement(list) {
  return (list || []).some(
    (e) => (e.productCode || '').toUpperCase() === ASO_PRODUCT_CODE,
  );
}

async function fetchOrganizations(token) {
  console.log('[SnapshotCustomers] Fetching organizations...');
  const data = await spacecatGet(`${SPACECAT_BASE}/organizations`, token);
  const raw = data.organizations || data.data || [];
  const orgs = Array.isArray(data) ? data : raw;
  const mapped = orgs.map((org) => ({
    orgId: org.id,
    imsOrgId: org.imsOrgId || null,
    orgName: org.name || org.imsOrgId || 'Unknown',
  }));
  console.log(`[SnapshotCustomers] Found ${mapped.length} organizations`);
  return mapped;
}

async function fetchAllSitesGrouped(token) {
  console.log('[SnapshotCustomers] Fetching all sites...');
  const data = await spacecatGet(`${SPACECAT_BASE}/sites`, token);
  const raw = data.sites || data.data || [];
  const sites = Array.isArray(data) ? data : raw;
  const grouped = new Map();
  sites.forEach((site) => {
    const orgId = site.organizationId;
    if (!orgId) return;
    if (!grouped.has(orgId)) grouped.set(orgId, []);
    grouped.get(orgId).push({
      siteId: site.id,
      baseURL: site.baseURL || '',
      deliveryType: site.deliveryType || '',
      isLive: site.isLive ?? true,
    });
  });
  const totalSites = sites.length;
  console.log(`[SnapshotCustomers] Found ${totalSites} sites across ${grouped.size} orgs`);
  return grouped;
}

async function fetchEntitlements(orgId, token) {
  try {
    const data = await spacecatGet(`${SPACECAT_BASE}/organizations/${orgId}/entitlements`, token);
    const raw = Array.isArray(data) ? data : (data.entitlements || data.data || data.items || []);
    const list = Array.isArray(raw) ? raw : [];
    return list.map((e) => ({
      productCode: (e.productCode || e.product_code || '').toString().trim().toUpperCase(),
      tier: (e.tier || e.tierCode || '').toString().trim(),
    }));
  } catch {
    return [];
  }
}

function parseArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

async function run() {
  const token = parseArg('--token') || process.env.SPACECAT_TOKEN;
  if (!token) {
    console.error('Error: provide a token via --token <TOKEN> or SPACECAT_TOKEN env var');
    process.exit(1);
  }

  const startTime = Date.now();
  console.log('[SnapshotCustomers] Starting customer snapshot...');

  const [orgs, sitesMap] = await Promise.all([
    fetchOrganizations(token),
    fetchAllSitesGrouped(token),
  ]);

  const orgsWithSites = orgs.filter((org) => {
    const sites = sitesMap.get(org.orgId);
    return sites && sites.length > 0;
  });
  console.log(`[SnapshotCustomers] ${orgsWithSites.length} orgs have at least one site; checking ASO entitlement in batches of ${ENTITLEMENT_BATCH_SIZE}...`);

  const asoOrgs = [];
  const logEvery = Math.max(1, Math.floor(orgsWithSites.length / 20));
  for (let i = 0; i < orgsWithSites.length; i += ENTITLEMENT_BATCH_SIZE) {
    const batch = orgsWithSites.slice(i, i + ENTITLEMENT_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (org) => {
        const list = await fetchEntitlements(org.orgId, token);
        return { org, hasASO: hasASOEntitlement(list) };
      }),
    );
    for (const { org, hasASO } of results) {
      if (hasASO) {
        asoOrgs.push({
          orgId: org.orgId,
          orgName: org.orgName,
          imsOrgId: org.imsOrgId,
          sites: sitesMap.get(org.orgId),
        });
      }
    }
    const done = Math.min(i + ENTITLEMENT_BATCH_SIZE, orgsWithSites.length);
    if (done % logEvery < ENTITLEMENT_BATCH_SIZE || done === orgsWithSites.length) {
      const pct = ((done / orgsWithSites.length) * 100).toFixed(0);
      console.log(`[SnapshotCustomers] Checked ${done}/${orgsWithSites.length} orgs (${pct}%) — ${asoOrgs.length} ASO so far`);
    }
    if (i + ENTITLEMENT_BATCH_SIZE < orgsWithSites.length) {
      await new Promise((r) => { setTimeout(r, ENTITLEMENT_BATCH_DELAY_MS); });
    }
  }

  const siteCount = asoOrgs.reduce((sum, c) => sum + (c.sites?.length || 0), 0);
  const snapshot = {
    snapshotDate: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    customerCount: asoOrgs.length,
    siteCount,
    customers: asoOrgs,
  };

  if (!existsSync(SNAPSHOTS_DIR)) {
    mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }
  const filepath = join(SNAPSHOTS_DIR, CUSTOMERS_FILE);
  writeFileSync(filepath, JSON.stringify(snapshot));
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[SnapshotCustomers] Wrote ${filepath} (${asoOrgs.length} customers, ${siteCount} sites) in ${elapsed}s`);
  console.log('[SnapshotCustomers] Done!');
}

run().catch((err) => {
  console.error('[SnapshotCustomers] Fatal error:', err);
  process.exit(1);
});
