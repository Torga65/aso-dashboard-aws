import { NextRequest, NextResponse } from 'next/server';
import { SpaceCatProxyClient } from '@validator-shared/spacecat/proxyClient';
import { httpStatusFromThrownError } from '@validator-shared/spacecat/httpStatusFromError';
import { runValidation } from '@validator-shared/validation/run-validation';
import { mapOpportunityToTypeId } from '@validator-shared/validation/map-opportunity-type';
import type { Opportunity, Suggestion } from '@validator-shared/types';

export interface ValidateRequestBody {
  /** If true, only run gate validation (no LLM). Default false. */
  gateOnly?: boolean;
  /** Override derived opportunity type (e.g. sitemap, heading). Optional. */
  opportunityTypeId?: string;
  /** If provided, only run validation on these suggestion IDs. Omit or empty = validate all. */
  suggestionIds?: string[];
  /**
   * When set (non-empty), use these suggestions instead of loading from SpaceCat.
   * Send `opportunity` (or `opportunityTypeId`) so the server can map type and titles.
   */
  suggestions?: Suggestion[];
  /** SpaceCat opportunity snapshot (when using inline `suggestions`). Used for type mapping and context. */
  opportunity?: Opportunity;
}

/**
 * POST /api/validator/sites/[siteId]/opportunities/[opportunityId]/validate
 * Runs validation on the given suggestions (gate + optional LLM). Returns results only;
 * does not update suggestion status in SpaceCat.
 * Body: { suggestionIds?, gateOnly?, opportunityTypeId?, suggestions?, opportunity? }.
 * When `suggestions` + `opportunity` are sent, SpaceCat list endpoints are skipped (UI already loaded data).
 * Requires Authorization: Bearer <ims_token>
 */
export async function POST(
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

  let body: ValidateRequestBody = {};
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const raw = await request.json();
      body = typeof raw === 'object' && raw !== null ? (raw as ValidateRequestBody) : {};
    }
  } catch {
    // no body or invalid JSON is ok; use defaults
  }

  try {
    const suggestionIds = Array.isArray(body.suggestionIds)
      ? (body.suggestionIds as string[]).filter((id) => typeof id === 'string')
      : undefined;

    const inlineSuggestions =
      Array.isArray(body.suggestions) && body.suggestions.length > 0
        ? (body.suggestions as Suggestion[])
        : null;

    let opportunity: Opportunity;
    let suggestions: Suggestion[];

    if (inlineSuggestions) {
      if (!body.opportunity) {
        return NextResponse.json(
          { error: 'When sending suggestions, include opportunity (SpaceCat snapshot for type and title)' },
          { status: 400 }
        );
      }
      for (const s of inlineSuggestions) {
        if (s.opportunityId && s.opportunityId !== opportunityId) {
          return NextResponse.json(
            { error: 'Suggestion opportunityId does not match route opportunityId' },
            { status: 400 }
          );
        }
      }
      opportunity = body.opportunity as Opportunity;
      suggestions = inlineSuggestions.map((s) => ({ ...s, siteId }));
      if (suggestionIds && suggestionIds.length > 0) {
        const idSet = new Set(suggestionIds);
        suggestions = suggestions.filter((s) => idSet.has(s.id));
      }
      if (suggestions.length === 0) {
        return NextResponse.json(
          { error: 'No suggestions matched suggestionIds' },
          { status: 400 }
        );
      }
    } else {
      const opportunities = await client.getOpportunitiesForSite(siteId);
      const found = opportunities.find((o: Opportunity) => o.id === opportunityId) ?? null;
      if (!found) {
        return NextResponse.json(
          { error: 'Opportunity not found', siteId, opportunityId },
          { status: 404 }
        );
      }
      opportunity = found;
      suggestions = await client.getSuggestionsForOpportunity(siteId, opportunityId);
      suggestions = suggestions.map((s) => ({ ...s, siteId }));
      if (suggestionIds && suggestionIds.length > 0) {
        const idSet = new Set(suggestionIds);
        suggestions = suggestions.filter((s) => idSet.has(s.id));
      }
    }

    const opportunityTypeId =
      body.opportunityTypeId ??
      mapOpportunityToTypeId(opportunity as Opportunity);

    const results = await runValidation(suggestions, {
      opportunityTypeId,
      opportunityTitle: opportunity.title,
      runbook: opportunity.runbook,
      gateOnly: body.gateOnly === true,
    });

    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Validation failed';
    const status = httpStatusFromThrownError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
