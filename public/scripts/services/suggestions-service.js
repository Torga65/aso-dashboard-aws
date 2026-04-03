/**
 * Suggestions Service
 *
 * Fetches opportunity and suggestion lifecycle data from the SpaceCat API
 * for a given site. Used by suggestions-manager.js as the data layer.
 */

import { ASO_ENDPOINTS, PAGINATION, SUGGESTION_STATUS, FIX_STATUS } from '../constants/api.js';
import { apiGet, isApiError, batchRequests } from './spacecat-api.js';

/**
 * Aggregate suggestion counts by status into the shape expected by
 * aggregateSuggestionsAcrossOpportunities() / calculateLifecycleMetrics() (same as EDS dashboard).
 *
 * @param {Array} suggestions
 * @returns {Object}
 */
export function aggregateSuggestionCounts(suggestions) {
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

  suggestions.forEach((suggestion) => {
    const status = suggestion.status || SUGGESTION_STATUS.NEW;
    switch (status) {
      case SUGGESTION_STATUS.FIXED:
        counts.fixedCount++;
        break;
      case SUGGESTION_STATUS.SKIPPED:
        counts.skippedCount++;
        break;
      case SUGGESTION_STATUS.REJECTED:
        counts.rejectedRawCount++;
        break;
      case SUGGESTION_STATUS.APPROVED:
        counts.approvedCount++;
        break;
      case SUGGESTION_STATUS.IN_PROGRESS:
        counts.inProgressCount++;
        break;
      case SUGGESTION_STATUS.PENDING_VALIDATION:
        counts.pendingValidationCount++;
        break;
      case SUGGESTION_STATUS.ERROR:
        counts.errorCount++;
        break;
      case SUGGESTION_STATUS.OUTDATED:
        counts.outdatedCount++;
        break;
      default:
        counts.newCount++;
    }
  });

  counts.pendingCount = counts.newCount
    + counts.approvedCount
    + counts.inProgressCount
    + counts.pendingValidationCount;
  counts.awaitingCustomerReviewCount = counts.newCount
    + counts.approvedCount
    + counts.inProgressCount;
  counts.terminalCount = counts.fixedCount
    + counts.skippedCount
    + counts.rejectedRawCount
    + counts.errorCount
    + counts.outdatedCount;

  return counts;
}

function aggregateFixCounts(fixes) {
  const counts = {
    pendingFixes: 0,
    inProgressFixes: 0,
    completedFixes: 0,
    failedFixes: 0,
    totalFixes: fixes.length,
  };

  fixes.forEach((fix) => {
    switch (fix.status) {
      case FIX_STATUS.COMPLETED:
        counts.completedFixes++;
        break;
      case FIX_STATUS.FAILED:
        counts.failedFixes++;
        break;
      case FIX_STATUS.IN_PROGRESS:
        counts.inProgressFixes++;
        break;
      case FIX_STATUS.PENDING:
      default:
        counts.pendingFixes++;
    }
  });

  return counts;
}

/**
 * Fetch all opportunities for a site.
 * @param {string} siteId
 * @param {string|null} token
 * @returns {Promise<Array>}
 */
async function fetchOpportunities(siteId, token) {
  const url = ASO_ENDPOINTS.SITE_OPPORTUNITIES(siteId);
  const response = await apiGet(url, token);

  if (isApiError(response)) {
    console.warn(`[SuggestionsService] Failed to fetch opportunities for site ${siteId}:`, response.message);
    return [];
  }

  const raw = Array.isArray(response) ? response : (response.opportunities || response.data || []);
  return Array.isArray(raw) ? raw : [];
}

/**
 * Fetch all suggestions for a single opportunity.
 * @param {string} siteId
 * @param {string} oppId
 * @param {string|null} token
 * @returns {Promise<Array>}
 */
async function fetchSuggestions(siteId, oppId, token) {
  const url = ASO_ENDPOINTS.OPPORTUNITY_SUGGESTIONS(siteId, oppId);
  const response = await apiGet(url, token);

  if (isApiError(response)) {
    console.warn(`[SuggestionsService] Failed to fetch suggestions for opp ${oppId}:`, response.message);
    return [];
  }

  const raw = Array.isArray(response) ? response : (response.suggestions || response.data || []);
  return Array.isArray(raw) ? raw : [];
}

/**
 * Fetch all fixes for a single opportunity.
 * @param {string} siteId
 * @param {string} oppId
 * @param {string|null} token
 * @returns {Promise<Array>}
 */
async function fetchFixes(siteId, oppId, token) {
  const url = ASO_ENDPOINTS.OPPORTUNITY_FIXES(siteId, oppId);
  const response = await apiGet(url, token);

  if (isApiError(response)) {
    // Fixes endpoint may not exist for all opportunity types — treat as empty
    return [];
  }

  const raw = Array.isArray(response) ? response : (response.fixes || response.data || []);
  return Array.isArray(raw) ? raw : [];
}

/**
 * Fetch full lifecycle data for a site: opportunities with their suggestions and fixes.
 *
 * @param {string} siteId - SpaceCat site ID
 * @param {string|null} token - Auth token
 * @returns {Promise<{ siteId: string, opportunities: Array }>}
 */
export async function getSiteLifecycleData(siteId, token = null) {
  const opportunities = await fetchOpportunities(siteId, token);

  if (!opportunities.length) {
    return { siteId, opportunities: [] };
  }

  // Fetch suggestions + fixes for each opportunity in parallel (batched)
  const enriched = await batchRequests(
    opportunities.map((opp) => async () => {
      const oppId = opp.id || opp.opportunityId;
      const [suggestions, fixes] = await Promise.all([
        fetchSuggestions(siteId, oppId, token),
        fetchFixes(siteId, oppId, token),
      ]);

      return {
        ...opp,
        suggestions,
        fixes,
        suggestionsCounts: aggregateSuggestionCounts(suggestions),
        fixesCounts: aggregateFixCounts(fixes),
      };
    }),
    PAGINATION.DEFAULT_PAGE_SIZE,
    0,
  );

  return { siteId, opportunities: enriched };
}
