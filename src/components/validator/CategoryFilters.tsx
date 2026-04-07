'use client';

import { RadioGroup, Radio, Checkbox, Flex } from '@adobe/react-spectrum';

export type OriginFilter = 'all' | 'aso' | 'llmo';

interface CategoryFiltersProps {
  originFilter: OriginFilter;
  pendingValidationOnly: boolean;
  onOriginFilterChange: (value: OriginFilter) => void;
  onPendingValidationOnlyChange: (value: boolean) => void;
  disabled?: boolean;
}

const ORIGIN_OPTIONS: { value: OriginFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'aso', label: 'AEM Sites Optimizer' },
  { value: 'llmo', label: 'LLM Optimizer' },
];

export function CategoryFilters({
  originFilter,
  pendingValidationOnly,
  onOriginFilterChange,
  onPendingValidationOnlyChange,
  disabled,
}: CategoryFiltersProps) {
  return (
    <Flex direction="column" gap="size-150" marginBottom="size-200">
      <RadioGroup
        label="Product"
        value={originFilter}
        onChange={(v) => onOriginFilterChange(v as OriginFilter)}
        isDisabled={disabled}
        orientation="horizontal"
      >
        {ORIGIN_OPTIONS.map(({ value, label }) => (
          <Radio key={value} value={value}>
            {label}
          </Radio>
        ))}
      </RadioGroup>
      <Checkbox
        isSelected={pendingValidationOnly}
        onChange={onPendingValidationOnlyChange}
        isDisabled={disabled}
      >
        Only categories with issues in PENDING_VALIDATION
      </Checkbox>
    </Flex>
  );
}
