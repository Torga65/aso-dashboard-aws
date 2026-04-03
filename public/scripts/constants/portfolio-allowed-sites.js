/**
 * Portfolio view site lists (separate modes).
 * - ASO (default): sites your team tracks.
 * - CJA: Ankit’s CJA dashboard scope — use for apples-to-apples comparison.
 * @see aso-portfolio-orgs.js, cja-dashboard-sites.js
 */
import { ASO_PORTFOLIO_SITES } from './aso-portfolio-orgs.js';
import { CJA_DASHBOARD_SITES } from './cja-dashboard-sites.js';

/** @typedef {'aso' | 'cja'} PortfolioSiteListMode */

export const PORTFOLIO_SITE_LIST_ASO = 'aso';
export const PORTFOLIO_SITE_LIST_CJA = 'cja';

/** @param {string} [mode] */
export function normalizePortfolioSiteListMode(mode) {
  return mode === PORTFOLIO_SITE_LIST_CJA ? PORTFOLIO_SITE_LIST_CJA : PORTFOLIO_SITE_LIST_ASO;
}

/**
 * @param {string} [mode]
 * @returns {ReadonlyArray<{ siteId: string, baseURL: string }>}
 */
export function getPortfolioSitesForMode(mode) {
  const m = normalizePortfolioSiteListMode(mode);
  const raw = m === PORTFOLIO_SITE_LIST_CJA ? CJA_DASHBOARD_SITES : ASO_PORTFOLIO_SITES;
  return raw.map((s) => ({
    siteId: s.siteId,
    baseURL: (s.baseURL || s.siteId).replace(/^https?:\/\//, ''),
  }));
}

/** @param {string} [mode] */
export function getPortfolioAllowedSiteIds(mode) {
  return getPortfolioSitesForMode(mode).map((s) => s.siteId);
}

export function getPortfolioAllowedSiteIdsParam(mode) {
  return getPortfolioAllowedSiteIds(mode).join(',');
}

/** @param {string} [mode] */
export function getPortfolioAllowedSiteIdSet(mode) {
  return new Set(getPortfolioAllowedSiteIds(mode));
}

function formatSiteLabel(s) {
  const u = (s.baseURL || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return u || s.siteId;
}

function buildLabelMap(sites) {
  return new Map(sites.map((s) => [s.siteId, formatSiteLabel(s)]));
}

const _asoSites = getPortfolioSitesForMode(PORTFOLIO_SITE_LIST_ASO);
const _cjaSites = getPortfolioSitesForMode(PORTFOLIO_SITE_LIST_CJA);
const _labelByIdASO = buildLabelMap(_asoSites);
const _labelByIdCJA = buildLabelMap(_cjaSites);

/** @param {string} siteId @param {string} [mode] */
export function getPortfolioSiteLabel(siteId, mode) {
  const m = normalizePortfolioSiteListMode(mode);
  const map = m === PORTFOLIO_SITE_LIST_CJA ? _labelByIdCJA : _labelByIdASO;
  return map.get(siteId) || siteId;
}

/**
 * @param {Array<{ orgId: string, orgName?: string, sites?:
 * Array<{ siteId: string, baseURL?: string, siteName?: string }> }>} tree
 * @param {string} [mode]
 */
export function getPortfolioScopedOrgs(tree, mode) {
  if (!tree || !tree.length) return [];
  const allow = getPortfolioAllowedSiteIdSet(mode);
  return tree.filter((org) => (org.sites || []).some((s) => allow.has(s.siteId)));
}

/** @param {object} org @param {string} [mode] */
export function getAllowedSitesForOrg(org, mode) {
  if (!org?.sites?.length) return [];
  const allow = getPortfolioAllowedSiteIdSet(mode);
  return org.sites.filter((s) => allow.has(s.siteId));
}

/**
 * @param {string} scopeValue
 * @param {object | null} org
 * @param {string | null} singleSiteId
 * @param {string} [mode]
 */
export function getPortfolioScopeSiteIds(scopeValue, org, singleSiteId, mode) {
  const all = getPortfolioAllowedSiteIds(mode);
  if (scopeValue === 'global' || !scopeValue) return all;
  if (!org) return all;
  const allowedInOrg = getAllowedSitesForOrg(org, mode).map((s) => s.siteId);
  if (singleSiteId && allowedInOrg.includes(singleSiteId)) return [singleSiteId];
  return allowedInOrg;
}

/** Human-readable name for the site list (UI + docs). */
export function getPortfolioSiteListTitle(mode) {
  return normalizePortfolioSiteListMode(mode) === PORTFOLIO_SITE_LIST_CJA
    ? 'CJA dashboard (comparison)'
    : 'Team portfolio (ASO)';
}

/** Short hint for comparison mode. */
export function getPortfolioSiteListHint(mode) {
  return normalizePortfolioSiteListMode(mode) === PORTFOLIO_SITE_LIST_CJA
    ? 'Same site set as the CJA dashboard — use to compare with that view. Run <code>npm run snapshot:portfolio:cja</code> for a matching snapshot.'
    : 'Your team’s default portfolio sites. Run <code>npm run snapshot:portfolio</code> to refresh.';
}

/** Count of sites in the active list. */
export function getPortfolioSiteCount(mode) {
  return getPortfolioAllowedSiteIds(mode).length;
}
