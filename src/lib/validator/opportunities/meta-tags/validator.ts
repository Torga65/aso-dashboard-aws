/**
 * Validator for meta-tags opportunities.
 *
 * Supports two issue kinds:
 *
 *   length    — tag is too short or too long for SEO best practice
 *   duplicate — more than one instance of the tag exists on the page
 *
 * Length validation (three sequential checks):
 *   1. Stored value (data.tagContent / data.currentValue) — must be out of spec
 *      to confirm the issue. Within spec → false_positive.
 *   2. Live page vs stored value — must match. If they differ the page has
 *      changed and the suggestion is stale → could_not_validate.
 *   3. AI suggestion (data.aiSuggestion) — must be within spec → fixValidated.
 *
 * Duplicate validation:
 *   Fetch the live page and count how many instances of the tag exist.
 *   count > 1 → real_issue | count == 1 → false_positive | count == 0 → could_not_validate
 *   AI suggestion is still validated for length quality.
 *
 * SEO thresholds (length):
 *   <title>                   40–60 characters
 *   <meta name="description"> 140–160 characters
 *   <h1>                      ≤ 70 characters
 *
 * Issue type detection (data.issue / data.issueType / data.type):
 *   Contains "duplicate"  → duplicate kind
 *   Contains "title"      → title tag
 *   Contains "description"→ meta description tag
 *   Contains "h1" or "heading" → h1 tag
 */

import type { Suggestion, ValidationResult } from '@validator-shared/types';
import { fetchPageHtml } from '@validator-shared/suggestion/brokenLinkMatch';

// ─── SEO thresholds ────────────────────────────────────────────────────────

const TITLE_MIN = 40;
const TITLE_MAX = 60;
const DESC_MIN  = 140;
const DESC_MAX  = 160;
const H1_MAX    = 70;

type TagType    = 'title' | 'description' | 'h1';
type IssueKind  = 'length' | 'duplicate';

interface DetectedIssue {
  tagType:   TagType;
  issueKind: IssueKind;
}

// ─── Issue detection ───────────────────────────────────────────────────────

function detectIssue(data: Record<string, unknown>): DetectedIssue | null {
  const candidates = [data.issue, data.issueType, data.type]
    .filter((v) => typeof v === 'string')
    .map((v) => (v as string).toLowerCase());

  for (const c of candidates) {
    const isDuplicate = c.includes('duplicate') || c.includes('duplicat');

    let tagType: TagType | null = null;
    if (c.includes('title') || c.includes('page-title') || c.includes('page_title')) {
      tagType = 'title';
    } else if (c.includes('description') || c.includes('meta-description') || c.includes('meta_description')) {
      tagType = 'description';
    } else if (c.includes('h1') || c.includes('heading')) {
      tagType = 'h1';
    }

    if (tagType) return { tagType, issueKind: isDuplicate ? 'duplicate' : 'length' };
  }
  return null;
}

// ─── HTML extraction — single value ───────────────────────────────────────

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

function extractMetaDescription(html: string): string | null {
  const patterns = [
    /<meta\s+name=["']description["']\s+content=["']([^"']*)["'][^>]*>/i,
    /<meta\s+content=["']([^"']*)["']\s+name=["']description["'][^>]*>/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

function extractH1(html: string): string | null {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function extractSingle(html: string, tagType: TagType): { value: string | null; label: string } {
  if (tagType === 'title')       return { value: extractTitle(html),           label: '<title>' };
  if (tagType === 'description') return { value: extractMetaDescription(html), label: '<meta name="description">' };
  return                                { value: extractH1(html),              label: '<h1>' };
}

// ─── HTML extraction — count occurrences ──────────────────────────────────

function countOccurrences(html: string, tagType: TagType): number {
  if (tagType === 'title') {
    return (html.match(/<title\b[^>]*>/gi) ?? []).length;
  }
  if (tagType === 'description') {
    // Match <meta> tags that carry name="description" in any attribute order
    return (html.match(/<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*>/gi) ?? []).length;
  }
  // h1
  return (html.match(/<h1\b[^>]*>/gi) ?? []).length;
}

// ─── Threshold check ───────────────────────────────────────────────────────

interface ThresholdResult {
  passing: boolean;
  reason:  string;
}

function checkThreshold(tagType: TagType, value: string): ThresholdResult {
  const len = value.length;

  if (tagType === 'title') {
    if (len < TITLE_MIN) return { passing: false, reason: `title too short: ${len} chars (min ${TITLE_MIN})` };
    if (len > TITLE_MAX) return { passing: false, reason: `title too long: ${len} chars (max ${TITLE_MAX})` };
    return { passing: true, reason: `title length OK: ${len} chars (${TITLE_MIN}–${TITLE_MAX})` };
  }

  if (tagType === 'description') {
    if (len < DESC_MIN) return { passing: false, reason: `description too short: ${len} chars (min ${DESC_MIN})` };
    if (len > DESC_MAX) return { passing: false, reason: `description too long: ${len} chars (max ${DESC_MAX})` };
    return { passing: true, reason: `description length OK: ${len} chars (${DESC_MIN}–${DESC_MAX})` };
  }

  if (len === 0) return { passing: false, reason: 'h1 is empty' };
  if (len > H1_MAX) return { passing: false, reason: `h1 too long: ${len} chars (max ${H1_MAX})` };
  return { passing: true, reason: `h1 length OK: ${len} chars (≤ ${H1_MAX})` };
}

// ─── Value normalisation for comparison ───────────────────────────────────

function normalise(v: string): string {
  return v.trim().replace(/\s+/g, ' ').toLowerCase();
}

// ─── URL extraction ────────────────────────────────────────────────────────

function getPageUrl(data: Record<string, unknown>): string | null {
  const raw = data.url ?? data.pageUrl ?? data.page;
  if (typeof raw !== 'string') return null;
  return raw.trim() || null;
}

// ─── AI suggestion check ──────────────────────────────────────────────────

function checkSuggestion(
  data: Record<string, unknown>,
  tagType: TagType,
): { fixValidated: boolean | undefined; fixExplanation: string | undefined } {
  const aiRaw = typeof data.aiSuggestion === 'string' ? data.aiSuggestion.trim() : '';
  if (!aiRaw) return { fixValidated: undefined, fixExplanation: undefined };
  const r = checkThreshold(tagType, aiRaw);
  return {
    fixValidated:  r.passing,
    fixExplanation: r.passing
      ? `✓ Suggested value: ${r.reason}. Value: "${aiRaw}"`
      : `✗ Suggested value: ${r.reason}. Value: "${aiRaw}"`,
  };
}

// ─── Main validator ────────────────────────────────────────────────────────

export async function validate(suggestions: Suggestion[]): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  for (const s of suggestions) {
    const data = (s.data ?? {}) as Record<string, unknown>;

    // ── 0. Pre-flight ──────────────────────────────────────────────────────

    const pageUrl = getPageUrl(data);
    if (!pageUrl) {
      results.push({
        suggestionId: s.id,
        validation_status: 'invalid_data',
        explanation: 'No page URL in suggestion data (expected data.url, data.pageUrl, or data.page).',
      });
      continue;
    }

    const detected = detectIssue(data);
    if (!detected) {
      results.push({
        suggestionId: s.id,
        validation_status: 'could_not_validate',
        explanation:
          'Cannot determine tag type. Expected data.issue / data.issueType / data.type to contain ' +
          `"title", "description", or "h1" (optionally prefixed with "duplicate"). ` +
          `Got: issue=${JSON.stringify(data.issue)}, issueType=${JSON.stringify(data.issueType)}, type=${JSON.stringify(data.type)}.`,
      });
      continue;
    }

    const { tagType, issueKind } = detected;
    const { fixValidated, fixExplanation } = checkSuggestion(data, tagType);

    // ══════════════════════════════════════════════════════════════════════
    // DUPLICATE path
    // ══════════════════════════════════════════════════════════════════════

    if (issueKind === 'duplicate') {
      const fetched = await fetchPageHtml(pageUrl);
      if (!fetched.ok) {
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation: `✗ Live page: could not be fetched — ${fetched.error ?? `HTTP ${fetched.status}`}.`,
          fixValidated,
          fixExplanation,
        });
        continue;
      }

      const { label } = extractSingle(fetched.html, tagType);
      const count = countOccurrences(fetched.html, tagType);

      if (count === 0) {
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation: `✗ Live page: no ${label} tag found — cannot check for duplicates.`,
          fixValidated,
          fixExplanation,
        });
        continue;
      }

      if (count > 1) {
        results.push({
          suggestionId: s.id,
          validation_status: 'real_issue',
          explanation: `✓ Live page: ${count} ${label} tags found — duplicate confirmed.`,
          fixValidated,
          fixExplanation,
        });
      } else {
        results.push({
          suggestionId: s.id,
          validation_status: 'false_positive',
          explanation: `✗ Live page: only 1 ${label} tag found — no duplicate exists.`,
          fixValidated,
          fixExplanation,
        });
      }
      continue;
    }

    // ══════════════════════════════════════════════════════════════════════
    // LENGTH path
    // ══════════════════════════════════════════════════════════════════════

    // ── 1. Stored value check ──────────────────────────────────────────────

    const storedRaw =
      typeof data.tagContent    === 'string' ? data.tagContent :
      typeof data.currentValue  === 'string' ? data.currentValue : null;

    if (storedRaw === null || !storedRaw.trim()) {
      // No stored value — fall back to live-page threshold check only
      const fetched = await fetchPageHtml(pageUrl);
      if (!fetched.ok) {
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation: `No stored value; page fetch also failed: ${fetched.error ?? `HTTP ${fetched.status}`}.`,
          fixValidated,
          fixExplanation,
        });
        continue;
      }
      const { value: liveVal, label } = extractSingle(fetched.html, tagType);
      if (liveVal === null) {
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation: `No stored value; ${label} tag not found on live page.`,
          fixValidated,
          fixExplanation,
        });
        continue;
      }
      const liveCheck = checkThreshold(tagType, liveVal);
      results.push({
        suggestionId: s.id,
        validation_status: liveCheck.passing ? 'false_positive' : 'real_issue',
        explanation: liveCheck.passing
          ? `✓ Live page: ${liveCheck.reason}. (No stored value.) Value: "${liveVal}"`
          : `✗ Live page: ${liveCheck.reason}. (No stored value.) Value: "${liveVal}"`,
        fixValidated,
        fixExplanation,
      });
      continue;
    }

    const storedValue = storedRaw.trim();
    const storedCheck = checkThreshold(tagType, storedValue);
    // ✓ = stored value IS out of spec → issue confirmed (suggestion is valid to apply)
    // ✗ = stored value is within spec → issue doesn't exist in captured data → false positive
    const storedNote = storedCheck.passing
      ? `✗ Stored value: ${storedCheck.reason} — issue not confirmed. Value: "${storedValue}"`
      : `✓ Stored value: ${storedCheck.reason} — issue confirmed. Value: "${storedValue}"`;

    if (storedCheck.passing) {
      results.push({
        suggestionId: s.id,
        validation_status: 'false_positive',
        explanation: storedNote,
        fixValidated,
        fixExplanation,
      });
      continue;
    }

    // ── 2. Live page vs stored value comparison ────────────────────────────

    const fetched = await fetchPageHtml(pageUrl);
    if (!fetched.ok) {
      results.push({
        suggestionId: s.id,
        validation_status: 'could_not_validate',
        explanation:
          `${storedNote} | ✗ Live page: could not be fetched — ${fetched.error ?? `HTTP ${fetched.status}`}.`,
        fixValidated,
        fixExplanation,
      });
      continue;
    }

    const { value: liveValue, label: tagLabel } = extractSingle(fetched.html, tagType);
    if (liveValue === null) {
      results.push({
        suggestionId: s.id,
        validation_status: 'could_not_validate',
        explanation:
          `${storedNote} | ✗ Live page: ${tagLabel} tag not found in HTML.`,
        fixValidated,
        fixExplanation,
      });
      continue;
    }

    if (normalise(liveValue) !== normalise(storedValue)) {
      results.push({
        suggestionId: s.id,
        validation_status: 'could_not_validate',
        explanation:
          `${storedNote} | ✗ Live page differs from stored value — page has changed. ` +
          `Live value: "${liveValue}". Suggestion may be stale.`,
        fixValidated,
        fixExplanation,
      });
      continue;
    }

    results.push({
      suggestionId: s.id,
      validation_status: 'real_issue',
      explanation:
        `${storedNote} | ✓ Live page matches stored value: "${liveValue}"`,
      fixValidated,
      fixExplanation,
    });
  }

  return results;
}
