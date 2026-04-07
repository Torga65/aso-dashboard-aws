/**
 * Customer Quick-Ref Service
 *
 * Fetches and caches org/site/audit/user data for the Customer History
 * quick-reference panel. Used by customer-history-quick-ref.js.
 */

import { ASO_ENDPOINTS, ASO_OPPORTUNITY_TYPES } from '../constants/api.js';
import { apiGet, isApiError } from './spacecat-api.js';
import { fetchSpaceCatOrgs, fetchOrgSites } from './org-site-service.js';

/** localStorage key for the quick-ref cache */
const CACHE_KEY = 'asoCustomerQuickRefCache';

/** Cache TTL: 24 hours — audits, pending validation, and user data change infrequently */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  Cache helpers                                                       */
/* ------------------------------------------------------------------ */

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota — ignore */ }
}

function getCacheEntry(key) {
  const cache = loadCache();
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
  return entry.data;
}

function setCacheEntry(key, data) {
  const cache = loadCache();
  cache[key] = { ts: Date.now(), data };
  saveCache(cache);
}

/**
 * Update only the audits array inside an existing cache entry.
 * Used when the user saves autofix settings without re-fetching everything.
 *
 * @param {string} customerName
 * @param {Array} audits
 */
export function updateQuickRefCacheAudits(customerName, audits) {
  const key = customerName.toLowerCase().trim();
  const cache = loadCache();
  if (cache[key]) {
    cache[key].data = { ...cache[key].data, audits };
    saveCache(cache);
  }
}

/* ------------------------------------------------------------------ */
/*  Org matching                                                        */
/* ------------------------------------------------------------------ */

/**
 * Look up a previously-saved SpaceCat org ID for a customer from the server DB.
 * Returns the orgId string, or null if not found.
 * @param {string} customerName
 * @returns {Promise<string|null>}
 */
async function getSavedOrgId(customerName) {
  try {
    const res = await fetch(`/api/org-mapping?company=${encodeURIComponent(customerName)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.spacecatOrgId || null;
  } catch {
    return null;
  }
}

/**
 * Try to find a SpaceCat org that matches customerName.
 * Resolution order: forcedOrgId → saved DB mapping → fuzzy name match.
 * Returns { org, allOrgs } where org may be null if no match found.
 */
async function resolveOrg(customerName, token, forcedOrgId = null) {
  const [allOrgs, savedOrgId] = await Promise.all([
    fetchSpaceCatOrgs(token),
    forcedOrgId ? Promise.resolve(null) : getSavedOrgId(customerName),
  ]);

  const resolveId = forcedOrgId || savedOrgId;
  if (resolveId) {
    const org = allOrgs.find((o) => o.orgId === resolveId) || null;
    return { org, allOrgs };
  }

  const needle = customerName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const org = allOrgs.find((o) => {
    const haystack = (o.orgName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return haystack.includes(needle) || needle.includes(haystack);
  }) || null;

  return { org, allOrgs };
}

/* ------------------------------------------------------------------ */
/*  Audits                                                              */
/* ------------------------------------------------------------------ */

/**
 * Fetch the real enabled/disabled audit state for a site from the global
 * SpaceCat configuration. SpaceCat does NOT store enabled/disabled on
 * individual opportunity records — it is in CONFIGURATIONS_LATEST under
 * handlers[auditType].disabled.{sites,orgs}.
 *
 * Returns { enabled: string[], disabled: string[] } or null on failure.
 */
async function fetchAuditStatusForSite(siteId, orgId, token) {
  try {
    if (!siteId || !token) return null;
    const url = ASO_ENDPOINTS.CONFIGURATIONS_LATEST?.();
    if (!url) return null;

    const response = await apiGet(url, token);
    if (isApiError(response) || !response || typeof response !== 'object') return null;

    const handlers = response.handlers ?? response.data?.handlers ?? {};
    if (!handlers || typeof handlers !== 'object') return null;

    const enabled = [];
    const disabled = [];

    Object.entries(handlers).forEach(([auditType, handler]) => {
      if (!handler || typeof handler !== 'object') return;

      // Use Array.isArray guards — the API may return non-array values (e.g. false)
      // which would cause .includes() to throw if we relied solely on ?? []
      const disabledSites = Array.isArray(handler.disabled?.sites) ? handler.disabled.sites : [];
      const disabledOrgs = Array.isArray(handler.disabled?.orgs) ? handler.disabled.orgs : [];
      const enabledSites = Array.isArray(handler.enabled?.sites) ? handler.enabled.sites : [];
      const enabledOrgs = Array.isArray(handler.enabled?.orgs) ? handler.enabled.orgs : [];
      const enabledByDefault = handler.enabledByDefault !== false;

      const isDisabled = disabledSites.includes(siteId)
        || (orgId && disabledOrgs.includes(orgId))
        || (!enabledByDefault
            && !enabledSites.includes(siteId)
            && !(orgId && enabledOrgs.includes(orgId)));

      if (isDisabled) disabled.push(auditType);
      else enabled.push(auditType);
    });

    return { enabled, disabled };
  } catch {
    return null;
  }
}

/**
 * Fetch opportunity audits for a site, shaped for the quick-ref panel.
 * Returns { audits, disabledAudits, pendingValidationOpps }.
 *
 * Enabled/disabled state comes from CONFIGURATIONS_LATEST (the global SpaceCat
 * config), NOT from opp.enabled which is not a real SpaceCat field.
 */
async function fetchAudits(siteId, orgId, token) {
  const [oppsResponse, auditStatus, latestAuditsResponse] = await Promise.all([
    apiGet(ASO_ENDPOINTS.SITE_OPPORTUNITIES(siteId), token),
    fetchAuditStatusForSite(siteId, orgId, token),
    apiGet(ASO_ENDPOINTS.SITE_AUDITS_LATEST(siteId), token),
  ]);

  if (isApiError(oppsResponse)) {
    return { audits: [], disabledAudits: [], pendingValidationOpps: { count: 0, types: [] } };
  }

  // Build a map of auditType → last run date string
  const latestAuditRaw = Array.isArray(latestAuditsResponse)
    ? latestAuditsResponse
    : (latestAuditsResponse?.audits || latestAuditsResponse?.data || []);
  const lastRunByType = {};
  if (Array.isArray(latestAuditRaw)) {
    latestAuditRaw.forEach((a) => {
      const type = a.auditType || a.type;
      const ran = a.auditedAt || a.runAt || a.createdAt;
      if (type && ran) {
        lastRunByType[type] = new Date(ran).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
    });
  }

  const raw = Array.isArray(oppsResponse)
    ? oppsResponse
    : (oppsResponse.opportunities || oppsResponse.data || []);
  // Filter to ASO opportunity types only — exclude LLMO and other products
  const opportunities = (Array.isArray(raw) ? raw : []).filter(
    (opp) => ASO_OPPORTUNITY_TYPES.includes(opp.type || opp.opportunityType || '')
  );

  const disabledSet = new Set(auditStatus?.disabled ?? []);

  const audits = [];
  const disabledAudits = [];
  const pendingTypes = [];

  await Promise.all(opportunities.map(async (opp) => {
    const auditType = opp.type || opp.opportunityType || 'unknown';
    const status = (opp.status || '').toUpperCase();
    const autoFix = opp.autoFix === true || opp.autoFix === 'Yes' ? 'Yes' : 'No';
    const lastRun = lastRunByType[auditType] || null;

    const row = {
      auditType,
      opportunity: auditType.replace(/-/g, ' '),
      lastRun: lastRun || '—',
      status,
      autoFix,
      opportunityId: opp.id,
    };

    if (disabledSet.has(auditType)) {
      disabledAudits.push(row);
    } else if (lastRun) {
      // Only show enabled audits that have actually been run
      audits.push(row);
    }

    // Count suggestions with PENDING_VALIDATION status for this opportunity
    if (opp.id) {
      const sugUrl = ASO_ENDPOINTS.OPPORTUNITY_SUGGESTIONS(siteId, opp.id);
      const suggestions = await apiGet(sugUrl, token);
      if (!isApiError(suggestions)) {
        const sugList = Array.isArray(suggestions)
          ? suggestions
          : (suggestions.suggestions || suggestions.data || []);
        const hasPending = sugList.some(
          (s) => (s.status || '').toUpperCase() === 'PENDING_VALIDATION',
        );
        if (hasPending) pendingTypes.push(auditType);
      }
    }
  }));

  return {
    audits,
    disabledAudits,
    pendingValidationOpps: { count: pendingTypes.length, types: pendingTypes },
  };
}

/* ------------------------------------------------------------------ */
/*  Users                                                               */
/* ------------------------------------------------------------------ */

/** Returns last-30-day date keys as 'YYYY-MM-DD' strings. */
function last30DayKeys() {
  const keys = [];
  const d = new Date();
  for (let i = 0; i < 30; i++) {
    keys.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() - 1);
  }
  return keys;
}

/**
 * Fetch users signed in to all sites for an org from SpaceCat.
 * Returns { users, loginCountByDay, usersByDay }.
 */
async function fetchUsers(orgId, token, sites) {
  const empty = { users: [], loginCountByDay: {}, usersByDay: {} };
  if (!orgId || !token || !sites?.length) return empty;

  const signInsByUser = new Map();
  const loginCountByDay = {};
  const bucketUserIds = {};
  last30DayKeys().forEach((k) => {
    loginCountByDay[k] = 0;
    bucketUserIds[k] = new Set();
  });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  for (const site of sites) {
    const sid = site.siteId || site.id;
    if (!sid) continue;
    const url = ASO_ENDPOINTS.SITE_USER_ACTIVITIES?.(sid);
    if (!url) continue;
    const activities = await apiGet(url, token);
    if (isApiError(activities) || !Array.isArray(activities)) continue;
    activities.forEach((a) => {
      const uid = a.trialUserId;
      const at = a.createdAt || a.updatedAt;
      const type = a.type || 'ACTIVITY';
      if (uid && at && type === 'SIGN_IN') {
        const prev = signInsByUser.get(uid);
        if (!prev || new Date(at) > new Date(prev)) signInsByUser.set(uid, at);
        const atDate = new Date(at);
        if (!Number.isNaN(atDate.getTime()) && atDate >= cutoff) {
          const dayKey = atDate.toISOString().slice(0, 10);
          if (loginCountByDay[dayKey] !== undefined) {
            loginCountByDay[dayKey] += 1;
            bucketUserIds[dayKey].add(uid);
          }
        }
      }
    });
  }

  const trialUsersUrl = ASO_ENDPOINTS.ORGANIZATION_TRIAL_USERS?.(orgId);
  let trialUsers = [];
  if (trialUsersUrl) {
    const res = await apiGet(trialUsersUrl, token);
    if (!isApiError(res) && Array.isArray(res)) trialUsers = res;
  }

  const idToName = new Map();
  trialUsers.forEach((tu) => {
    const name = [tu.firstName, tu.lastName].filter(Boolean).join(' ').trim()
      || tu.emailId || tu.email || tu.id || 'Unknown';
    idToName.set(tu.id, name);
  });

  const usersByDay = {};
  Object.keys(bucketUserIds).forEach((dayKey) => {
    usersByDay[dayKey] = [...bucketUserIds[dayKey]]
      .map((id) => idToName.get(id) || id || 'Unknown').sort();
  });

  const users = [];
  for (const tu of trialUsers) {
    const lastSignInAt = tu.id ? signInsByUser.get(tu.id) : null;
    if (!lastSignInAt) continue;
    users.push({
      emailId: tu.emailId || tu.email || '',
      firstName: tu.firstName || '',
      lastName: tu.lastName || '',
      lastSignInAt,
    });
  }
  users.sort((a, b) => new Date(b.lastSignInAt) - new Date(a.lastSignInAt));
  return { users, loginCountByDay, usersByDay };
}

/* ------------------------------------------------------------------ */
/*  Main export                                                         */
/* ------------------------------------------------------------------ */

/**
 * Fetch all quick-ref data for a customer.
 *
 * @param {string} customerName - Customer / org display name
 * @param {string|null} token   - Auth token
 * @param {Object} options
 * @param {string} [options.orgId] - Override org resolution with a known orgId
 * @param {boolean} [options.forceRefresh] - Bypass cache
 * @returns {Promise<{
 *   orgResolved: boolean,
 *   allOrgs: Array,
 *   audits: Array,
 *   disabledAudits: Array,
 *   pendingValidationOpps: { count: number, types: string[] },
 *   users: Array,
 *   loginCountByDay: Object,
 *   usersByDay: Object,
 *   sites: Array,
 *   siteId: string|null,
 *   baseURL: string,
 * }>}
 */
export async function getCustomerQuickRef(customerName, token = null, options = {}) {
  const { orgId: forcedOrgId = null, forceRefresh = false } = options;
  const cacheKey = `${customerName.toLowerCase().trim()}|${forcedOrgId || ''}`;

  if (!forceRefresh) {
    const cached = getCacheEntry(cacheKey);
    if (cached) return cached;
  }

  // 1. Resolve org
  const { org, allOrgs } = await resolveOrg(customerName, token, forcedOrgId);

  if (!org) {
    return {
      orgResolved: false,
      allOrgs,
      audits: [],
      disabledAudits: [],
      pendingValidationOpps: { count: 0, types: [] },
      users: [],
      loginCountByDay: {},
      usersByDay: {},
      sites: [],
      siteId: null,
      baseURL: '',
    };
  }

  // 2. Fetch sites for the org
  const sites = await fetchOrgSites(org.orgId, token);
  const primarySite = sites[0] || null;
  const siteId = primarySite?.siteId || null;
  const baseURL = primarySite?.baseURL || '';

  // 3. Fetch audits + users in parallel (only if we have a site)
  const [auditData, userData] = await Promise.all([
    siteId ? fetchAudits(siteId, org.orgId, token) : Promise.resolve({ audits: [], disabledAudits: [], pendingValidationOpps: { count: 0, types: [] } }),
    fetchUsers(org.orgId, token, sites),
  ]);

  const result = {
    orgResolved: true,
    allOrgs,
    ...auditData,
    ...userData,
    sites,
    siteId,
    baseURL,
  };

  setCacheEntry(cacheKey, result);
  return result;
}
