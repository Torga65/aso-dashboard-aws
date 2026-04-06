/**
 * Display strings for broken-internal-links suggestions (SpaceCat / ESS).
 * Fields may live on `suggestion.data` or on the suggestion object (e.g. Experience Success Studio UI).
 * Supports camelCase (`urlFrom`, `urlTo`) and snake_case (`url_from`, `url_to`).
 *
 * URL From column: ESS `Brokenlinks.js` stores full URLs; we show **hostname + path (+ query)** (not protocol).
 */

import type { Suggestion } from '@validator-shared/types';
import { getTrimmedPageUrlFromData } from './pageUrl';

const SUGGESTION_FIELD_SKIP = new Set([
  'id',
  'opportunityId',
  'siteId',
  'status',
  'type',
  'createdAt',
  'updatedAt',
  'data',
]);

/**
 * `data` merged with top-level suggestion fields (top-level wins) so API/UI shapes both work.
 */
export function mergedSuggestionFields(suggestion: Suggestion): Record<string, unknown> {
  const base =
    suggestion.data && typeof suggestion.data === 'object' && !Array.isArray(suggestion.data)
      ? { ...(suggestion.data as Record<string, unknown>) }
      : {};
  const top = suggestion as Record<string, unknown>;
  for (const [k, v] of Object.entries(top)) {
    if (SUGGESTION_FIELD_SKIP.has(k)) continue;
    if (v !== undefined) base[k] = v;
  }
  return base;
}

function pickString(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

const URL_FROM_KEYS = [
  'urlFrom',
  'url_from',
  'referringDomain',
  'referring_domain',
  'sourceUrl',
  'sourceURL',
  'sourceDomain',
  'sourceHost',
  'referrerDomain',
  'fromUrl',
] as const;

/**
 * Format a stored URL for the "URL From" column: `hostname` + pathname + search.
 * Root URL (`https://host/` or `https://host`) shows hostname only.
 */
export function formatUrlFromHostAndPath(raw: string): string {
  const t = raw.trim();
  if (!t) return '—';
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      const pathAndQuery = u.pathname + u.search;
      if (pathAndQuery === '/' || pathAndQuery === '') return u.hostname;
      return `${u.hostname}${pathAndQuery}`;
    } catch {
      return t;
    }
  }
  return t;
}

function pickRawUrlFrom(rec: Record<string, unknown>): string | undefined {
  return pickString(rec, [...URL_FROM_KEYS]);
}

/** URL From column: domain + path (ESS `urlFrom` / `url_from` are full page URLs). */
export function getUrlFromDisplay(suggestion: Suggestion): string {
  const rec = mergedSuggestionFields(suggestion);
  const raw = pickRawUrlFrom(rec);
  if (raw) return formatUrlFromHostAndPath(raw);
  const pageUrl = getTrimmedPageUrlFromData(rec);
  if (pageUrl) return formatUrlFromHostAndPath(pageUrl);
  return '—';
}

/** Prefer absolute `urlFrom` / `pageUrl` for Open in new tab. */
export function getOpenHrefForUrlFrom(suggestion: Suggestion): string | null {
  const rec = mergedSuggestionFields(suggestion);
  const raw = pickRawUrlFrom(rec);
  if (raw) {
    const t = raw.trim();
    if (/^https?:\/\//i.test(t)) return t;
  }
  const pageUrl = getTrimmedPageUrlFromData(rec);
  if (pageUrl && /^https?:\/\//i.test(pageUrl.trim())) return pageUrl.trim();
  const disp = getUrlFromDisplay(suggestion);
  if (!disp || disp === '—') return null;
  if (/^https?:\/\//i.test(disp)) return disp;
  return `https://${disp}`;
}

/** Absolute URL for the reported broken target (for validation / HTTP checks). */
export function getAbsoluteUrlTo(suggestion: Suggestion): string | null {
  const rec = mergedSuggestionFields(suggestion);
  const raw = pickString(rec, [
    'urlTo',
    'url_to',
    'brokenUrl',
    'targetUrl',
    'linkUrl',
    'destinationUrl',
    'toUrl',
    'brokenHref',
    'href',
    'brokenLink',
  ]);
  if (!raw) return null;
  const base = getOpenHrefForUrlFrom(suggestion);
  if (!base) return null;
  try {
    const t = raw.trim();
    if (/^https?:\/\//i.test(t)) return new URL(t).href;
    if (t.startsWith('//')) return new URL(`https:${t}`).href;
    return new URL(t, base).href;
  } catch {
    return null;
  }
}

/** Target of the broken link (absolute URL, or resolved from page + relative href). */
export function getUrlToDisplay(suggestion: Suggestion): string {
  const rec = mergedSuggestionFields(suggestion);
  const raw = pickString(rec, [
    'urlTo',
    'url_to',
    'brokenUrl',
    'targetUrl',
    'linkUrl',
    'destinationUrl',
    'toUrl',
    'brokenHref',
    'href',
    'brokenLink',
  ]);
  if (!raw) return '—';
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = getTrimmedPageUrlFromData(rec);
  if (base) {
    try {
      return new URL(raw, base).href;
    } catch {
      /* fall through */
    }
  }
  return raw;
}

/** URL to open for "URL To" cell. */
export function getOpenHrefForUrlTo(suggestion: Suggestion, display: string): string | null {
  const t = display.trim();
  if (!t || t === '—') return null;
  if (/^https?:\/\//i.test(t)) return t;
  const base = getTrimmedPageUrlFromData(mergedSuggestionFields(suggestion));
  if (base) {
    try {
      return new URL(t, base).href;
    } catch {
      return null;
    }
  }
  return null;
}
