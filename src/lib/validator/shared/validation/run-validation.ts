/**
 * Run gate validation then optionally LLM validation.
 * - gate_passed → LLM classifies real_issue vs false_positive (sitemap, heading, etc.).
 * - Broken internal links / backlinks: gate directly fetches URL To; if 2xx → gate_passed → false_positive (link works);
 *   if non-2xx → real_issue with fixValidated set by mechanical check (no LLM validateFix needed).
 * - real_issue → LLM suggestion validation (validateFix) for other types; skipped when gate already set fixValidated.
 * Hreflang: gate fetches the page and returns gate_passed with pageSourceSnippet; the LLM decides real vs false positive
 * using that HTML, then validates the fix for real issues.
 */

import type { Suggestion, ValidationResult } from '@validator-shared/types';
import { getOpportunityType } from '@validator-opportunities/registry';
import { getDefaultLLM } from '@validator-shared/llm';
import { getContextForOpportunityType } from '@validator-shared/context/load-context';

/** Attach gate-only fields (e.g. page HTML) so the LLM request includes them. */
function enrichSuggestionWithGateArtifacts(
  s: Suggestion,
  gate: ValidationResult | undefined
): Suggestion {
  const snippet = gate?.pageSourceSnippet;
  if (!snippet) return s;
  return {
    ...s,
    data: {
      ...(s.data && typeof s.data === 'object' && !Array.isArray(s.data) ? s.data : {}),
      pageSourceSnippet: snippet,
    },
  };
}

/** Combine repo context.md with SpaceCat opportunity runbook for the LLM. */
function mergeRunbookForLlm(repoContext: string, opportunityRunbook?: string): string | undefined {
  const parts = [repoContext, opportunityRunbook].filter(
    (p) => typeof p === 'string' && p.trim().length > 0
  ) as string[];
  if (parts.length === 0) return undefined;
  return parts.join('\n\n---\n\n');
}

/**
 * Gate fetched URL To directly and it returned 2xx — not a broken link.
 * Wraps the gate explanation in a "Not a valid issue" message for display.
 */
function brokenInternalLinksVerifiedNotAnIssueExplanation(gateExplanation?: string): string {
  const core = (gateExplanation ?? '')
    .replace(/\s*Proceeding to AI review to confirm whether the issue is valid\.?\s*$/i, '')
    .trim();
  const detail =
    core ||
    'The URL To was requested and returned a successful HTTP status when checked by the validator.';
  return `Not a valid issue: ${detail} Automated verification shows the target responds successfully; any metadata claiming a 404 for this URL may be stale or incorrect.`;
}

export interface RunValidationOptions {
  /** Opportunity type id (e.g. sitemap, heading). Must be registered. */
  opportunityTypeId: string;
  /** Optional title/runbook for LLM context */
  opportunityTitle?: string;
  runbook?: string;
  /** If true, skip LLM and return only gate results. Default false. */
  gateOnly?: boolean;
}

/**
 * Run gate validator for the opportunity type, then optionally LLM:
 * - gate_passed → LLM decides real_issue vs false_positive.
 * - real_issue → LLM validates that the suggested fix makes sense (using opportunities/<type>/context.md when present).
 * Returns one ValidationResult per suggestion; real_issue results may include fixValidated and fixExplanation.
 */
export async function runValidation(
  suggestions: Suggestion[],
  options: RunValidationOptions
): Promise<ValidationResult[]> {
  const reg = getOpportunityType(options.opportunityTypeId);
  if (!reg) {
    return suggestions.map((s) => ({
      suggestionId: s.id,
      validation_status: 'error',
      explanation: `Unknown opportunity type: ${options.opportunityTypeId}`,
    }));
  }

  const gateResults = await Promise.resolve(reg.validate(suggestions));
  const byId = new Map<string, ValidationResult>(
    gateResults.map((r) => [r.suggestionId, { ...r }])
  );

  if (options.gateOnly) {
    return suggestions.map((s) => byId.get(s.id)!);
  }

  if (options.opportunityTypeId === 'broken-internal-links') {
    for (const r of gateResults) {
      if (r.validation_status !== 'gate_passed') continue;
      const prev = byId.get(r.suggestionId);
      if (!prev) continue;
      byId.set(r.suggestionId, {
        ...prev,
        validation_status: 'false_positive',
        explanation: brokenInternalLinksVerifiedNotAnIssueExplanation(prev.explanation),
      });
    }
  }

  const llm = getDefaultLLM();
  if (!llm) {
    return suggestions.map((s) => byId.get(s.id)!);
  }

  const repoContext = await getContextForOpportunityType(options.opportunityTypeId);
  const llmRunbook = mergeRunbookForLlm(repoContext, options.runbook);

  const gatePassed = [...byId.values()].filter((r) => r.validation_status === 'gate_passed');

  if (gatePassed.length > 0) {
    const toSend = suggestions
      .filter((s) => byId.get(s.id)?.validation_status === 'gate_passed')
      .map((s) => enrichSuggestionWithGateArtifacts(s, byId.get(s.id)));
    const llmResults = await llm.validate(toSend, {
      opportunityTypeId: options.opportunityTypeId,
      opportunityTitle: options.opportunityTitle,
      runbook: llmRunbook,
    });
    for (const r of llmResults) {
      const prev = byId.get(r.suggestionId);
      byId.set(r.suggestionId, {
        ...prev,
        ...r,
        pageSourceSnippet: prev?.pageSourceSnippet,
      });
    }
  }

  const realIssuesAfterLlm = [...byId.values()].filter((r) => r.validation_status === 'real_issue');

  if (realIssuesAfterLlm.length > 0 && llm.validateFix) {
    const realIssueSuggestions = suggestions
      .filter((s) => {
        const r = byId.get(s.id);
        // Skip LLM fix validation when the gate already performed a mechanical check
        if (r?.validation_status === 'real_issue' && r.fixValidated !== undefined) return false;
        return r?.validation_status === 'real_issue';
      })
      .map((s) => enrichSuggestionWithGateArtifacts(s, byId.get(s.id)));
    if (realIssueSuggestions.length === 0) {
      return suggestions.map((s) => byId.get(s.id)!);
    }
    const fixResults = await llm.validateFix(realIssueSuggestions, {
      opportunityTypeId: options.opportunityTypeId,
      opportunityTitle: options.opportunityTitle,
      runbook: llmRunbook,
    });
    for (const f of fixResults) {
      const existing = byId.get(f.suggestionId);
      if (existing) {
        byId.set(f.suggestionId, {
          ...existing,
          fixValidated: f.fixValidated,
          fixExplanation: f.fixExplanation,
        });
      }
    }
  }

  return suggestions.map((s) => byId.get(s.id)!);
}
