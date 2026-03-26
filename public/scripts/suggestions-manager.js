/**
 * Suggestions Manager
 *
 * State management and caching layer for ASO suggestion lifecycle data.
 * Follows the pattern from customer-data-manager.js for localStorage caching.
 *
 * This is the main entry point for UI components to access suggestion data.
 */

import { CACHE_CONFIG } from './constants/api.js';
import { getSiteLifecycleData } from './services/suggestions-service.js';
import { calculateLifecycleMetrics, getHealthLabel } from './utils/suggestions-health.js';

const { STORAGE_KEY, TTL_MS } = CACHE_CONFIG;

/** Max number of sites to keep in persistent cache */
const MAX_CACHED_SITES = 3;

/**
 * In-memory cache for current session (no size limit)
 */
let memoryCache = {};

/**
 * Load cached data from storage
 * @returns {Object} Cached data object
 */
export function loadCachedData() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      memoryCache = parsed;
      return parsed;
    }
  } catch (error) {
    console.error('Error loading cached suggestions data:', error);
  }
  return {};
}

/**
 * Save data to sessionStorage cache.
 * If quota is exceeded, evict the oldest entries and retry.
 * Falls back to memory-only cache if storage is completely full.
 * @param {Object} data - Data to cache
 * @returns {boolean} Success status
 */
export function saveCachedData(data) {
  memoryCache = data;
  try {
    // Prune to MAX_CACHED_SITES most-recent entries before writing
    const pruned = pruneCache(data, MAX_CACHED_SITES);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
    return true;
  } catch (error) {
    if (error.name === 'QuotaExceededError') {
      console.warn('Storage quota exceeded — evicting oldest cache entries');
      try {
        // Keep only the single most recent entry
        const minimal = pruneCache(data, 1);
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(minimal));
        return true;
      } catch {
        // Give up on persistent storage; memory cache still works
        console.warn('Could not persist cache — using memory only');
        sessionStorage.removeItem(STORAGE_KEY);
        return false;
      }
    }
    console.error('Error saving suggestions cache:', error);
    return false;
  }
}

/**
 * Keep only the N most recently fetched entries.
 */
function pruneCache(data, maxEntries) {
  const entries = Object.entries(data);
  if (entries.length <= maxEntries) return data;

  // Sort by lastFetched descending, keep the newest
  entries.sort((a, b) => {
    const ta = new Date(a[1]?.lastFetched || 0).getTime();
    const tb = new Date(b[1]?.lastFetched || 0).getTime();
    return tb - ta;
  });

  return Object.fromEntries(entries.slice(0, maxEntries));
}

/**
 * Check if a cache entry is still valid
 * @param {Object} cacheEntry - Cache entry with lastFetched timestamp
 * @returns {boolean} True if cache is still valid
 */
export function isCacheValid(cacheEntry) {
  if (!cacheEntry || !cacheEntry.lastFetched) return false;

  const lastFetched = new Date(cacheEntry.lastFetched).getTime();
  const now = Date.now();

  return (now - lastFetched) < TTL_MS;
}

/**
 * Get site data from cache
 * @param {string} siteId - Site ID
 * @returns {Object|null} Cached site data or null
 */
export function getCachedSiteData(siteId) {
  const cache = memoryCache[siteId] || loadCachedData()[siteId];

  if (cache && isCacheValid(cache)) {
    return cache;
  }

  return null;
}

/**
 * Update cache for a site
 * @param {string} siteId - Site ID
 * @param {Object} data - Site data to cache
 */
function updateSiteCache(siteId, data) {
  const cache = loadCachedData();
  cache[siteId] = {
    ...data,
    lastFetched: new Date().toISOString(),
  };
  saveCachedData(cache);
}

/**
 * Get suggestions lifecycle data for a site
 * Primary entry point for UI components
 *
 * @param {string} siteId - Site ID
 * @param {string|null} token - Auth token
 * @param {boolean} forceRefresh - Force fresh fetch ignoring cache
 * @returns {Promise<Object>} Lifecycle data with metrics
 */
export async function getSuggestionsForSite(siteId, token = null, forceRefresh = false) {
  // Check cache first
  if (!forceRefresh) {
    const cached = getCachedSiteData(siteId);
    if (cached) {
      return cached;
    }
  }

  // Fetch fresh data
  const lifecycleData = await getSiteLifecycleData(siteId, token);

  // Calculate metrics
  const metrics = calculateLifecycleMetrics(lifecycleData.opportunities);

  // Combine data and metrics
  const result = {
    ...lifecycleData,
    metrics,
    healthLabel: getHealthLabel(metrics.health.score),
  };

  // Update cache
  updateSiteCache(siteId, result);

  return result;
}

/**
 * Get only the metrics for a site (uses cache if available)
 * @param {string} siteId - Site ID
 * @returns {Object|null} Metrics object or null if not cached
 */
export function getSuggestionMetrics(siteId) {
  const cached = getCachedSiteData(siteId);
  return cached?.metrics || null;
}

/**
 * Generate a lifecycle report for a site
 * Returns a structured report suitable for display
 *
 * @param {string} siteId - Site ID
 * @param {string|null} token - Auth token
 * @returns {Promise<Object>} Formatted report object
 */
export async function getLifecycleReport(siteId, token = null) {
  const data = await getSuggestionsForSite(siteId, token);

  if (!data || !data.metrics) {
    return {
      error: true,
      message: 'Unable to generate report - no data available',
    };
  }

  const { metrics, opportunities } = data;

  return {
    siteId,
    generatedAt: new Date().toISOString(),
    summary: {
      healthScore: metrics.health.score,
      healthLabel: getHealthLabel(metrics.health.score),
      totalOpportunities: metrics.opportunities.total,
      totalSuggestions: metrics.suggestions.total,
    },
    suggestions: {
      fixed: metrics.suggestions.fixedCount,
      pending: metrics.suggestions.pendingCount,
      skipped: metrics.suggestions.skippedCount,
      rejected: metrics.suggestions.rejectedRawCount,
      error: metrics.suggestions.errorCount,
      outdated: metrics.suggestions.outdatedCount,
      terminal: metrics.suggestions.terminalCount,
      resolutionRate: metrics.suggestions.resolutionRate,
      skipRate: metrics.suggestions.skipRate,
      rejectedRate: metrics.suggestions.rejectedRate,
      outdatedRate: metrics.suggestions.outdatedRate,
      avgTimeToFixDays: metrics.lifecycle.avgTimeToFix,
    },
    fixes: metrics.fixes,
    opportunities: {
      new: metrics.opportunities.byStatus.new,
      inProgress: metrics.opportunities.byStatus.inProgress,
      resolved: metrics.opportunities.byStatus.resolved,
      ignored: metrics.opportunities.byStatus.ignored,
    },
    aging: {
      fresh: metrics.opportunities.byAge.fresh,
      acceptable: metrics.opportunities.byAge.acceptable,
      warning: metrics.opportunities.byAge.warning,
      overdue: metrics.opportunities.byAge.overdue,
      critical: metrics.opportunities.byAge.critical,
      totalAging: metrics.opportunities.byAge.aging,
    },
    healthBreakdown: metrics.health.achievements,
    // Include raw opportunities for detailed views
    opportunitiesDetail: opportunities.map((opp) => ({
      id: opp.id,
      type: opp.type,
      status: opp.status,
      createdAt: opp.createdAt,
      suggestionsCount: opp.suggestionsCounts?.totalCount || 0,
      fixedCount: opp.suggestionsCounts?.fixedCount || 0,
    })),
  };
}

/**
 * Get data for multiple sites
 * @param {Array<string>} siteIds - Array of site IDs
 * @param {string|null} token - Auth token
 * @returns {Promise<Map>} Map of siteId -> lifecycle data
 */
export async function getSuggestionsForSites(siteIds, token = null) {
  const results = new Map();

  // Fetch all sites in parallel
  const promises = siteIds.map(async (siteId) => {
    const data = await getSuggestionsForSite(siteId, token);
    return { siteId, data };
  });

  const responses = await Promise.all(promises);

  responses.forEach(({ siteId, data }) => {
    results.set(siteId, data);
  });

  return results;
}

/**
 * Clear all cached data
 */
export function clearCache() {
  memoryCache = {};
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    // Also clean up legacy localStorage entry if present
    localStorage.removeItem(STORAGE_KEY);
    console.log('Suggestions cache cleared');
  } catch (error) {
    console.error('Error clearing suggestions cache:', error);
  }
}

/**
 * Clear cache for a specific site
 * @param {string} siteId - Site ID
 */
export function clearSiteCache(siteId) {
  const cache = loadCachedData();
  if (cache[siteId]) {
    delete cache[siteId];
    saveCachedData(cache);
    console.log(`Cache cleared for site ${siteId}`);
  }
}

/**
 * Get cache statistics
 * @returns {Object} Cache stats
 */
export function getCacheStats() {
  const cache = loadCachedData();
  const siteIds = Object.keys(cache);

  let validCount = 0;
  let expiredCount = 0;

  siteIds.forEach((siteId) => {
    if (isCacheValid(cache[siteId])) {
      validCount++;
    } else {
      expiredCount++;
    }
  });

  return {
    totalSites: siteIds.length,
    validEntries: validCount,
    expiredEntries: expiredCount,
    cacheSize: JSON.stringify(cache).length,
    ttlMinutes: Math.round(TTL_MS / 60000),
  };
}

/**
 * Initialize manager (load cache on startup)
 */
export function initialize() {
  // Migrate away from localStorage (which was hitting quota)
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
  loadCachedData();
  console.log('Suggestions manager initialized');
}

// Auto-initialize when module loads
initialize();
