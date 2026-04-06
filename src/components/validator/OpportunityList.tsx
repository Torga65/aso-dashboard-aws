'use client';

import { useState } from 'react';
import {
  Flex,
  Heading,
  Text,
  ActionGroup,
  Item,
  TableView,
  TableHeader,
  TableBody,
  Column,
  Row,
  Cell,
  Well,
  ActionButton,
  Picker,
} from '@adobe/react-spectrum';
import Checkmark from '@spectrum-icons/workflow/Checkmark';
import Alert from '@spectrum-icons/workflow/Alert';
import type { OriginFilter } from './CategoryFilters';

export interface Opportunity {
  id: string;
  siteId: string;
  type: string;
  title: string;
  status?: string;
  /** When true, this opportunity has at least one suggestion with status PENDING_VALIDATION (from API includePendingFlag). */
  hasPendingValidation?: boolean;
  [key: string]: unknown;
}

type ViewMode = 'grid' | 'list';

const ORIGIN_OPTIONS: { value: OriginFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'aso', label: 'AEM Sites Optimizer' },
  { value: 'llmo', label: 'LLM Optimizer' },
];

const LIST_COLUMNS = [
  { uid: 'title', name: 'Opportunity' },
  { uid: 'type', name: 'Type' },
  { uid: 'status', name: 'Status', width: 44 },
];

interface OpportunityListProps {
  siteId: string;
  opportunities: Opportunity[];
  selectedId: string | null;
  onSelect: (opportunity: Opportunity) => void;
  loading?: boolean;
  error: string | null;
  /** When true and list is empty, show "No opportunities match the current filters." */
  filtersActive?: boolean;
  /** Product filter (used in dropdown). */
  originFilter?: OriginFilter;
  onOriginFilterChange?: (value: OriginFilter) => void;
  /** Disable filter controls when opportunities are loading. */
  filtersDisabled?: boolean;
}

export function OpportunityList({
  siteId,
  opportunities,
  selectedId,
  onSelect,
  loading,
  error,
  filtersActive,
  originFilter = 'all',
  onOriginFilterChange,
  filtersDisabled = false,
}: OpportunityListProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  if (loading) {
    return (
      <Flex direction="column" gap="size-150" marginBottom="size-200">
        <Heading level={2} margin={0}>Opportunities</Heading>
        <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-600)' }}>Loading opportunities…</Text>
      </Flex>
    );
  }

  if (error) {
    return (
      <Flex direction="column" gap="size-150" marginBottom="size-200">
        <Heading level={2} margin={0}>Opportunities</Heading>
        <Text UNSAFE_style={{ color: 'var(--spectrum-semantic-negative-color-default)' }}>{error}</Text>
      </Flex>
    );
  }

  const emptyMessage = filtersActive
    ? 'No opportunities match the current filters.'
    : 'No opportunities for this site.';

  return (
      <Flex direction="column" gap="size-200" marginBottom="size-200">
      <Flex direction="row" justifyContent="space-between" alignItems="center" wrap gap="size-150">
        <Heading level={2} margin={0}>Opportunities</Heading>
        <Flex direction="row" alignItems="center" gap="size-150" wrap>
          {onOriginFilterChange && (
            <>
              <Flex direction="row" alignItems="center" gap="size-200" UNSAFE_style={{ marginRight: 8 }}>
                <Flex direction="row" alignItems="center" gap="size-100">
                  <span className="aso-status-icon--valid">
                    <Checkmark size="S" aria-hidden />
                  </span>
                  <Text UNSAFE_style={{ fontSize: 'var(--spectrum-global-dimension-font-size-75)', color: 'var(--spectrum-global-color-gray-600)' }}>Valid</Text>
                </Flex>
                <Flex direction="row" alignItems="center" gap="size-100">
                  <span className="aso-status-icon--invalid">
                    <Alert size="S" aria-hidden />
                  </span>
                  <Text UNSAFE_style={{ fontSize: 'var(--spectrum-global-dimension-font-size-75)', color: 'var(--spectrum-global-color-gray-600)' }}>Needs Validation</Text>
                </Flex>
              </Flex>
              <Picker
                label="Product"
                labelPosition="side"
                selectedKey={originFilter}
                onSelectionChange={(key) => key != null && onOriginFilterChange(key as OriginFilter)}
                isDisabled={filtersDisabled}
                width="size-2500"
              >
                {ORIGIN_OPTIONS.map(({ value, label }) => (
                  <Item key={value} textValue={label}>{label}</Item>
                ))}
              </Picker>
            </>
          )}
          {opportunities.length > 0 && (
            <ActionGroup
              selectionMode="single"
              selectedKeys={[viewMode]}
              onSelectionChange={(keys) => {
                const key = keys === 'all' ? null : Array.from(keys)[0];
                if (key === 'grid' || key === 'list') setViewMode(key);
              }}
              aria-label="View mode"
            >
              <Item key="grid" textValue="Grid">Grid</Item>
              <Item key="list" textValue="List">List</Item>
            </ActionGroup>
          )}
        </Flex>
      </Flex>

      {opportunities.length === 0 ? (
        <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-600)' }}>{emptyMessage}</Text>
      ) : viewMode === 'grid' ? (
        <div
          className="aso-opportunity-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 'var(--spectrum-global-dimension-size-200)',
          }}
        >
          {opportunities.map((opp) => (
            <OpportunityCard
              key={opp.id}
              opportunity={opp}
              isSelected={selectedId === opp.id}
              onSelect={() => onSelect(opp)}
            />
          ))}
        </div>
      ) : (
        <TableView
          aria-label="Opportunities"
          selectionMode="single"
          selectionStyle="highlight"
          selectedKeys={selectedId ? [selectedId] : []}
          onSelectionChange={(keys) => {
            const key = keys === 'all' ? null : Array.from(keys)[0];
            if (key != null) {
              const opp = opportunities.find((o) => o.id === key);
              if (opp) onSelect(opp);
            }
          }}
          width="100%"
          height="size-6000"
          UNSAFE_className="aso-opportunity-listview"
        >
          <TableHeader columns={LIST_COLUMNS}>
            {(col) => (
              <Column key={col.uid} isRowHeader={col.uid === 'title'} width={col.width}>
                {col.name}
              </Column>
            )}
          </TableHeader>
          <TableBody items={opportunities}>
            {(opp) => (
              <Row>
                {(columnKey) => {
                  if (columnKey === 'status') {
                    return (
                      <Cell>
                        {opp.hasPendingValidation ? (
                          <span className="aso-status-icon--invalid">
                            <Alert size="S" aria-label="Needs Validation" />
                          </span>
                        ) : (
                          <span className="aso-status-icon--valid">
                            <Checkmark size="S" aria-label="Valid" />
                          </span>
                        )}
                      </Cell>
                    );
                  }
                  if (columnKey === 'title') {
                    return (
                      <Cell>
                        <Text UNSAFE_style={{ fontWeight: 600 }}>{opp.title}</Text>
                      </Cell>
                    );
                  }
                  if (columnKey === 'type') {
                    return (
                      <Cell>
                        <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-600)' }}>{opp.type || '—'}</Text>
                      </Cell>
                    );
                  }
                  return <Cell>—</Cell>;
                }}
              </Row>
            )}
          </TableBody>
        </TableView>
      )}
    </Flex>
  );
}

function OpportunityCard({
  opportunity,
  isSelected,
  onSelect,
}: {
  opportunity: Opportunity;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <Well
      UNSAFE_className={`aso-opportunity-card${isSelected ? ' aso-opportunity-card--selected' : ''}`}
      UNSAFE_style={{ width: '100%', minHeight: 100, cursor: 'pointer', padding: 0, minWidth: 0, overflow: 'visible' }}
    >
      <ActionButton
        isQuiet
        onPress={onSelect}
        width="100%"
        height="100%"
        UNSAFE_className="aso-opportunity-card-button"
        UNSAFE_style={{
          minHeight: 100,
          justifyContent: 'flex-start',
          alignItems: 'stretch',
          textAlign: 'left',
          padding: 'var(--spectrum-global-dimension-size-200)',
          borderRadius: 8,
          overflow: 'visible',
        }}
        aria-pressed={isSelected}
        aria-label={`${opportunity.title}, type ${opportunity.type || 'unknown'}. ${isSelected ? 'Selected' : 'Select to view issues'}`}
      >
        <Flex direction="row" width="100%" gap="size-150" UNSAFE_style={{ minWidth: 0, overflow: 'visible' }}>
          <Flex alignItems="center" justifyContent="center" UNSAFE_style={{ width: '25%', flexShrink: 0, minWidth: 0 }}>
            {opportunity.hasPendingValidation ? (
              <span className="aso-status-icon--invalid aso-status-icon--card">
                <Alert size="S" aria-label="Needs Validation" />
              </span>
            ) : (
              <span className="aso-status-icon--valid aso-status-icon--card">
                <Checkmark size="S" aria-label="Valid" />
              </span>
            )}
          </Flex>
          <Flex direction="column" alignItems="start" gap="size-50" UNSAFE_style={{ width: '75%', minWidth: 0, overflow: 'visible', textAlign: 'left' }}>
            <Text
              UNSAFE_style={{
                fontWeight: 600,
                textAlign: 'left',
                display: 'block',
                width: '100%',
                minWidth: 0,
                wordBreak: 'break-word',
                overflow: 'visible',
                whiteSpace: 'normal',
              }}
            >
              {opportunity.title}
            </Text>
            <Text UNSAFE_style={{ fontSize: 'var(--spectrum-global-dimension-font-size-100)', color: 'var(--spectrum-global-color-gray-600)', textAlign: 'left', display: 'block' }}>
              Type: {opportunity.type || '—'}
            </Text>
          </Flex>
        </Flex>
      </ActionButton>
    </Well>
  );
}
