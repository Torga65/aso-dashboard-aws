import { NextRequest, NextResponse } from 'next/server';
import { SpaceCatProxyClient } from '@validator-shared/spacecat/proxyClient';
import { httpStatusFromThrownError } from '@validator-shared/spacecat/httpStatusFromError';

export interface UpdateStatusRequestBody {
  /** Suggestion IDs to update. */
  suggestionIds: string[];
  /** New status to set (e.g. PENDING_VALIDATION, APPROVED, REJECTED). */
  status: string;
}

/**
 * PATCH /api/validator/sites/[siteId]/opportunities/[opportunityId]/suggestions/status
 * Updates the status of the given suggestions in SpaceCat.
 * Body: { suggestionIds: string[], status: string }
 * Requires Authorization: Bearer <ims_token>
 */
export async function PATCH(
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

  let body: UpdateStatusRequestBody;
  try {
    const raw = await request.json();
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.suggestionIds) || typeof raw.status !== 'string') {
      return NextResponse.json(
        { error: 'Body must include suggestionIds (array) and status (string)' },
        { status: 400 }
      );
    }
    body = raw as UpdateStatusRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const suggestionIds = body.suggestionIds.filter((id) => typeof id === 'string');
  const status = body.status.trim();
  if (suggestionIds.length === 0 || !status) {
    return NextResponse.json(
      { error: 'At least one suggestion ID and a non-empty status are required' },
      { status: 400 }
    );
  }

  try {
    const updates = suggestionIds.map((id) => ({ id, status }));
    await client.updateSuggestionStatus(siteId, opportunityId, updates);
    return NextResponse.json({ updated: suggestionIds.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed';
    const statusCode = httpStatusFromThrownError(err);
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
