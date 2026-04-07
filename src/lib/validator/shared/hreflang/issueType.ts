/**
 * Derive hreflang issue type from SpaceCat suggestion data.
 * SpaceCat may put the issue description in various fields (title, description, suggestionValue, etc.).
 * We collect all string values from the suggestion and detect the issue type from that text.
 */

import type { Suggestion } from '@validator-shared/types';

/** Keys we explicitly check first (common SpaceCat / API names). */
const PREFERRED_KEYS = [
  'title',
  'description',
  'suggestionValue',
  'recommendation',
  'issue',
  'solution',
  'issueTitle',
  'issueDescription',
  'finding',
  'findingType',
  'message',
  'detail',
  'summary',
  'label',
  'name',
];

/**
 * Collect all text from the suggestion that might describe the issue.
 * Checks data.* and top-level suggestion fields; also iterates all data keys so we don't miss any.
 */
export function getIssueDescriptionText(s: Suggestion): string {
  const parts: string[] = [];
  const seen = new Set<string>();

  function add(v: unknown): void {
    if (typeof v === 'string' && v.trim() && !seen.has(v.trim())) {
      seen.add(v.trim());
      parts.push(v.trim());
    }
  }

  const d = s.data as Record<string, unknown> | undefined;
  if (d && typeof d === 'object') {
    for (const key of PREFERRED_KEYS) {
      add(d[key]);
    }
    for (const key of Object.keys(d)) {
      if (PREFERRED_KEYS.includes(key)) continue;
      const v = d[key];
      add(v);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const k of Object.keys(v as Record<string, unknown>)) {
          add((v as Record<string, unknown>)[k]);
        }
      }
    }
  }
  add((s as Record<string, unknown>).title);
  add((s as Record<string, unknown>).description);

  return parts.join('\n');
}

/**
 * Detect issue type id from description text (for validation).
 */
export function detectIssueTypeFromText(issueText: string): string {
  if (!issueText || !issueText.trim()) return 'unknown';
  const lower = issueText.toLowerCase();

  // Reciprocal (before generic "redirect"; avoid matching bare "return")
  if (
    lower.includes('missing reciprocal') ||
    (lower.includes('reciprocal') &&
      (lower.includes('hreflang') || lower.includes('alternate') || lower.includes('return link')))
  ) {
    return 'missing-reciprocal';
  }
  if (lower.includes('redirect') && (lower.includes('hreflang') || lower.includes('alternate'))) {
    return 'hreflang-redirect';
  }

  // x-default before generic "missing hreflang"
  if (
    lower.includes('missing x-default') ||
    (lower.includes('x-default') &&
      (lower.includes('missing') ||
        lower.includes('no x-default') ||
        lower.includes('without x-default') ||
        lower.includes('add x-default')))
  ) {
    return 'missing-x-default';
  }

  if (lower.includes('missing hreflang') || lower.match(/\bno hreflang\b/)) {
    return 'missing-hreflang';
  }
  if ((lower.includes('invalid') || lower.includes('unsupported') || lower.includes('unknown')) && lower.includes('language')) {
    return 'invalid-language-code';
  }
  return 'unknown';
}

const ISSUE_TYPE_LABELS: Record<string, string> = {
  'missing-x-default': 'Missing x-default',
  'missing-hreflang': 'Missing hreflang',
  'invalid-language-code': 'Invalid language code',
  'missing-reciprocal': 'Missing reciprocal',
  'hreflang-redirect': 'Hreflang redirect',
  unknown: '—',
};

/**
 * Human-readable issue type label for display in the table.
 * Uses SpaceCat suggestion data (title, description, etc.) to derive the type.
 */
export function getIssueTypeLabel(s: Suggestion): string {
  const text = getIssueDescriptionText(s);
  const id = detectIssueTypeFromText(text);
  return ISSUE_TYPE_LABELS[id] ?? id;
}

/**
 * Issue type id for validation (missing-x-default, missing-hreflang, etc.).
 */
export function getIssueTypeId(s: Suggestion): string {
  const text = getIssueDescriptionText(s);
  return detectIssueTypeFromText(text);
}
