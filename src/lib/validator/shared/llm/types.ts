/**
 * Shared interface for LLM-based validation.
 * Implement this to add a new LLM provider (OpenAI, Anthropic, etc.).
 */

import type { Suggestion, ValidationResult } from '@validator-shared/types';

export interface LLMValidationContext {
  /** Opportunity type id from registry (e.g. sitemap, heading) */
  opportunityTypeId: string;
  /** Human-readable opportunity title */
  opportunityTitle?: string;
  /** Optional runbook or guidance for the LLM */
  runbook?: string;
}

/** Result of LLM validating whether the suggested fix is correct (for real_issue suggestions). */
export interface FixValidationResult {
  suggestionId: string;
  fixValidated: boolean;
  fixExplanation?: string;
}

/**
 * An LLM adapter validates suggestions and returns a result per suggestion.
 * Gate validation runs first; only gate_passed suggestions are typically sent to the LLM.
 */
export interface LLMValidator {
  readonly id: string;
  readonly label: string;

  /**
   * Validate one or more suggestions. Returns one ValidationResult per suggestion.
   * validation_status should be e.g. "real_issue", "false_positive", or "error" if the LLM failed.
   */
  validate(suggestions: Suggestion[], context: LLMValidationContext): Promise<ValidationResult[]>;

  /**
   * For suggestions already classified as real_issue, validate the **suggested fix** (runs after issue validation).
   * For **broken-internal-links**, this step is **suggestion validation**: OpenAI judges whether AI-suggested URLs are
   * valid links and whether the rationale (e.g. aiRationale) is coherent—see `openai-adapter` specialized prompt.
   * Other opportunity types use a generic "fix correct and sufficient" prompt.
   */
  validateFix?(
    suggestions: Suggestion[],
    context: LLMValidationContext
  ): Promise<FixValidationResult[]>;
}
