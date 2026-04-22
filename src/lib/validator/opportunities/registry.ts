/**
 * Registry of opportunity types. Maps type id to validator and optional metadata.
 * Adding a new type = add a folder under opportunities/ + register here.
 */

import type { Suggestion, ValidationResult } from '../shared/types';
import { validate as validateSitemap } from './sitemap/validator';
import { validate as validateHeading } from './heading/validator';
import { validate as validateHreflang } from './hreflang/validator';
import { validate as validateBrokenInternalLinks } from './broken-internal-links/validator';
import { validate as validateA11yColorContrast } from './a11y-color-contrast/validator';
import { validate as validateA11yAssistive } from './a11y-assistive/validator';
import { validate as validateMetaTags } from './meta-tags/validator';
import { validate as validateCanonical } from './canonical/validator';

export interface OpportunityTypeMeta {
  id: string;
  label: string;
  runbook?: string;
}

export type OpportunityValidator = (
  suggestions: Suggestion[]
) => Promise<ValidationResult[]> | ValidationResult[];

export interface RegisteredOpportunity {
  meta: OpportunityTypeMeta;
  validate: OpportunityValidator;
}

const registry = new Map<string, RegisteredOpportunity>();

export function registerOpportunityType(registration: RegisteredOpportunity): void {
  registry.set(registration.meta.id, registration);
}

export function getOpportunityType(id: string): RegisteredOpportunity | undefined {
  return registry.get(id);
}

export function listOpportunityTypes(): OpportunityTypeMeta[] {
  return Array.from(registry.values()).map((r) => r.meta);
}

// Stub for unmapped or placeholder types
registerOpportunityType({
  meta: { id: 'stub', label: 'Stub (placeholder)' },
  validate: (suggestions) =>
    suggestions.map((s) => ({
      suggestionId: s.id,
      validation_status: 'ok',
      explanation: 'Stub validator',
    })),
});

registerOpportunityType({
  meta: { id: 'sitemap', label: 'Sitemap' },
  validate: validateSitemap,
});

registerOpportunityType({
  meta: { id: 'heading', label: 'Heading' },
  validate: validateHeading,
});

registerOpportunityType({
  meta: { id: 'hreflang', label: 'Hreflang' },
  validate: validateHreflang,
});

registerOpportunityType({
  meta: { id: 'broken-internal-links', label: 'Broken internal links' },
  validate: validateBrokenInternalLinks,
});

registerOpportunityType({
  meta: { id: 'a11y-color-contrast', label: 'Accessibility — Color Contrast' },
  validate: validateA11yColorContrast,
});

registerOpportunityType({
  meta: { id: 'a11y-assistive', label: 'Accessibility — Assistive Technology (ARIA)' },
  validate: validateA11yAssistive,
});

registerOpportunityType({
  meta: { id: 'meta-tags', label: 'Meta Tags' },
  validate: validateMetaTags,
});

registerOpportunityType({
  meta: { id: 'canonical', label: 'Canonical' },
  validate: validateCanonical,
});
