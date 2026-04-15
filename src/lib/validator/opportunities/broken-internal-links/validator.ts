/**
 * Simplified gate validator for broken internal link (and backlink) opportunities.
 * 1. Checks that URL To is actually broken (non-2xx) → real_issue.
 * 2. If broken, checks that the suggested replacement URL works (2xx) → fixValidated.
 * URL From page fetching and Playwright are intentionally removed.
 */

import type { Suggestion, ValidationResult } from '@validator-shared/types';
import { validateSuggestionData } from '@validator-shared/schema';
import { getAbsoluteUrlTo, mergedSuggestionFields } from '@validator-shared/suggestion/brokenInternalLinks';
import dataSchema from './data-schema.json';

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Check whether a URL is broken by making a GET request.
 * HEAD is intentionally skipped: many servers (e.g. Adobe/CDN-hosted sites) return HTTP 200
 * for HEAD even when GET returns 404, causing false "link is working" results.
 */
async function checkUrl(url: string): Promise<{ status: number; working: boolean; finalUrl: string; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ASO-Validator/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    });
    // Consume body to avoid keeping connections open
    await response.arrayBuffer();
    const status = response.status;
    return { status, working: status >= 200 && status < 300, finalUrl: response.url || url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 0, working: false, finalUrl: url, error: msg.includes('abort') ? 'Request timed out' : msg };
  } finally {
    clearTimeout(timeout);
  }
}

/** Extract the first suggested replacement URL from suggestion fields. */
function getSuggestedUrl(suggestion: Suggestion): string | null {
  const rec = mergedSuggestionFields(suggestion);
  // Array fields first
  for (const key of ['urlsSuggested', 'urls_suggested']) {
    const v = rec[key];
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string' && (v[0] as string).trim()) {
      return (v[0] as string).trim();
    }
  }
  // Scalar fields
  for (const key of [
    'urlSuggested', 'url_suggested', 'aiSuggestion', 'ai_suggestion',
    'suggestionValue', 'replacementUrl', 'replacement_url',
  ]) {
    const v = rec[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** Resolve URL To to an absolute URL, handling absolute, protocol-relative, and relative forms. */
function resolveUrlTo(suggestion: Suggestion): string | null {
  const rec = mergedSuggestionFields(suggestion);
  for (const key of ['urlTo', 'url_to', 'brokenUrl', 'targetUrl', 'linkUrl', 'destinationUrl', 'toUrl', 'brokenHref', 'href', 'brokenLink']) {
    const v = rec[key];
    if (typeof v !== 'string' || !v.trim()) continue;
    const t = v.trim();
    try {
      if (/^https?:\/\//i.test(t)) return new URL(t).href;
      if (t.startsWith('//')) return new URL(`https:${t}`).href;
      // Relative: delegate to shared helper which resolves against urlFrom
      return getAbsoluteUrlTo(suggestion);
    } catch {
      return null;
    }
  }
  return null;
}

export async function validate(suggestions: Suggestion[]): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  for (const s of suggestions) {
    // 1. Schema validation
    const { valid, errors } = validateSuggestionData(s, dataSchema as object);
    if (!valid) {
      results.push({
        suggestionId: s.id,
        validation_status: 'invalid_data',
        explanation: errors.length
          ? errors.map((e) => `${e.instancePath}: ${e.message ?? 'invalid'}`).join('; ')
          : 'Suggestion data does not match broken-internal-links schema',
      });
      continue;
    }

    // 2. Resolve URL To
    const urlTo = resolveUrlTo(s);
    if (!urlTo) {
      results.push({
        suggestionId: s.id,
        validation_status: 'invalid_data',
        explanation: 'Missing or unresolvable URL To: set urlTo, url_to, brokenUrl, brokenHref, or another target field.',
      });
      continue;
    }

    // 3. Check whether URL To is actually broken
    const targetCheck = await checkUrl(urlTo);
    if (targetCheck.error) {
      results.push({
        suggestionId: s.id,
        validation_status: 'could_not_validate',
        explanation: `Could not reach URL To (${targetCheck.error}).`,
      });
      continue;
    }

    if (targetCheck.working) {
      // URL To responds 2xx — not broken
      results.push({
        suggestionId: s.id,
        validation_status: 'gate_passed',
        explanation: `✓ URL To returned HTTP ${targetCheck.status} — the link is working and this is not a broken-link issue.`,
      });
      continue;
    }

    // URL To is broken (non-2xx) → real_issue; check suggested replacement
    const brokenNote = `✗ URL To returned HTTP ${targetCheck.status} — the link is broken.`;

    const suggestedUrl = getSuggestedUrl(s);
    if (!suggestedUrl) {
      results.push({
        suggestionId: s.id,
        validation_status: 'real_issue',
        explanation: brokenNote,
        fixValidated: false,
        fixExplanation: '✗ No suggested replacement URL found in the suggestion data.',
      });
      continue;
    }

    const fixCheck = await checkUrl(suggestedUrl);
    const fixWorking = !fixCheck.error && fixCheck.working;
    results.push({
      suggestionId: s.id,
      validation_status: 'real_issue',
      explanation: brokenNote,
      fixValidated: fixWorking,
      fixExplanation: fixCheck.error
        ? `✗ Suggested URL could not be checked (${fixCheck.error}).`
        : fixWorking
        ? `✓ Suggested URL returned HTTP ${fixCheck.status} — replacement is working.`
        : `✗ Suggested URL returned HTTP ${fixCheck.status} — replacement is also broken.`,
    });
  }

  return results;
}
