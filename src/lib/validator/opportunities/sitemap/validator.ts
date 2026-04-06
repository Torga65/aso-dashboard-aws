/**
 * Gate validator for sitemap opportunities.
 * Validates suggestion.data shape (pageUrl required); no live HTTP checks here.
 */

import type { Suggestion, ValidationResult } from '@validator-shared/types';
import { validateSuggestionData } from '@validator-shared/schema';
import dataSchema from './data-schema.json';

export function validate(suggestions: Suggestion[]): ValidationResult[] {
  return suggestions.map((s) => {
    const { valid, errors } = validateSuggestionData(s, dataSchema as object);
    if (!valid) {
      const explanation = errors.length
        ? errors.map((e) => `${e.instancePath}: ${e.message ?? 'invalid'}`).join('; ')
        : 'Suggestion data does not match sitemap schema';
      return {
        suggestionId: s.id,
        validation_status: 'invalid_data',
        explanation,
      };
    }
    return {
      suggestionId: s.id,
      validation_status: 'gate_passed',
      explanation: 'Sitemap suggestion data is valid; ready for LLM or live check.',
    };
  });
}
