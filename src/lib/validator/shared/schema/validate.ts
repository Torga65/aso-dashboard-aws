/**
 * Validate suggestion or suggestion.data against a JSON Schema using Ajv.
 * Used by gate validators to ensure payload shape before type-specific rules.
 */

import Ajv, { type ValidateFunction } from 'ajv';
import type { Suggestion } from '@validator-shared/types';

export interface ValidationError {
  instancePath: string;
  message?: string;
  params?: Record<string, unknown>;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Validate an object against a JSON Schema. Schema can be a plain object (JSON Schema).
 */
export function validateWithSchema(
  data: unknown,
  schema: object
): SchemaValidationResult {
  let validate: ValidateFunction | undefined;
  try {
    validate = ajv.compile(schema);
  } catch (err) {
    return {
      valid: false,
      errors: [{ instancePath: '', message: `Invalid schema: ${err instanceof Error ? err.message : String(err)}` }],
    };
  }
  const valid = validate(data);
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors: ValidationError[] = (validate.errors || []).map((e) => ({
    instancePath: e.instancePath || '',
    message: e.message,
    params: e.params as Record<string, unknown> | undefined,
  }));
  return { valid: false, errors };
}

/**
 * Validate full suggestion shape (id, opportunityId, status, data present).
 */
export function validateSuggestionShape(suggestion: unknown): SchemaValidationResult {
  const baseSchema = {
    type: 'object' as const,
    required: ['id', 'opportunityId', 'status'],
    properties: {
      id: { type: 'string' },
      opportunityId: { type: 'string' },
      status: { type: 'string' },
      data: { type: 'object' },
    },
    additionalProperties: true,
  };
  return validateWithSchema(suggestion, baseSchema);
}

/**
 * Validate suggestion.data against a type-specific schema. Use in opportunity validators.
 */
export function validateSuggestionData(
  suggestion: Suggestion,
  dataSchema: object
): SchemaValidationResult {
  const data = suggestion.data ?? {};
  return validateWithSchema(data, dataSchema);
}
