/**
 * Organization & Site Discovery Service
 *
 * Discovers organizations and sites from SpaceCat.
 * ASO entitlement helpers exist for on-demand checks; bulk filtering
 * is not done at load to avoid N API calls.
 */

import { ASO_ENDPOINTS } from '../constants/api.js';
import { apiGet, isApiError } from './spacecat-api.js';

const ASO_PRODUCT_CODE = 'ASO';
const TIER_PAID = 'PAID';

/**
 * Fetch entitlements for an organization (Spacecat tier model).
 *
 * @param {string} orgId - SpaceCat organization ID
 * @param {string} token
 * @returns {Promise<{ ok: boolean, list: Array<{productCode, tier}> }>}
 *   ok: false on API error (do not treat as "no ASO"); ok: true when response was successful.
 */
export async function fetchOrganizationEntitlements(orgId, token) {
  const url = ASO_ENDPOINTS.ORGANIZATION_ENTITLEMENTS(orgId);
  const response = await apiGet(url, token);

  if (isApiError(response)) {
    return { ok: false, list: [] };
  }

  const raw = Array.isArray(response)
    ? response
    : (response.entitlements || response.data || response.items || []);
  const list = Array.isArray(raw) ? raw : [];
  const normalized = list.map((e) => {
    const code = (e.productCode || e.product_code || '').toString().trim();
    const tier = (e.tier || e.tierCode || '').toString().toUpperCase().trim();
    return { productCode: code, tier };
  });
  return { ok: true, list: normalized };
}

/**
 * True if org has any ASO entitlement (Sites Optimizer).
 *
 * @param {Array<{productCode, tier}>} entitlements
 * @returns {boolean}
 */
export function hasASOEntitlement(entitlements) {
  return (entitlements || []).some(
    (e) => (e.productCode || '').toUpperCase() === ASO_PRODUCT_CODE,
  );
}

/**
 * True if org has ASO with PAID tier.
 *
 * @param {Array<{productCode, tier}>} entitlements
 * @returns {boolean}
 */
export function hasPaidASOEntitlement(entitlements) {
  return (entitlements || []).some(
    (e) => (e.productCode || '').toUpperCase() === ASO_PRODUCT_CODE
      && (e.tier || '') === TIER_PAID,
  );
}

/**
 * Fetch all SpaceCat organizations.
 *
 * @param {string} token
 * @returns {Promise<Array<{orgId, orgName, imsOrgId}>>}
 */
export async function fetchSpaceCatOrgs(token) {
  try {
    const url = ASO_ENDPOINTS.ORGANIZATIONS();
    const response = await apiGet(url, token);

    if (isApiError(response)) {
      console.warn('[OrgSite] Failed to fetch SpaceCat orgs:', response.message);
      return [];
    }

    const raw = response.organizations || response.data || [];
    const orgs = Array.isArray(response) ? response : raw;
    return orgs.map((org) => ({
      orgId: org.id,
      imsOrgId: org.imsOrgId || null,
      orgName: org.name || org.imsOrgId || 'Unknown',
    }));
  } catch (err) {
    console.error('[OrgSite] SpaceCat orgs call failed:', err.message);
    return [];
  }
}

/**
 * Fetch sites for a specific organization.
 *
 * @param {string} orgId - SpaceCat organization ID
 * @param {string} token
 * @returns {Promise<Array<{siteId: string, baseURL: string, deliveryType: string}>>}
 */
export async function fetchOrgSites(orgId, token) {
  const url = ASO_ENDPOINTS.ORGANIZATION_SITES(orgId);
  const response = await apiGet(url, token);

  if (isApiError(response)) {
    console.warn(`[OrgSite] Failed to fetch sites for org ${orgId}:`, response.message);
    return [];
  }

  const sites = Array.isArray(response) ? response : (response.sites || response.data || []);
  return sites.map((site) => ({
    siteId: site.id,
    baseURL: site.baseURL || '',
    deliveryType: site.deliveryType || '',
    isLive: site.isLive ?? true,
  }));
}

/**
 * Look up a single site by ID. Returns site details including its organizationId.
 *
 * @param {string} siteId
 * @param {string} token
 * @returns {Promise<{siteId, baseURL, organizationId, orgName}|null>}
 */
export async function fetchSiteById(siteId, token) {
  const url = ASO_ENDPOINTS.SITE(siteId);
  const response = await apiGet(url, token);

  if (isApiError(response)) {
    console.warn(`[OrgSite] Failed to fetch site ${siteId}:`, response.message);
    return null;
  }

  return {
    siteId: response.id || siteId,
    baseURL: response.baseURL || '',
    organizationId: response.organizationId || null,
    deliveryType: response.deliveryType || '',
    isLive: response.isLive ?? true,
  };
}

/**
 * Fetch ALL sites and group them by organizationId.
 * Returns a Map<orgId, site[]> so we can pre-populate orgs and filter empties.
 *
 * @param {string} token
 * @returns {Promise<Map<string, Array>|null>} null if the call fails
 */
async function fetchAllSitesGrouped(token) {
  try {
    const url = ASO_ENDPOINTS.SITES();
    const response = await apiGet(url, token);

    if (isApiError(response)) {
      console.warn('[OrgSite] Failed to fetch sites list:', response.message);
      return null;
    }

    const raw2 = response.sites || response.data || [];
    const sites = Array.isArray(response) ? response : raw2;
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
    return grouped;
  } catch (err) {
    console.warn('[OrgSite] Sites list call failed:', err.message);
    return null;
  }
}

/**
 * Build a customer list with pre-populated sites.
 * Fetches /organizations and /sites in parallel; returns only orgs that have at least one site.
 *
 * ASO filtering is not applied here to avoid N entitlement requests (one per org).
 * Use fetchOrganizationEntitlements + hasASOEntitlement/hasPaidASOEntitlement for
 * on-demand checks (e.g. when user selects an org) or when a bulk/filtered API exists.
 *
 * @param {string} token - SpaceCat API key or IMS access token
 * @returns {Promise<Array<{orgId, orgName, imsOrgId, sites: Array}>>}
 */
export async function buildCustomerSiteTree(token) {
  const [spacecatOrgs, sitesMap] = await Promise.all([
    fetchSpaceCatOrgs(token),
    fetchAllSitesGrouped(token),
  ]);

  if (sitesMap) {
    return spacecatOrgs
      .filter((sc) => {
        const sites = sitesMap.get(sc.orgId);
        return sites && sites.length > 0;
      })
      .map((sc) => ({ ...sc, sites: sitesMap.get(sc.orgId) }));
  }

  return spacecatOrgs.map((sc) => ({ ...sc, sites: [] }));
}
