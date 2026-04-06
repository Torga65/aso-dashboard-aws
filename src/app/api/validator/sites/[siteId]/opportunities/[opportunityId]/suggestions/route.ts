import { NextRequest, NextResponse } from 'next/server';
import { SpaceCatProxyClient } from '@validator-shared/spacecat/proxyClient';
import { httpStatusFromThrownError } from '@validator-shared/spacecat/httpStatusFromError';
import type { Suggestion } from '@validator-shared/types';

/**
 * GET /api/validator/sites/[siteId]/opportunities/[opportunityId]/suggestions
 * Returns all suggestions for the given opportunity from SpaceCat.
 * Optionally add siteId to each suggestion for use in status updates (align with aso-validating-tools).
 * Requires Authorization: Bearer <ims_token>
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string; opportunityId: string }> }
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

  const { siteId, opportunityId } = await params;
  if (!siteId || !opportunityId) {
    return NextResponse.json(
      { error: 'siteId and opportunityId are required' },
      { status: 400 }
    );
  }

  try {
    let suggestions = await client.getSuggestionsForOpportunity(siteId, opportunityId);
    suggestions = suggestions.map((s: Suggestion) => ({ ...s, siteId }));
    return NextResponse.json(suggestions, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'SpaceCat API error';
    const status = httpStatusFromThrownError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
