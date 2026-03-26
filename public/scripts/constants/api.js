/**
 * SpaceCat API Constants for ASO Suggestion Lifecycle
 *
 * Defines endpoints and status constants for interacting with the SpaceCat API
 * to track ASO suggestions, opportunities, and fixes.
 */

// Base API URL — proxied through Next.js backend to avoid CORS and keep tokens server-side
export const SPACECAT_API_BASE = '/api/spacecat';

/**
 * ASO-specific SpaceCat API endpoints
 */
export const ASO_ENDPOINTS = {
  // Organizations
  ORGANIZATIONS: () => `${SPACECAT_API_BASE}/organizations`,
  ORGANIZATION: (orgId) => `${SPACECAT_API_BASE}/organizations/${orgId}`,
  ORGANIZATION_SITES: (orgId) => `${SPACECAT_API_BASE}/organizations/${orgId}/sites`,
  ORGANIZATION_ENTITLEMENTS: (orgId) => `${SPACECAT_API_BASE}/organizations/${orgId}/entitlements`,

  // Sites
  SITES: () => `${SPACECAT_API_BASE}/sites`,
  SITE: (siteId) => `${SPACECAT_API_BASE}/sites/${siteId}`,

  // Opportunities (per site)
  SITE_OPPORTUNITIES: (siteId) => `${SPACECAT_API_BASE}/sites/${siteId}/opportunities`,
  OPPORTUNITY: (siteId, oppId) => `${SPACECAT_API_BASE}/sites/${siteId}/opportunities/${oppId}`,

  // Suggestions (per opportunity)
  OPPORTUNITY_SUGGESTIONS: (siteId, oppId) => `${SPACECAT_API_BASE}/sites/${siteId}/opportunities/${oppId}/suggestions`,
  SUGGESTION: (siteId, oppId, sugId) => `${SPACECAT_API_BASE}/sites/${siteId}/opportunities/${oppId}/suggestions/${sugId}`,

  // Fixes (per opportunity)
  OPPORTUNITY_FIXES: (siteId, oppId) => `${SPACECAT_API_BASE}/sites/${siteId}/opportunities/${oppId}/fixes`,
  FIX: (siteId, oppId, fixId) => `${SPACECAT_API_BASE}/sites/${siteId}/opportunities/${oppId}/fixes/${fixId}`,
};

/**
 * Suggestion status values
 * Per SpaceCat API: GET /sites/{siteId}/opportunities/{oppId}/suggestions
 * Full enum: "NEW" | "APPROVED" | "SKIPPED" | "FIXED" | "ERROR" |
 *            "IN_PROGRESS" | "OUTDATED" | "PENDING_VALIDATION" | "REJECTED"
 */
export const SUGGESTION_STATUS = {
  NEW: 'NEW', // Newly created, not yet triaged
  APPROVED: 'APPROVED', // Accepted by customer, awaiting fix
  IN_PROGRESS: 'IN_PROGRESS', // Fix is underway
  PENDING_VALIDATION: 'PENDING_VALIDATION', // Fix applied, awaiting confirmation
  FIXED: 'FIXED', // Fix deployed and confirmed
  SKIPPED: 'SKIPPED', // Customer chose not to act (by customer). UI: "Skipped"
  REJECTED: 'REJECTED', // ESE false positive (by ESE). UI: "Rejected"
  ERROR: 'ERROR', // Autofix attempt failed
  OUTDATED: 'OUTDATED', // No longer relevant
};

/**
 * Opportunity status values
 * Per SpaceCat API: PATCH /sites/{siteId}/opportunities/{oppId}
 * Enum: "NEW" | "IN_PROGRESS" | "IGNORED" | "RESOLVED"
 */
export const OPPORTUNITY_STATUS = {
  NEW: 'NEW',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  IGNORED: 'IGNORED',
};

/**
 * Fix status values
 * Based on SpaceCat API opportunity-fixes schema
 */
export const FIX_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
};

/**
 * ASO opportunity types
 * These filter which opportunities are relevant for ASO tracking
 */
export const ASO_OPPORTUNITY_TYPES = [
  'broken-backlinks',
  'canonical',
  'structured-data',
  'meta-tags',
  'alt-text',
  'internal-linking',
];

/**
 * Default pagination settings
 */
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 100,
  MAX_PAGE_SIZE: 500,
};

/**
 * Cache configuration
 */
export const CACHE_CONFIG = {
  TTL_MS: 5 * 60 * 1000, // 5 minutes
  STORAGE_KEY: 'asoSuggestionsCache',
};

/**
 * Portfolio backend (aggregation server).
 * TODO: Replace with production URL when deployed (e.g. Amplify, App Runner, etc.)
 */
export const PORTFOLIO_API_BASE = 'http://localhost:3001';
export const PORTFOLIO_ENDPOINTS = {
  OPPORTUNITY_METRICS: () => `${PORTFOLIO_API_BASE}/api/portfolio/opportunity-metrics`,
  CUSTOMERS: () => `${PORTFOLIO_API_BASE}/api/customers`,
};
