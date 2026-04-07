/**
 * Shared types for SpaceCat API and validation.
 * Aligned with SpaceCat OpenAPI / aso-validating-tools.
 */

export type SuggestionStatus =
  | 'NEW'
  | 'APPROVED'
  | 'SKIPPED'
  | 'FIXED'
  | 'ERROR'
  | 'IN_PROGRESS'
  | 'OUTDATED'
  | 'PENDING_VALIDATION'
  | 'REJECTED';

export type OpportunityStatus = 'NEW' | 'IN_PROGRESS' | 'IGNORED' | 'RESOLVED';

export interface Site {
  id: string;
  baseURL?: string;
  [key: string]: unknown;
}

export interface Opportunity {
  id: string;
  siteId: string;
  auditId: string;
  runbook?: string;
  type: string;
  data?: Record<string, unknown>;
  origin?: string;
  title: string;
  description?: string;
  guidance?: Record<string, unknown>;
  /** LLMO categories are tagged with isElmo; ASO categories are not. May be set by backend or derived from tags. */
  isElmo?: boolean;
  tags?: string[];
  status: OpportunityStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
  [key: string]: unknown;
}

export interface Suggestion {
  id: string;
  opportunityId: string;
  siteId?: string;
  status: SuggestionStatus;
  type?: string;
  data?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface ValidationResult {
  suggestionId: string;
  validation_status: string;
  explanation?: string;
  /** Hreflang: truncated HTML from the live page for LLM issue classification. */
  pageSourceSnippet?: string;
  /** When status is real_issue, set after LLM validates the suggested fix. */
  fixValidated?: boolean;
  /** LLM explanation for fix validation (e.g. why the fix is correct or incorrect). */
  fixExplanation?: string;
  [key: string]: unknown;
}
