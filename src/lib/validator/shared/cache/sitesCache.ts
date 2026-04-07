/**
 * Server-side cache for the full sites list (24h TTL).
 * Used by GET /api/validator/sites to avoid calling SpaceCat on every request.
 */

const SITES_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface CachedSite {
  id: string;
  baseURL?: string;
  [key: string]: unknown;
}

let cache: { data: CachedSite[]; expiresAt: number } | null = null;

function normalizeBaseURL(url: string): string {
  return (url || '').trim().replace(/\/$/, '').toLowerCase();
}

export function getCachedSites(
  fetchSites: () => Promise<CachedSite[]>
): Promise<CachedSite[]> {
  const now = Date.now();
  if (cache && now < cache.expiresAt) {
    return Promise.resolve(cache.data);
  }
  return fetchSites().then((data) => {
    cache = { data, expiresAt: now + SITES_CACHE_TTL_MS };
    return data;
  });
}

export function findSiteByBaseURL(
  sites: CachedSite[],
  baseURL: string
): CachedSite | null {
  const normalized = normalizeBaseURL(baseURL);
  const site = sites.find((s) => normalizeBaseURL((s.baseURL ?? '') as string) === normalized);
  return site ?? null;
}

/** Reset cache (for tests only). */
export function resetSitesCache(): void {
  cache = null;
}
