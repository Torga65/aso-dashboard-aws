import { NextRequest, NextResponse } from 'next/server';
import { SpaceCatProxyClient } from '@validator-shared/spacecat/proxyClient';
import { httpStatusFromThrownError } from '@validator-shared/spacecat/httpStatusFromError';
import type { Opportunity } from '@validator-shared/types';

/** LLMO categories are tagged with isElmo; ASO categories are not tagged. */
function isLlmoByTag(opportunity: Opportunity): boolean {
  if (opportunity.isElmo === true) return true;
  return opportunity.tags?.includes('isElmo') === true;
}

/**
 * GET /api/validator/sites/[siteId]/opportunities
 * Returns opportunities for the given site from SpaceCat.
 * Only categories with status NEW are returned.
 * Query params:
 *   - origin: 'all' | 'aso' | 'llmo' (default 'all') — filter by product (LLMO = tagged isElmo, ASO = not tagged).
 *   - hasPendingValidation: 'true' | 'false' (default 'false') — only return opportunities that have at least one issue (suggestion) with status PENDING_VALIDATION.
 *   - includePendingFlag: 'true' | 'false' (default 'false') — when 'true', each opportunity includes hasPendingValidation: boolean indicating if it has any PENDING_VALIDATION suggestions.
 * Requires Authorization: Bearer <ims_token>
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const authHeader = request.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!bearerToken) {
    return NextResponse.json(
      { error: 'Missing IMS token. Please sign in.' },
      { status: 401 }
    );
  }

  const client = new SpaceCatProxyClient(bearerToken);

  const { siteId } = await params;
  if (!siteId) {
    return NextResponse.json({ error: 'siteId is required' }, { status: 400 });
  }

  const { searchParams } = request.nextUrl;
  const origin = (searchParams.get('origin') ?? 'all') as 'all' | 'aso' | 'llmo';
  const hasPendingValidation = searchParams.get('hasPendingValidation') === 'true';
  const includePendingFlag = searchParams.get('includePendingFlag') === 'true';

  try {
    let opportunities = await client.getOpportunitiesForSite(siteId);

    // Only show categories with status NEW
    opportunities = opportunities.filter((o) => o.status === 'NEW');

    // 1. Origin filter (LLMO = tagged isElmo, ASO = not tagged)
    if (origin === 'aso') {
      opportunities = opportunities.filter((o) => !isLlmoByTag(o));
    } else if (origin === 'llmo') {
      opportunities = opportunities.filter((o) => isLlmoByTag(o));
    }

    // 2. Enrich with hasPendingValidation and/or filter by it
    if ((includePendingFlag || hasPendingValidation) && opportunities.length > 0) {
      const enriched = await Promise.all(
        opportunities.map(async (opp) => {
          const suggestions = await client.getSuggestionsForOpportunity(siteId, opp.id);
          const hasPending = suggestions.some((s) => s.status === 'PENDING_VALIDATION');
          return { ...opp, hasPendingValidation: hasPending };
        })
      );
      if (hasPendingValidation) {
        opportunities = enriched.filter((o) => o.hasPendingValidation);
      } else {
        opportunities = enriched;
      }
    }

    return NextResponse.json(opportunities);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'SpaceCat API error';
    const status = httpStatusFromThrownError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
