/**
 * Hreflang opportunity validator.
 * Fetches pages, parses hreflang (Link header + HTML), validates issue type.
 * Logic aligned with aso-validating-tools/validate_hreflang_suggestions.py
 */

import type { Suggestion, ValidationResult } from '@validator-shared/types';
import { getIssueTypeId } from '@validator-shared/hreflang/issueType';

const VALID_LANGUAGE_CODES = new Set([
  'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'ja', 'zh', 'ko', 'ar',
  'hi', 'tr', 'pl', 'vi', 'th', 'sv', 'da', 'no', 'fi', 'cs', 'el', 'he',
  'hu', 'id', 'ms', 'ro', 'sk', 'uk', 'bg', 'hr', 'lt', 'lv', 'sl', 'et',
  'ca', 'eu', 'gl', 'af', 'sw', 'tl', 'x-default',
]);

interface HreflangTag {
  href: string;
  hreflang: string;
  source: string;
}

interface HreflangData {
  status: string;
  hreflang_tags: HreflangTag[];
  has_x_default: boolean;
  tag_count: number;
  final_url?: string;
  redirected?: boolean;
  error?: string;
  /** Raw HTML (truncated) for LLM verification when status is ok. */
  pageSourceSnippet?: string;
}

/** Cap HTML sent to the LLM (characters). */
const MAX_PAGE_SOURCE_SNIPPET_CHARS = 18_000;

function truncatePageSource(html: string): string {
  if (html.length <= MAX_PAGE_SOURCE_SNIPPET_CHARS) return html;
  return `${html.slice(0, MAX_PAGE_SOURCE_SNIPPET_CHARS)}\n\n… (truncated; page source exceeded ${MAX_PAGE_SOURCE_SNIPPET_CHARS} characters)`;
}

function getSuggestionValue(s: Suggestion): string {
  const d = s.data as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object') return '';
  const v = d.suggestionValue;
  return typeof v === 'string' ? v : '';
}

/**
 * Page URL to fetch: prefer SpaceCat's primary URL fields (the page under audit), then URLs from
 * markdown in suggestionValue. Using markdown first was wrong when tables listed alternate URLs.
 */
function getUrlsForSuggestion(s: Suggestion): string[] {
  const d = s.data as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object') return [];

  const direct = (d.pageUrl ?? d.url ?? d.canonicalUrl) as string | undefined;
  if (typeof direct === 'string' && direct.trim().startsWith('http')) {
    return [direct.trim()];
  }

  const fromMarkdown = parseUrlsFromMarkdownTable(getSuggestionValue(s));
  if (fromMarkdown.length > 0) return fromMarkdown;

  return [];
}

/** Extract URLs from markdown table in suggestionValue (same as Python). */
function parseUrlsFromMarkdownTable(suggestionValue: string): string[] {
  if (!suggestionValue) return [];
  const urls: string[] = [];
  const lines = suggestionValue.split('\n');
  for (const line of lines) {
    if (line.includes('|') && line.includes('http')) {
      const parts = line.split('|');
      for (const part of parts) {
        const t = part.trim();
        if (t.startsWith('http')) {
          urls.push(t);
          break;
        }
      }
    }
  }
  return urls;
}

/**
 * RFC 5988 Link header: `<URI>; param*; hreflang=...` — hreflang is not always immediately after `>`.
 * @internal Exported for unit tests.
 */
export function parseHreflangFromLinkHeader(linkHeader: string): HreflangTag[] {
  const hreflangTags: HreflangTag[] = [];
  if (!linkHeader?.trim()) return hreflangTags;

  let searchStart = 0;
  while (searchStart < linkHeader.length) {
    const lt = linkHeader.indexOf('<', searchStart);
    if (lt === -1) break;
    const gt = linkHeader.indexOf('>', lt);
    if (gt === -1) break;
    const uri = linkHeader.slice(lt + 1, gt).trim();
    const segEnd = linkHeader.indexOf(',', gt + 1);
    const segment = segEnd === -1 ? linkHeader.slice(gt + 1) : linkHeader.slice(gt + 1, segEnd);
    const hreflangMatch = /hreflang\s*=\s*["']?([^"'\s;,]+)/i.exec(segment);
    if (hreflangMatch && uri) {
      const lang = hreflangMatch[1].toLowerCase();
      hreflangTags.push({ href: uri, hreflang: lang, source: 'header' });
    }
    searchStart = segEnd === -1 ? linkHeader.length : segEnd + 1;
  }
  return hreflangTags;
}

/** Fetch page and extract hreflang tags (Link header + HTML via regex). */
async function getHreflangTags(url: string): Promise<HreflangData> {
  if (!url || typeof url !== 'string') {
    return { status: 'invalid_url', hreflang_tags: [], has_x_default: false, tag_count: 0, error: 'Invalid URL' };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ASO-Validator/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.status >= 400) {
      return {
        status: `http_error_${response.status}`,
        hreflang_tags: [],
        has_x_default: false,
        tag_count: 0,
        error: `HTTP ${response.status}`,
        final_url: response.url,
      };
    }

    const html = await response.text();
    const linkHeader = response.headers.get('Link') ?? '';
    const headerTags = parseHreflangFromLinkHeader(linkHeader);
    const hreflangTags: HreflangTag[] = [...headerTags];
    let hasXDefault = headerTags.some((t) => t.hreflang === 'x-default');

    // HTML: <link ...> with rel including alternate, href + hreflang
    const linkTagRegex = /<link\s[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkTagRegex.exec(html)) !== null) {
      const tag = m[0];
      const relMatch = /rel\s*=\s*["']?([^"'>]+)["']?/i.exec(tag);
      const relRaw = relMatch?.[1]?.toLowerCase() ?? '';
      const relTokens = relRaw.split(/\s+/).filter(Boolean);
      if (!relTokens.includes('alternate')) continue;
      const hrefMatch = /href\s*=\s*["']?([^"'\s>]+)["']?/i.exec(tag);
      const hreflangMatch = /hreflang\s*=\s*["']?([^"'\s>]+)["']?/i.exec(tag);
      if (hrefMatch && hreflangMatch) {
        const href = hrefMatch[1].trim();
        const hreflang = hreflangMatch[1].toLowerCase();
        hreflangTags.push({ href, hreflang, source: 'html' });
        if (hreflang === 'x-default') hasXDefault = true;
      }
    }

    return {
      status: 'ok',
      hreflang_tags: hreflangTags,
      has_x_default: hasXDefault,
      tag_count: hreflangTags.length,
      final_url: response.url,
      redirected: response.url !== url,
      pageSourceSnippet: truncatePageSource(html),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('abort') ? 'timeout' : 'request_error';
    return {
      status,
      hreflang_tags: [],
      has_x_default: false,
      tag_count: 0,
      error: message.slice(0, 100),
    };
  }
}

/** Validate one hreflang issue (same outcomes as Python). */
function validateHreflangIssue(
  url: string,
  issueType: string,
  hreflangData: HreflangData
): { is_valid_issue: boolean | null; details: string } {
  if (hreflangData.status !== 'ok') {
    return {
      is_valid_issue: null,
      details: `Could not validate: ${hreflangData.error ?? hreflangData.status}`,
    };
  }

  if (issueType === 'missing-x-default') {
    if (!hreflangData.has_x_default) {
      const n = hreflangData.tag_count;
      return {
        is_valid_issue: true,
        details:
          n === 0
            ? 'Real issue: No x-default hreflang tag found (no hreflang tags found in Link header or HTML)'
            : `Real issue: No x-default hreflang tag found (found ${n} other hreflang tag(s))`,
      };
    }
    const xDefaultTag = hreflangData.hreflang_tags.find((t) => t.hreflang === 'x-default');
    return {
      is_valid_issue: false,
      details: `FALSE POSITIVE: x-default tag exists pointing to ${xDefaultTag?.href ?? 'unknown'}`,
    };
  }

  if (issueType === 'missing-hreflang') {
    if (hreflangData.hreflang_tags.length === 0) {
      return { is_valid_issue: true, details: 'Real issue: No hreflang tags found on page' };
    }
    const langs = [...new Set(hreflangData.hreflang_tags.map((t) => t.hreflang))];
    return {
      is_valid_issue: false,
      details: `FALSE POSITIVE: Found ${hreflangData.hreflang_tags.length} hreflang tags: ${langs.join(', ')}`,
    };
  }

  if (issueType === 'invalid-language-code') {
    if (hreflangData.hreflang_tags.length === 0) {
      return {
        is_valid_issue: null,
        details:
          'No hreflang tags were found on the page (header or HTML), so language codes cannot be checked.',
      };
    }
    const invalid: string[] = [];
    for (const tag of hreflangData.hreflang_tags) {
      const base = tag.hreflang.split('-')[0];
      if (!VALID_LANGUAGE_CODES.has(base) && base !== 'x') invalid.push(tag.hreflang);
    }
    if (invalid.length > 0) {
      return {
        is_valid_issue: true,
        details: `Real issue: Invalid language codes: ${invalid.join(', ')}`,
      };
    }
    return { is_valid_issue: false, details: 'FALSE POSITIVE: All language codes are valid' };
  }

  if (issueType === 'missing-reciprocal') {
    return {
      is_valid_issue: null,
      details:
        'Reciprocal hreflang requires checking pairs of URLs; use the page\'s alternate links and partner URLs manually.',
    };
  }

  if (issueType === 'hreflang-redirect') {
    if (hreflangData.redirected) {
      return {
        is_valid_issue: true,
        details: `Real issue: Page redirected to ${hreflangData.final_url ?? url}`,
      };
    }
    return {
      is_valid_issue: null,
      details: 'Cannot fully validate redirect issues without checking all hreflang URLs',
    };
  }

  // Issue type unknown (e.g. no suggestionValue): still report what we found so user knows the request worked
  const tagInfo =
    hreflangData.tag_count === 0
      ? 'No hreflang tags found on page.'
      : `Found ${hreflangData.tag_count} hreflang tag(s), x-default: ${hreflangData.has_x_default ? 'yes' : 'no'}.`;
  return {
    is_valid_issue: null,
    details: `Page fetched successfully. ${tagInfo} Issue type could not be determined (suggestionValue not provided or not recognized). To get a real-issue/false-positive result, ensure the suggestion includes markdown content describing the issue (e.g. "missing x-default", "missing hreflang").`,
  };
}

/** Run hreflang validation for all suggestions (one result per suggestion, first URL used). */
export async function validate(suggestions: Suggestion[]): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  for (const s of suggestions) {
    const urls = getUrlsForSuggestion(s);
    const issueType = getIssueTypeId(s);
    const url = urls[0] ?? '';

    if (!url) {
      results.push({
        suggestionId: s.id,
        validation_status: 'error',
        explanation: 'No URL found in suggestion data',
      });
      continue;
    }

    const hreflangData = await getHreflangTags(url);
    const validation = validateHreflangIssue(url, issueType, hreflangData);

    if (hreflangData.status !== 'ok') {
      results.push({
        suggestionId: s.id,
        validation_status: 'could_not_validate',
        explanation: validation.details,
      });
      continue;
    }

    // Defer real vs false positive to the LLM using live page HTML (gate_passed + pageSourceSnippet).
    // Deterministic checks above are hints only (see explanation).
    results.push({
      suggestionId: s.id,
      validation_status: 'gate_passed',
      explanation: validation.details,
      pageSourceSnippet: hreflangData.pageSourceSnippet,
    });
  }

  return results;
}
