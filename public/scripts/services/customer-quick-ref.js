/**
 * Customer Quick-Ref Service
 *
 * Fetches and caches org/site/audit/user data for the Customer History
 * quick-reference panel. Used by customer-history-quick-ref.js.
 */

import { ASO_ENDPOINTS } from '../constants/api.js';
import { apiGet, isApiError } from './spacecat-api.js';
import { fetchSpaceCatOrgs, fetchOrgSites } from './org-site-service.js';

/** sessionStorage key for the quick-ref cache */
const CACHE_KEY = 'asoCustomerQuickRefCache';

/** Cache TTL: 10 minutes */
const CACHE_TTL_MS = 10 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  Cache helpers                                                       */
/* ------------------------------------------------------------------ */

function loadCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
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
 * Fetch opportunity audits for a site, shaped for the quick-ref panel.
 * Returns { audits, disabledAudits, pendingValidationOpps }.
 */
async function fetchAudits(siteId, token) {
  const url = ASO_ENDPOINTS.SITE_OPPORTUNITIES(siteId);
  const response = await apiGet(url, token);

  if (isApiError(response)) {
    return { audits: [], disabledAudits: [], pendingValidationOpps: { count: 0, types: [] } };
  }

  const raw = Array.isArray(response) ? response : (response.opportunities || response.data || []);
  const opportunities = Array.isArray(raw) ? raw : [];

  const audits = [];
  const disabledAudits = [];
  const pendingTypes = [];

  opportunities.forEach((opp) => {
    const auditType = opp.type || opp.opportunityType || 'unknown';
    const status = (opp.status || '').toUpperCase();
    const isEnabled = opp.enabled !== false;
    const autoFix = opp.autoFix === true || opp.autoFix === 'Yes' ? 'Yes' : 'No';

    const row = {
      auditType,
      status,
      autoFix,
      opportunityId: opp.id,
    };

    if (!isEnabled) {
      disabledAudits.push(row);
    } else {
      audits.push(row);
    }

    if (status === 'PENDING_VALIDATION') {
      pendingTypes.push(auditType);
    }
  });

  return {
    audits,
    disabledAudits,
    pendingValidationOpps: { count: pendingTypes.length, types: pendingTypes },
  };
}

/* ------------------------------------------------------------------ */
/*  Users                                                               */
/* ------------------------------------------------------------------ */

/**
 * Fetch users signed in to a site from SpaceCat.
 * Returns { users, loginCountByDay, usersByDay }.
 */
async function fetchUsers(siteId, token) {
  // SpaceCat doesn't have a dedicated users endpoint exposed in ASO_ENDPOINTS yet;
  // attempt a generic path and fall back gracefully.
  try {
    const url = `${ASO_ENDPOINTS.SITE(siteId)}/users`;
    const response = await apiGet(url, token);

    if (isApiError(response)) {
      return { users: [], loginCountByDay: {}, usersByDay: {} };
    }

    const raw = Array.isArray(response) ? response : (response.users || response.data || []);
    const users = Array.isArray(raw) ? raw : [];

    // Build day-indexed maps for the quick-ref sparkline / table
    const loginCountByDay = {};
    const usersByDay = {};

    users.forEach((u) => {
      const day = (u.lastLoginDate || u.date || '').slice(0, 10);
      if (day) {
        loginCountByDay[day] = (loginCountByDay[day] || 0) + 1;
        if (!usersByDay[day]) usersByDay[day] = [];
        usersByDay[day].push(u);
      }
    });

    return { users, loginCountByDay, usersByDay };
  } catch {
    return { users: [], loginCountByDay: {}, usersByDay: {} };
  }
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
    siteId ? fetchAudits(siteId, token) : Promise.resolve({ audits: [], disabledAudits: [], pendingValidationOpps: { count: 0, types: [] } }),
    siteId ? fetchUsers(siteId, token) : Promise.resolve({ users: [], loginCountByDay: {}, usersByDay: {} }),
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
