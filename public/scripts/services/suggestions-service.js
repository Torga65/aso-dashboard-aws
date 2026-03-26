/**
 * Suggestions Service
 *
 * Fetches opportunity and suggestion lifecycle data from the SpaceCat API
 * for a given site. Used by suggestions-manager.js as the data layer.
 */

import { ASO_ENDPOINTS, PAGINATION } from '../constants/api.js';
import { apiGet, isApiError, batchRequests } from './spacecat-api.js';

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

      // Build suggestionsCounts summary
      const countByStatus = suggestions.reduce((acc, s) => {
        const status = s.status || 'UNKNOWN';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});

      return {
        ...opp,
        suggestions,
        fixes,
        suggestionsCounts: {
          totalCount: suggestions.length,
          fixedCount: countByStatus.FIXED || 0,
          ...countByStatus,
        },
      };
    }),
    PAGINATION.DEFAULT_PAGE_SIZE,
    0,
  );

  return { siteId, opportunities: enriched };
}
