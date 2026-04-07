import { NextRequest, NextResponse } from 'next/server';
import { SpaceCatProxyClient } from '@validator-shared/spacecat/proxyClient';
import { httpStatusFromThrownError } from '@validator-shared/spacecat/httpStatusFromError';
import { getCachedSites, findSiteByBaseURL } from '@validator-shared/cache/sitesCache';

/**
 * GET /api/validator/sites
 * Query: baseURL (optional) — if provided, returns the single site matching this base URL, or 404.
 *        Without baseURL, returns all sites from SpaceCat.
 * List is cached for 24 hours (in-memory); baseURL lookup uses cache when valid.
 * Requires Authorization: Bearer <ims_token>
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!bearerToken) {
    return NextResponse.json(
      { error: 'Missing IMS token. Please sign in.' },
      { status: 401 }
    );
  }

  const client = new SpaceCatProxyClient(bearerToken);

  try {
    const { searchParams } = new URL(request.url);
    const baseURL = searchParams.get('baseURL')?.trim();

    if (baseURL) {
      const sites = await getCachedSites(() => client.getSites());
      const site = findSiteByBaseURL(sites, baseURL);
      if (!site) {
        return NextResponse.json(
          { error: 'Site not found', baseURL },
          { status: 404 }
        );
      }
      return NextResponse.json(site);
    }

    const sites = await getCachedSites(() => client.getSites());
    return NextResponse.json(sites);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'SpaceCat API error';
    const status = httpStatusFromThrownError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
