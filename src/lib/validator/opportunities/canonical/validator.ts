/**
 * Canonical opportunity validator.
 *
 * For each suggestion:
 *   1. Extracts check type from data.issue / data.issueType / data.checkType / data.type
 *   2. Fetches the live page at the affected URL
 *   3. Extracts <link rel="canonical"> href(s) from live HTML
 *   4. Returns real_issue / false_positive / could_not_validate by check type:
 *
 *      missing-canonical    — no canonical tag → real_issue; tag present → false_positive
 *      multiple-canonical   — >1 canonical tags → real_issue; ≤1 → false_positive
 *      non-self-referencing — canonical href ≠ page URL → real_issue; same → false_positive
 *      canonical-redirect   — canonical href redirects → real_issue; no redirect → false_positive
 *      (unknown)            — gate_passed → LLM decides
 *
 *   5. Validates fix: proposed canonical (data.aiSuggestion) must be reachable (2xx)
 */

import type { Suggestion, ValidationResult } from '@validator-shared/types';
import { fetchPageHtml, fetchUrlTargetWorking } from '@validator-shared/suggestion/brokenLinkMatch';

// ── Check type detection ─────────────────────────────────────────────────────

type CanonicalCheckType =
  | 'missing-canonical'
  | 'multiple-canonical'
  | 'non-self-referencing'
  | 'canonical-redirect'
  | 'unknown';

function detectCheckType(data: Record<string, unknown>): CanonicalCheckType {
  const candidates = [data.issue, data.issueType, data.checkType, data.type]
    .filter((v) => typeof v === 'string')
    .map((v) => (v as string).toLowerCase().replace(/[_\s]/g, '-'));

  for (const c of candidates) {
    if (c.includes('missing') || c === 'no-canonical' || c.includes('absent')) {
      return 'missing-canonical';
    }
    if (c.includes('multiple') || (c.includes('duplicate') && c.includes('canonical'))) {
      return 'multiple-canonical';
    }
    if (c.includes('redirect')) {
      return 'canonical-redirect';
    }
    if (
      c.includes('mismatch') ||
      c.includes('non-self') ||
      c.includes('nonself') ||
      c.includes('incorrect') ||
      c.includes('wrong-canonical') ||
      c.includes('invalid-canonical')
    ) {
      return 'non-self-referencing';
    }
  }
  return 'unknown';
}

// ── Field extraction ─────────────────────────────────────────────────────────

function getPageUrl(data: Record<string, unknown>): string | null {
  const raw = data.pageUrl ?? data.url ?? data.canonicalUrl;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function getStoredCanonical(data: Record<string, unknown>): string | null {
  const raw = data.canonicalUrl ?? data.canonical ?? data.currentCanonical;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function getAiSuggestion(data: Record<string, unknown>): string | null {
  const raw = data.aiSuggestion ?? data.urlSuggested ?? data.urlsSuggested;
  if (typeof raw === 'string') return raw.trim() || null;
  if (Array.isArray(raw)) {
    const first = raw.find((v) => typeof v === 'string');
    return typeof first === 'string' ? first.trim() || null : null;
  }
  return null;
}

// ── HTML extraction ───────────────────────────────────────────────────────────

function extractCanonicalUrls(html: string): string[] {
  const results: string[] = [];
  const linkTagRegex = /<link\s[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkTagRegex.exec(html)) !== null) {
    const tag = m[0];
    const relMatch = /rel\s*=\s*["']?([^"'\s>]+)["']?/i.exec(tag);
    if (!relMatch) continue;
    if (relMatch[1].toLowerCase() !== 'canonical') continue;
    const hrefMatch = /href\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (hrefMatch) results.push(hrefMatch[1].trim());
  }
  return results;
}

// ── URL normalisation ─────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `${u.protocol.toLowerCase()}//${u.hostname.toLowerCase()}${path}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

// ── Fix suggestion validation ─────────────────────────────────────────────────

async function validateFixSuggestion(
  aiSuggestion: string | null,
  pageUrl: string | null,
): Promise<{ fixValidated: boolean | undefined; fixExplanation: string | undefined }> {
  if (!aiSuggestion) return { fixValidated: undefined, fixExplanation: undefined };

  try {
    const u = new URL(aiSuggestion);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('non-http');
  } catch {
    return {
      fixValidated: false,
      fixExplanation: `✗ Proposed canonical is not a valid HTTP(S) URL: "${aiSuggestion}"`,
    };
  }

  const result = await fetchUrlTargetWorking(aiSuggestion);
  if (result.working) {
    const redirectNote =
      result.finalUrl && normalizeUrl(result.finalUrl) !== normalizeUrl(aiSuggestion)
        ? ` (redirects to ${result.finalUrl})`
        : '';
    const isSelfReferencing = pageUrl && normalizeUrl(aiSuggestion) === normalizeUrl(pageUrl);
    const selfNote = pageUrl
      ? isSelfReferencing
        ? ' — self-referencing ✓'
        : ` — NOT self-referencing (points to "${aiSuggestion}", page is "${pageUrl}")`
      : '';
    return {
      fixValidated: isSelfReferencing ? true : false,
      fixExplanation: isSelfReferencing
        ? `✓ Proposed canonical is reachable (HTTP ${result.status})${redirectNote}${selfNote}: "${aiSuggestion}"`
        : `✗ Proposed canonical is reachable but${selfNote}${redirectNote}: "${aiSuggestion}"`,
    };
  }
  return {
    fixValidated: false,
    fixExplanation: result.error
      ? `✗ Proposed canonical could not be reached — ${result.error}: "${aiSuggestion}"`
      : `✗ Proposed canonical returned HTTP ${result.status}: "${aiSuggestion}"`,
  };
}

// ── Main validator ────────────────────────────────────────────────────────────

const MAX_PAGE_SOURCE_SNIPPET_CHARS = 18_000;

export async function validate(suggestions: Suggestion[]): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  for (const s of suggestions) {
    const data = (s.data ?? {}) as Record<string, unknown>;

    // ── Pre-flight ───────────────────────────────────────────────────────────

    const pageUrl = getPageUrl(data);
    if (!pageUrl) {
      results.push({
        suggestionId: s.id,
        validation_status: 'invalid_data',
        explanation:
          'No page URL in suggestion data (expected data.pageUrl, data.url, or data.canonicalUrl).',
      });
      continue;
    }

    const checkType = detectCheckType(data);
    const storedCanonical = getStoredCanonical(data);
    const aiSuggestion = getAiSuggestion(data);
    const checkTypeLabel = `Check type: ${checkType}`;

    // ── Fetch live page ──────────────────────────────────────────────────────

    const fetched = await fetchPageHtml(pageUrl);
    if (!fetched.ok) {
      const { fixValidated, fixExplanation } = await validateFixSuggestion(aiSuggestion, pageUrl);
      results.push({
        suggestionId: s.id,
        validation_status: 'could_not_validate',
        explanation: `${checkTypeLabel} | ✗ Live page could not be fetched — ${fetched.error ?? `HTTP ${fetched.status}`}. URL: "${pageUrl}"`,
        fixValidated,
        fixExplanation,
      });
      continue;
    }

    const liveCanonicals = extractCanonicalUrls(fetched.html);
    const { fixValidated, fixExplanation } = await validateFixSuggestion(aiSuggestion, pageUrl);

    // ════════════════════════════════════════════════════════════════════════
    // MISSING CANONICAL
    // ════════════════════════════════════════════════════════════════════════

    if (checkType === 'missing-canonical') {
      if (liveCanonicals.length === 0) {
        results.push({
          suggestionId: s.id,
          validation_status: 'real_issue',
          explanation: `${checkTypeLabel} | ✓ Confirmed: no <link rel="canonical"> found on live page "${pageUrl}"`,
          fixValidated,
          fixExplanation,
        });
      } else {
        results.push({
          suggestionId: s.id,
          validation_status: 'false_positive',
          explanation: `${checkTypeLabel} | ✗ Canonical tag exists on live page: "${liveCanonicals[0]}"`,
          fixValidated,
          fixExplanation,
        });
      }
      continue;
    }

    // ════════════════════════════════════════════════════════════════════════
    // MULTIPLE CANONICAL
    // ════════════════════════════════════════════════════════════════════════

    if (checkType === 'multiple-canonical') {
      if (liveCanonicals.length === 0) {
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation: `${checkTypeLabel} | ✗ No canonical tag found on live page — cannot check for multiples.`,
          fixValidated,
          fixExplanation,
        });
      } else if (liveCanonicals.length > 1) {
        results.push({
          suggestionId: s.id,
          validation_status: 'real_issue',
          explanation: `${checkTypeLabel} | ✓ Confirmed: ${liveCanonicals.length} canonical tags found: ${liveCanonicals.join(', ')}`,
          fixValidated,
          fixExplanation,
        });
      } else {
        results.push({
          suggestionId: s.id,
          validation_status: 'false_positive',
          explanation: `${checkTypeLabel} | ✗ Only one canonical tag found: "${liveCanonicals[0]}"`,
          fixValidated,
          fixExplanation,
        });
      }
      continue;
    }

    // ════════════════════════════════════════════════════════════════════════
    // NON-SELF-REFERENCING / MISMATCH
    // ════════════════════════════════════════════════════════════════════════

    if (checkType === 'non-self-referencing') {
      if (liveCanonicals.length === 0) {
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation: `${checkTypeLabel} | ✗ No canonical tag found on live page "${pageUrl}" — cannot check if self-referencing.`,
          fixValidated,
          fixExplanation,
        });
        continue;
      }

      const liveCanonical = liveCanonicals[0];
      const finalPageUrl = fetched.finalUrl || pageUrl;

      // Detect stale data: stored canonical differs from live canonical
      if (storedCanonical && normalizeUrl(liveCanonical) !== normalizeUrl(storedCanonical)) {
        const isSelfNow = normalizeUrl(liveCanonical) === normalizeUrl(finalPageUrl);
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation:
            `${checkTypeLabel} | ✗ Live canonical "${liveCanonical}" differs from stored value "${storedCanonical}" — page may have changed. ` +
            (isSelfNow
              ? 'Live page is now self-referencing (issue may be resolved).'
              : 'Live canonical still points elsewhere.'),
          fixValidated,
          fixExplanation,
        });
        continue;
      }

      const isSelf = normalizeUrl(liveCanonical) === normalizeUrl(finalPageUrl);
      if (!isSelf) {
        results.push({
          suggestionId: s.id,
          validation_status: 'real_issue',
          explanation: `${checkTypeLabel} | ✓ Confirmed: canonical "${liveCanonical}" does not match page URL "${finalPageUrl}"`,
          fixValidated,
          fixExplanation,
        });
      } else {
        results.push({
          suggestionId: s.id,
          validation_status: 'false_positive',
          explanation: `${checkTypeLabel} | ✗ Canonical is self-referencing: "${liveCanonical}"`,
          fixValidated,
          fixExplanation,
        });
      }
      continue;
    }

    // ════════════════════════════════════════════════════════════════════════
    // CANONICAL REDIRECT
    // ════════════════════════════════════════════════════════════════════════

    if (checkType === 'canonical-redirect') {
      const canonicalToCheck = liveCanonicals[0] ?? storedCanonical;
      if (!canonicalToCheck) {
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation: `${checkTypeLabel} | ✗ No canonical URL available to check for redirect.`,
          fixValidated,
          fixExplanation,
        });
        continue;
      }

      const canonicalFetch = await fetchUrlTargetWorking(canonicalToCheck);
      if (!canonicalFetch.working && canonicalFetch.error) {
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation: `${checkTypeLabel} | ✗ Canonical URL "${canonicalToCheck}" could not be fetched — ${canonicalFetch.error}`,
          fixValidated,
          fixExplanation,
        });
        continue;
      }

      const redirected =
        canonicalFetch.finalUrl &&
        normalizeUrl(canonicalFetch.finalUrl) !== normalizeUrl(canonicalToCheck);
      if (redirected) {
        results.push({
          suggestionId: s.id,
          validation_status: 'real_issue',
          explanation: `${checkTypeLabel} | ✓ Confirmed: canonical "${canonicalToCheck}" redirects to "${canonicalFetch.finalUrl}"`,
          fixValidated,
          fixExplanation,
        });
      } else {
        results.push({
          suggestionId: s.id,
          validation_status: 'false_positive',
          explanation: `${checkTypeLabel} | ✗ Canonical "${canonicalToCheck}" does not redirect (HTTP ${canonicalFetch.status})`,
          fixValidated,
          fixExplanation,
        });
      }
      continue;
    }

    // ════════════════════════════════════════════════════════════════════════
    // UNKNOWN — self-referencing check + defer to LLM with live page HTML
    // ════════════════════════════════════════════════════════════════════════

    const finalPageUrl = fetched.finalUrl || pageUrl;
    const storedNote = storedCanonical
      ? `Stored canonical: "${storedCanonical}".`
      : 'No stored canonical value.';

    let liveNote: string;
    let selfRefNote: string;

    if (liveCanonicals.length === 0) {
      liveNote = 'No <link rel="canonical"> found on live page.';
      selfRefNote = '';
    } else {
      const liveCanonical = liveCanonicals[0];
      const isSelf = normalizeUrl(liveCanonical) === normalizeUrl(finalPageUrl);
      liveNote =
        liveCanonicals.length === 1
          ? `Live canonical: "${liveCanonical}".`
          : `${liveCanonicals.length} canonical tags on live page: ${liveCanonicals.join(', ')}.`;
      selfRefNote = isSelf
        ? ` Canonical is self-referencing ✓ (points to page URL).`
        : ` Canonical is NOT self-referencing — points to "${liveCanonical}" instead of "${finalPageUrl}".`;
    }

    results.push({
      suggestionId: s.id,
      validation_status: 'gate_passed',
      explanation: `${checkTypeLabel} | Page fetched. ${storedNote} ${liveNote}${selfRefNote}`,
      fixValidated,
      fixExplanation,
      pageSourceSnippet:
        fetched.html.length <= MAX_PAGE_SOURCE_SNIPPET_CHARS
          ? fetched.html
          : `${fetched.html.slice(0, MAX_PAGE_SOURCE_SNIPPET_CHARS)}\n\n… (truncated)`,
    });
  }

  return results;
}
