/**
 * Client-side portfolio snapshot reader and aggregator.
 *
 * Fetches snapshot JSON directly from the repo (served by EDS as static files)
 * and runs aggregation in the browser — no Express backend required.
 *
 * Response shape matches the Express route GET /api/portfolio/opportunity-metrics
 * so the existing renderPortfolioDashboard() works unchanged.
 */

const SNAPSHOTS_BASE = '/server/data/snapshots';

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

const snapshotCache = {};

async function loadSnapshot(variant = 'aso') {
  if (snapshotCache[variant]) return snapshotCache[variant];
  const pointer = variant === 'cja'
    ? `${SNAPSHOTS_BASE}/latest-portfolio-cja.json`
    : `${SNAPSHOTS_BASE}/latest.json`;
  const latest = await fetchJSON(pointer);
  const data = await fetchJSON(`${SNAPSHOTS_BASE}/${latest.file}`);
  snapshotCache[variant] = data;
  return data;
}

// ---- Filtering (mirrors server/src/routes/portfolio.js) ----

const LLMO_ONLY_TYPES = new Set(['prerender', 'readability', 'summarization', 'llm-blocked']);

function isLlmoOnly(opp) {
  const tags = Array.isArray(opp.tags) ? opp.tags : [];
  const hasElmo = tags.includes('isElmo');
  const hasAso = tags.includes('isASO');
  if (hasElmo && hasAso) return false;
  if (hasAso && !hasElmo) return false;
  if (hasElmo && !hasAso) return true;
  return LLMO_ONLY_TYPES.has((opp.type || '').toLowerCase());
}

function isExcluded(opp) {
  if ((opp.type || '').toLowerCase() === 'product-metatags') return true;
  const tags = Array.isArray(opp.tags) ? opp.tags : [];
  return tags.includes('Commerce');
}

// ---- Aggregation (mirrors server/src/aggregation.js — pure functions) ----

const OPEN_STATUSES = new Set(['NEW', 'IN_PROGRESS']);
const AWAITING_CUSTOMER = new Set(['NEW', 'APPROVED', 'IN_PROGRESS']);

function aggregateOpportunities(opportunities, from, to, siteIdToBaseUrl = {}) {
  const createdDayMap = new Map();
  const totalCounts = {};
  let totalAvailable = 0;
  let createdInPeriod = 0;
  let fixedInPeriod = 0;
  let outdatedInPeriod = 0;
  const statusChangeDayMap = new Map();
  const inScopeIndices = new Set();
  const rejectedTypeMap = new Map();
  const fixedSiteMap = new Map();

  for (let i = 0; i < opportunities.length; i++) {
    const opp = opportunities[i];
    if (opp.createdAt && opp.status) {
      const createdDate = opp.createdAt.slice(0, 10);
      const updatedDate = opp.updatedAt ? opp.updatedAt.slice(0, 10) : null;
      const { status } = opp;

      const isCreated = createdDate >= from && createdDate <= to;
      if (isCreated) {
        if (!createdDayMap.has(createdDate)) createdDayMap.set(createdDate, {});
        const dc = createdDayMap.get(createdDate);
        dc[status] = (dc[status] || 0) + 1;
        totalCounts[status] = (totalCounts[status] || 0) + 1;
        createdInPeriod++;
        totalAvailable++;
        inScopeIndices.add(i);
      } else if (createdDate < from) {
        if (OPEN_STATUSES.has(status) || (updatedDate && updatedDate >= from)) {
          totalAvailable++;
          inScopeIndices.add(i);
        }
      }

      if (status === 'RESOLVED' && updatedDate && updatedDate >= from && updatedDate <= to) {
        fixedInPeriod++;
        if (!statusChangeDayMap.has(updatedDate)) statusChangeDayMap.set(updatedDate, {});
        const scDay = statusChangeDayMap.get(updatedDate);
        scDay.RESOLVED = (scDay.RESOLVED || 0) + 1;
      }
      if (status === 'IGNORED' && updatedDate && updatedDate >= from && updatedDate <= to) {
        outdatedInPeriod++;
        if (!statusChangeDayMap.has(updatedDate)) statusChangeDayMap.set(updatedDate, {});
        const igDay = statusChangeDayMap.get(updatedDate);
        igDay.IGNORED = (igDay.IGNORED || 0) + 1;
      }
    }
  }

  let skippedByCustomer = 0;
  let rejectedByEse = 0;
  let pendingValidation = 0;
  let awaitingCustomerReview = 0;
  let suggestionsFixed = 0;
  let totalSuggestions = 0;
  let movedToFixed = 0;
  let movedToAwaitingCustomerReview = 0;
  let movedToAwaitingEseReview = 0;
  let movedToSkipped = 0;
  let movedToRejected = 0;
  let movedToOutdated = 0;
  let movedToError = 0;
  let suggestionsCreatedInPeriod = 0;

  for (let i = 0; i < opportunities.length; i++) {
    if (inScopeIndices.has(i)) {
      const opp = opportunities[i];
      const sc = opp.suggestionCounts;
      if (sc) {
        skippedByCustomer += sc.skippedCount ?? 0;
        rejectedByEse += sc.rejectedRawCount ?? 0;
        pendingValidation += sc.pendingValidationCount ?? 0;
        const newC = sc.newCount ?? 0;
        const appr = sc.approvedCount ?? 0;
        const inProg = sc.inProgressCount ?? 0;
        awaitingCustomerReview += newC + appr + inProg;
        suggestionsFixed += sc.fixedCount ?? 0;
        totalSuggestions += sc.totalCount ?? 0;
      }
      const states = opp.suggestionStates;
      if (Array.isArray(states)) {
        for (let j = 0; j < states.length; j++) {
          const { s: sugStatus, u: upd, c: created } = states[j];
          if (created && created >= from && created <= to) {
            suggestionsCreatedInPeriod++;
          }
          const inRange = (upd && upd >= from && upd <= to)
            || (!upd && created && created >= from && created <= to);
          if (inRange) {
            if (sugStatus === 'FIXED') {
              movedToFixed++;
              const sid = opp.siteId;
              if (sid) {
                if (!fixedSiteMap.has(sid)) fixedSiteMap.set(sid, { count: 0, types: new Set() });
                const entry = fixedSiteMap.get(sid);
                entry.count++;
                if (opp.type) entry.types.add(opp.type);
              }
            } else if (sugStatus === 'SKIPPED') {
              movedToSkipped++;
            } else if (sugStatus === 'REJECTED') {
              movedToRejected++;
              const t = opp.type || 'unknown';
              rejectedTypeMap.set(t, (rejectedTypeMap.get(t) || 0) + 1);
            } else if (sugStatus === 'PENDING_VALIDATION') {
              movedToAwaitingEseReview++;
            } else if (sugStatus === 'OUTDATED') {
              movedToOutdated++;
            } else if (sugStatus === 'ERROR') {
              movedToError++;
            } else if (AWAITING_CUSTOMER.has(sugStatus)) {
              movedToAwaitingCustomerReview++;
            }
          }
        }
      }
    }
  }

  const movedToCustomerEngagement = movedToSkipped + movedToFixed;
  const customerEngagement = skippedByCustomer + suggestionsFixed;
  const totalCreatedOrUpdatedInPeriod = movedToFixed + movedToAwaitingCustomerReview
    + movedToAwaitingEseReview + movedToSkipped + movedToRejected + movedToOutdated + movedToError;

  const buckets = Array.from(createdDayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, counts }));
  const statusChangeBuckets = Array.from(statusChangeDayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, counts }));

  const topRejectedTypes = Array.from(rejectedTypeMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, count]) => ({ type, count }));

  const topDeployingCustomers = Array.from(fixedSiteMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3)
    .map(([siteId, { count, types }]) => ({
      siteId,
      domain: siteIdToBaseUrl[siteId] || siteId,
      count,
      types: Array.from(types),
    }));

  return {
    buckets,
    totalCounts,
    topRejectedTypes,
    topDeployingCustomers,
    summary: {
      totalAvailable,
      createdInPeriod,
      fixedInPeriod,
      outdatedInPeriod,
      skippedByCustomer,
      rejectedByEse,
      pendingValidation,
      awaitingCustomerReview,
      suggestionsFixed,
      totalSuggestions,
      suggestionsCreatedInPeriod,
      customerEngagement,
      movedToFixed,
      movedToAwaitingCustomerReview,
      movedToAwaitingEseReview,
      movedToSkipped,
      movedToRejected,
      movedToOutdated,
      movedToError,
      movedToCustomerEngagement,
      totalCreatedOrUpdatedInPeriod,
    },
    statusChangeBuckets,
  };
}

// ---- Public API ----

/**
 * Fetch snapshot data and run aggregation client-side.
 * Returns the same shape as GET /api/portfolio/opportunity-metrics.
 */
export async function getPortfolioMetrics({
  siteIds, from, to, portfolioVariant, includeLlmo, includeGeneric,
}) {
  const variant = portfolioVariant === 'cja' ? 'cja' : 'aso';
  const snapshot = await loadSnapshot(variant);

  const siteIdSet = siteIds ? new Set(siteIds) : null;
  let opps = siteIdSet
    ? snapshot.opportunities.filter((o) => siteIdSet.has(o.siteId))
    : snapshot.opportunities;

  opps = opps.filter((o) => !isExcluded(o));
  if (!includeLlmo) opps = opps.filter((o) => !isLlmoOnly(o));
  if (!includeGeneric) opps = opps.filter((o) => (o.type || '').toLowerCase() !== 'generic-opportunity');

  // Build siteId → baseURL from customers snapshot for top-deployers display
  const siteIdToBaseUrl = {};
  try {
    const customersData = await fetchJSON(`${SNAPSHOTS_BASE}/customers.json`);
    for (const customer of customersData.customers || []) {
      for (const site of customer.sites || []) {
        if (site.siteId && site.baseURL) siteIdToBaseUrl[site.siteId] = site.baseURL;
      }
    }
  } catch (e) { /* non-fatal — domain falls back to siteId */ }

  const result = aggregateOpportunities(opps, from, to, siteIdToBaseUrl);
  result.siteCount = siteIds ? siteIds.length : snapshot.siteCount;
  result.snapshotDate = snapshot.snapshotDate;
  result.source = 'snapshot';
  return result;
}

/**
 * Fetch the customers snapshot directly (same shape as GET /api/customers).
 */
export async function getCustomersSnapshot() {
  const data = await fetchJSON(`${SNAPSHOTS_BASE}/customers.json`);
  return data;
}
