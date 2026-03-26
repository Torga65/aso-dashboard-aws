/**
 * Classify opportunities as ASO-only, LLMO-only, or both (ASO + LLMO).
 * Uses tags (isElmo, isASO) and type-based fallback for LLMO-only types.
 */

/** Opportunity types that are LLMO-only when no isElmo/isASO tags. */
const LLMO_ONLY_TYPES = new Set(['prerender', 'readability', 'summarization', 'llm-blocked']);

/**
 * @param {Object} opp - Opportunity with tags (string[]) and type (string)
 * @returns {boolean} True if this opportunity is LLMO-only (exclude when Include LLMO Data is off)
 */
export function isLlmoOnly(opp) {
  const tags = Array.isArray(opp.tags) ? opp.tags : [];
  const hasElmo = tags.includes('isElmo');
  const hasAso = tags.includes('isASO');
  const type = (opp.type || '').toLowerCase();

  if (hasElmo && hasAso) return false; // both: show in ASO view
  if (hasAso && !hasElmo) return false; // ASO only
  if (hasElmo && !hasAso) return true; // LLMO only
  // No tags: use type
  return LLMO_ONLY_TYPES.has(type);
}

/**
 * @param {Object} opp - Opportunity
 * @returns {boolean} True if opportunity should not have a clickable link (LLMO-only)
 */
export function isLlmoOnlyNoLink(opp) {
  return isLlmoOnly(opp);
}

/**
 * Exclude product-metatags type and Commerce-tagged opportunities from all views.
 * @param {Object} opp - Opportunity with type (string) and tags (string[])
 * @returns {boolean} True if this opportunity should be excluded
 */
export function isExcludedOpportunity(opp) {
  const type = (opp.type || '').toLowerCase();
  if (type === 'product-metatags') return true;
  const tags = Array.isArray(opp.tags) ? opp.tags : [];
  if (tags.includes('Commerce')) return true;
  return false;
}
