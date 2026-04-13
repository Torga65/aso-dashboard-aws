'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import {
  Flex,
  Heading,
  Text,
  Button,
  Breadcrumbs,
  Item,
  ProgressCircle,
  View,
  Well,
} from '@adobe/react-spectrum';
import { SiteSelector, type Site } from '@/components/validator/SiteSelector';
import { OpportunityList, type Opportunity } from '@/components/validator/OpportunityList';
import { SuggestionList, type Suggestion } from '@/components/validator/SuggestionList';
import { ValidationHighlights } from '@/components/validator/ValidationHighlights';
import type { OriginFilter } from '@/components/validator/CategoryFilters';
import type { Opportunity as SharedOpportunity } from '@validator-shared/types';
import { mapOpportunityToTypeId } from '@validator-shared/validation/map-opportunity-type';
import { useIMSAuth } from '@/contexts/IMSAuthContext';
import { useSearchParams } from 'next/navigation';

export type ValidationResultItem = {
  suggestionId: string;
  validation_status: string;
  explanation?: string;
  fixValidated?: boolean;
  fixExplanation?: string;
};

export default function ValidatorPage() {
  return (
    <Suspense>
      <ValidatorPageInner />
    </Suspense>
  );
}

function ValidatorPageInner() {
  const { accessToken } = useIMSAuth();
  const searchParams = useSearchParams();
  const preloadBaseURL = searchParams.get('baseURL') ?? undefined;
  const [site, setSite] = useState<Site | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [opportunitiesLoading, setOpportunitiesLoading] = useState(false);
  const [opportunitiesError, setOpportunitiesError] = useState<string | null>(null);
  const [originFilter, setOriginFilter] = useState<OriginFilter>('aso');
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'idle' | 'validating' | 'success' | 'error'>('idle');
  const [validationMessage, setValidationMessage] = useState('');
  const [validationResultBySuggestionId, setValidationResultBySuggestionId] = useState<Record<string, ValidationResultItem>>({});
  const [validatingSuggestionIds, setValidatingSuggestionIds] = useState<Set<string>>(new Set());
  const validationSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOpportunities = useCallback(
    async (siteId: string, origin: OriginFilter) => {
      setOpportunitiesLoading(true);
      setOpportunitiesError(null);
      setSelectedOpportunity(null);
      setSuggestions([]);
      try {
        const params = new URLSearchParams({
          origin,
          includePendingFlag: 'true',
        });
        const res = await fetch(
          `/api/validator/sites/${siteId}/opportunities?${params.toString()}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setOpportunities(Array.isArray(data) ? data : []);
      } catch (e) {
        setOpportunitiesError(e instanceof Error ? e.message : 'Failed to load opportunities');
        setOpportunities([]);
      } finally {
        setOpportunitiesLoading(false);
      }
    },
    [accessToken]
  );

  const fetchSuggestions = useCallback(async (siteId: string, opportunityId: string) => {
    setSuggestionsLoading(true);
    setSuggestionsError(null);
    try {
      const res = await fetch(
        `/api/validator/sites/${siteId}/opportunities/${opportunityId}/suggestions`,
        { cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSuggestions(Array.isArray(data) ? data : []);
    } catch (e) {
      setSuggestionsError(e instanceof Error ? e.message : 'Failed to load suggestions');
      setSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!site?.id) {
      setOpportunities([]);
      setOpportunitiesError(null);
      setSelectedOpportunity(null);
      setSuggestions([]);
      return;
    }
    fetchOpportunities(site.id, originFilter);
  }, [site?.id, originFilter, fetchOpportunities]);

  useEffect(() => {
    if (!site?.id || !selectedOpportunity?.id) {
      setSuggestions([]);
      return;
    }
    fetchSuggestions(site.id, selectedOpportunity.id);
  }, [site?.id, selectedOpportunity?.id, fetchSuggestions]);

  useEffect(() => {
    setValidationStatus('idle');
    setValidationMessage('');
    setValidationResultBySuggestionId({});
    setValidatingSuggestionIds(new Set());
    if (validationSuccessTimeoutRef.current) {
      clearTimeout(validationSuccessTimeoutRef.current);
      validationSuccessTimeoutRef.current = null;
    }
  }, [selectedOpportunity?.id]);

  function handleSelectSite(s: Site) {
    setSite(s);
  }

  function handleSelectOpportunity(opp: Opportunity) {
    setSelectedOpportunity(opp);
  }

  function handleBackToCategories() {
    setSelectedOpportunity(null);
  }

  async function handleValidate(suggestionIds: string[]) {
    if (!site?.id || !selectedOpportunity?.id || suggestionIds.length === 0) return;
    if (validationSuccessTimeoutRef.current) {
      clearTimeout(validationSuccessTimeoutRef.current);
      validationSuccessTimeoutRef.current = null;
    }
    setValidating(true);
    setValidatingSuggestionIds(new Set(suggestionIds));
    setValidationStatus('validating');
    setValidationMessage(`Validating ${suggestionIds.length} selected issue(s)…`);

    const baseUrl = `/api/validator/sites/${site.id}/opportunities/${selectedOpportunity.id}/validate`;
    const runOne = async (id: string): Promise<ValidationResultItem | null> => {
      try {
        const suggestionPayload = suggestions.find((s) => s.id === id);
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            suggestionIds: [id],
            ...(suggestionPayload && selectedOpportunity
              ? {
                  suggestions: [suggestionPayload],
                  opportunity: selectedOpportunity as SharedOpportunity,
                }
              : {}),
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { results?: ValidationResultItem[] };
        const result = Array.isArray(data.results) && data.results[0] ? data.results[0] : null;
        if (result) {
          setValidationResultBySuggestionId((prev) => ({ ...prev, [result.suggestionId]: result }));
        }
        return result;
      } catch {
        const fallback: ValidationResultItem = { suggestionId: id, validation_status: 'error', explanation: 'Validation failed' };
        setValidationResultBySuggestionId((prev) => ({ ...prev, [id]: fallback }));
        return fallback;
      } finally {
        setValidatingSuggestionIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    };

    const settled = await Promise.allSettled(suggestionIds.map((id) => runOne(id)));
    const completed = settled.filter((s) => s.status === 'fulfilled').length;
    setValidating(false);
    setValidationStatus('success');
    setValidationMessage(`Validation complete. ${completed} of ${suggestionIds.length} issue(s) validated.`);
    validationSuccessTimeoutRef.current = setTimeout(() => {
      setValidationStatus('idle');
      setValidationMessage('');
      validationSuccessTimeoutRef.current = null;
    }, 5000);
  }

  async function handleUpdateStatus(suggestionIds: string[], status: string) {
    if (!site?.id || !selectedOpportunity?.id || suggestionIds.length === 0) return;
    setUpdatingStatus(true);
    try {
      const res = await fetch(
        `/api/validator/sites/${site.id}/opportunities/${selectedOpportunity.id}/suggestions/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ suggestionIds, status }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const idSet = new Set(suggestionIds);
      setSuggestions((prev) =>
        prev.map((s) => (idSet.has(s.id) ? { ...s, status } : s))
      );
      await fetchSuggestions(site.id, selectedOpportunity.id);
      setSuggestions((prev) =>
        prev.map((s) => (idSet.has(s.id) ? { ...s, status } : s))
      );
    } catch (e) {
      setValidationStatus('error');
      setValidationMessage(e instanceof Error ? e.message : 'Update status failed');
    } finally {
      setUpdatingStatus(false);
    }
  }

  const siteLabel = (site as Site | null)?.baseURL ?? (site as Site | null)?.id ?? '';

  const contentPadding = { padding: 'var(--spectrum-global-dimension-size-300)' };
  const stickyHeaderStyle = {
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
    background: 'var(--spectrum-alias-background-color-default)',
    borderBottom: '1px solid var(--spectrum-alias-border-color-muted)',
  };

  if (site && selectedOpportunity) {
    return (
      <Flex
        direction="column"
        maxWidth="1200px"
        marginStart="auto"
        marginEnd="auto"
        width="100%"
        height="100vh"
        minHeight={0}
        UNSAFE_style={{
          boxSizing: 'border-box',
          paddingBottom: 'var(--spectrum-global-dimension-size-400)',
        }}
      >
        <Flex
          direction="column"
          gap="size-150"
          UNSAFE_style={{ ...contentPadding, ...stickyHeaderStyle }}
        >
          <Flex direction="row" alignItems="center" justifyContent="space-between" gap="size-200" wrap>
            <Heading level={1} margin={0}>
              AEM Sites Optimizer Validator
            </Heading>
            <Button variant="primary" isQuiet onPress={handleBackToCategories}>
              ← Back to opportunities
            </Button>
          </Flex>
          <Breadcrumbs
            onAction={(key) => {
              if (key === 'site') {
                handleBackToCategories();
              }
            }}
          >
            <Item key="site">{siteLabel}</Item>
            <Item key="type">
              <Text UNSAFE_style={{ fontWeight: 600 }}>
                {selectedOpportunity.type?.trim() || '—'}
              </Text>
            </Item>
          </Breadcrumbs>
        </Flex>

        <Flex
          direction="column"
          flex={1}
          minHeight={0}
          width="100%"
          UNSAFE_style={contentPadding}
        >
          <Flex direction="column" gap="size-300" flex={1} minHeight={0} width="100%">
            {validationStatus !== 'idle' && (
              <Flex
                gap="size-100"
                alignItems="center"
                UNSAFE_style={{
                  padding: 'var(--spectrum-global-dimension-size-150)',
                  borderRadius: 6,
                  border: '1px solid',
                  ...(validationStatus === 'validating' && { borderColor: 'var(--spectrum-global-color-blue-600)', background: 'rgba(38, 128, 235, 0.12)' }),
                  ...(validationStatus === 'success' && { borderColor: 'var(--spectrum-semantic-positive-color-default)', background: 'rgba(38, 142, 108, 0.12)' }),
                  ...(validationStatus === 'error' && { borderColor: 'var(--spectrum-semantic-negative-color-default)', background: 'rgba(227, 72, 80, 0.12)' }),
                }}
              >
                {validationStatus === 'validating' && (
                  <ProgressCircle size="S" isIndeterminate aria-hidden />
                )}
                <Text>{validationMessage}</Text>
              </Flex>
            )}

            <SuggestionList
              suggestions={suggestions}
              loading={suggestionsLoading}
              error={suggestionsError}
              onValidate={handleValidate}
              validating={validating}
              validationResultBySuggestionId={validationResultBySuggestionId}
              validatingSuggestionIds={validatingSuggestionIds}
              opportunity={
                selectedOpportunity
                  ? {
                      auditId: (selectedOpportunity as { auditId?: string }).auditId,
                      tags: (selectedOpportunity as { tags?: string[] }).tags,
                      type: selectedOpportunity.type,
                      title: selectedOpportunity.title,
                    }
                  : null
              }
              opportunityTypeId={
                selectedOpportunity
                  ? mapOpportunityToTypeId(selectedOpportunity as SharedOpportunity)
                  : undefined
              }
              onUpdateStatus={handleUpdateStatus}
              updatingStatus={updatingStatus}
            />
          </Flex>
        </Flex>
      </Flex>
    );
  }

  return (
    <Flex direction="column" maxWidth="1800px" marginStart="auto" marginEnd="auto" minHeight="100vh">
      <Flex
        direction="column"
        gap="size-100"
        UNSAFE_style={{ ...contentPadding, ...stickyHeaderStyle }}
      >
        <Heading level={1} margin={0}>AEM Sites Optimizer Validator</Heading>
      </Flex>

      <View UNSAFE_style={contentPadding}>
        <Well>
          <Flex direction="column" gap="size-300">
            <SiteSelector onSelect={handleSelectSite} selectedSite={site} preloadBaseURL={preloadBaseURL} />

            {site && !opportunitiesLoading && (
              <ValidationHighlights
                opportunities={opportunities}
                onSelect={handleSelectOpportunity}
                siteId={site.id}
                accessToken={accessToken ?? ''}
              />
            )}

            {site && (
              <OpportunityList
                siteId={site.id}
                opportunities={opportunities}
                selectedId={null}
                onSelect={handleSelectOpportunity}
                loading={opportunitiesLoading}
                error={opportunitiesError}
                filtersActive={originFilter !== 'all'}
                originFilter={originFilter}
                onOriginFilterChange={setOriginFilter}
                filtersDisabled={opportunitiesLoading}
              />
            )}
          </Flex>
        </Well>
      </View>
    </Flex>
  );
}
