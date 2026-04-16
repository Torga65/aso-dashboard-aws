/**
 * Gate validator for a11y-color-contrast opportunities.
 *
 * Each suggestion contains:
 *   data.url              — page URL to check
 *   data.issues[]         — one or more axe-core color-contrast violations
 *     issues[].htmlWithIssues[].target_selector  — CSS selector of the failing element
 *     issues[].failureSummary                    — human-readable description
 *     issues[].wcagLevel                         — e.g. "AA"
 *
 * Validation logic (mirrors validate_a11y_color_contrast_suggestions.py):
 *   1. Navigate to the page with headless Chromium.
 *   2. For each CSS selector, read computed color + effective background-color
 *      (traversing up the DOM past transparent ancestors).
 *   3. Calculate the WCAG 2.1 contrast ratio.
 *   4. Compare against the AA threshold: 4.5:1 normal text, 3.0:1 large text.
 *   5. Suggestion outcome:
 *        real_issue         — at least one element is still failing
 *        false_positive     — all elements now pass (issue fixed on the live page)
 *        could_not_validate — page failed to load, or no selectors were found in DOM
 *        invalid_data       — suggestion.data doesn't match the expected schema
 */

import type { Browser } from 'playwright';
import type { Suggestion, ValidationResult } from '@validator-shared/types';
import { validateSuggestionData } from '@validator-shared/schema';
import { launchChromiumForValidation } from '@validator-shared/suggestion/playwrightRenderedPage';
import dataSchema from './data-schema.json';

// ─── WCAG 2.1 contrast math ────────────────────────────────────────────────

function linearize(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function wcagContrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = relativeLuminance(...fg);
  const l2 = relativeLuminance(...bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Parse 'rgb(R, G, B)' or 'rgba(R, G, B, A)' → [R, G, B] or null. */
function parseRgb(css: string): [number, number, number] | null {
  const m = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
}

/** WCAG AA threshold: 3.0 for large text (≥24 px normal / ≥18.67 px bold), 4.5 otherwise. */
function wcagThreshold(fontSizePx: number, fontWeight: number): number {
  if (fontSizePx >= 24 || (fontSizePx >= 18.67 && fontWeight >= 700)) return 3.0;
  return 4.5;
}

// ─── Per-selector result ───────────────────────────────────────────────────

interface SelectorResult {
  selector: string;
  found: boolean;
  ratio?: number;
  threshold?: number;
  /** true = still failing, false = resolved, undefined = could not parse colors */
  stillFailing?: boolean;
  details: string;
}

// ─── Suggestion data shape ─────────────────────────────────────────────────

interface HtmlWithIssue {
  target_selector?: string;
  [key: string]: unknown;
}

interface ContrastIssue {
  htmlWithIssues?: HtmlWithIssue[];
  failureSummary?: string;
  wcagLevel?: string;
  [key: string]: unknown;
}

interface ContrastData {
  url: string;
  issues: ContrastIssue[];
  [key: string]: unknown;
}

// ─── Browser-side contrast check ──────────────────────────────────────────

const PAGE_NAV_TIMEOUT_MS = 45_000;
const PAGE_SETTLE_MS = 2_000;

/**
 * Use Playwright's page.evaluate to read the computed color + effective
 * background-color for a CSS selector, then compute WCAG contrast ratio
 * in Node and return a SelectorResult.
 */
async function checkSelector(
  page: import('playwright').Page,
  selector: string
): Promise<SelectorResult> {
  let info: { color: string; bg: string; fontSizePx: number; fontWeight: number } | null;

  try {
    info = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;

      const cs = window.getComputedStyle(el);

      // Walk up the DOM to find the first non-transparent background.
      let cur: Element | null = el;
      let bg = '';
      while (cur && cur.tagName !== 'HTML') {
        const bgCur = window.getComputedStyle(cur).backgroundColor;
        if (bgCur && bgCur !== 'rgba(0, 0, 0, 0)' && bgCur !== 'transparent') {
          bg = bgCur;
          break;
        }
        cur = cur.parentElement;
      }
      if (!bg) {
        bg = window.getComputedStyle(document.body).backgroundColor || 'rgb(255, 255, 255)';
      }

      return {
        color: cs.color,
        bg,
        fontSizePx: parseFloat(cs.fontSize) || 16,
        fontWeight: parseInt(cs.fontWeight, 10) || 400,
      };
    }, selector);
  } catch (e) {
    return {
      selector,
      found: false,
      details: `Evaluate error: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`,
    };
  }

  if (!info) {
    return { selector, found: false, details: 'Element not found in DOM' };
  }

  const fg = parseRgb(info.color);
  const bg = parseRgb(info.bg);

  if (!fg || !bg) {
    return {
      selector,
      found: true,
      details: `Could not parse computed colors — fg: ${info.color}, bg: ${info.bg}`,
    };
  }

  const threshold = wcagThreshold(info.fontSizePx, info.fontWeight);
  const ratio = Math.round(wcagContrastRatio(fg, bg) * 100) / 100;
  const stillFailing = ratio < threshold;

  return {
    selector,
    found: true,
    ratio,
    threshold,
    stillFailing,
    details: stillFailing
      ? `Failing: ratio ${ratio}:1 < ${threshold}:1 threshold (fg=${info.color}, bg=${info.bg})`
      : `Resolved: ratio ${ratio}:1 ≥ ${threshold}:1 threshold (fg=${info.color}, bg=${info.bg})`,
  };
}

// ─── Main validator ────────────────────────────────────────────────────────

export async function validate(suggestions: Suggestion[]): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  let browser: Browser | undefined;

  try {
    for (const s of suggestions) {
      // 1. Schema check
      const { valid, errors } = validateSuggestionData(s, dataSchema as object);
      if (!valid) {
        const explanation = errors.length
          ? errors.map((e) => `${e.instancePath}: ${e.message ?? 'invalid'}`).join('; ')
          : 'Suggestion data does not match a11y-color-contrast schema';
        results.push({ suggestionId: s.id, validation_status: 'invalid_data', explanation });
        continue;
      }

      const data = s.data as ContrastData;
      const { url, issues } = data;

      // 2. Collect CSS selectors from all issues
      const selectors: string[] = issues.flatMap((issue) =>
        (issue.htmlWithIssues ?? [])
          .map((h) => h.target_selector?.trim() ?? '')
          .filter(Boolean)
      );

      if (selectors.length === 0) {
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation: 'No CSS selectors in suggestion data (issues[].htmlWithIssues[].target_selector is empty or missing)',
        });
        continue;
      }

      // 3. Launch browser once for this batch
      if (!browser) {
        browser = await launchChromiumForValidation();
      }

      // 4. Navigate to page
      const page = await browser.newPage({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ASO-Validator/1.0',
      });

      let pageOk = false;
      try {
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: PAGE_NAV_TIMEOUT_MS,
        });
        // Allow JS-rendered styles to settle
        await new Promise<void>((resolve) => setTimeout(resolve, PAGE_SETTLE_MS));
        pageOk = !response || response.status() < 400;
      } catch (e) {
        const msg = e instanceof Error ? e.message.slice(0, 120) : String(e);
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation: `Could not load page "${url}": ${msg}`,
        });
        await page.close();
        continue;
      }

      if (!pageOk) {
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation: `Page "${url}" returned a non-2xx status`,
        });
        await page.close();
        continue;
      }

      // 5. Check each selector
      const selectorResults: SelectorResult[] = [];
      for (const selector of selectors) {
        selectorResults.push(await checkSelector(page, selector));
      }
      await page.close();

      // 6. Aggregate results
      const found = selectorResults.filter((r) => r.found);

      if (found.length === 0) {
        const detail = selectorResults.map((r) => `"${r.selector}": ${r.details}`).join('; ');
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation: `None of the ${selectors.length} flagged element(s) were found in the live DOM. ${detail}`,
        });
        continue;
      }

      const stillFailing = found.filter((r) => r.stillFailing === true);
      const resolved = found.filter((r) => r.stillFailing === false);
      const undetermined = found.filter((r) => r.stillFailing === undefined);

      if (stillFailing.length > 0) {
        const summary = stillFailing
          .map((r) => `"${r.selector}" (${r.ratio}:1, threshold ${r.threshold}:1)`)
          .join('; ');
        results.push({
          suggestionId: s.id,
          validation_status: 'real_issue',
          explanation: `${stillFailing.length} of ${found.length} element(s) still fail WCAG AA contrast: ${summary}`,
        });
      } else if (resolved.length > 0 && undetermined.length === 0) {
        const summary = resolved.map((r) => `"${r.selector}" (${r.ratio}:1)`).join('; ');
        results.push({
          suggestionId: s.id,
          validation_status: 'false_positive',
          explanation: `All ${resolved.length} element(s) now meet WCAG AA contrast requirements: ${summary}`,
        });
      } else {
        // Mix of resolved + undetermined — report what we know
        const detail = found.map((r) => `"${r.selector}": ${r.details}`).join('; ');
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation: `Contrast could not be fully determined for all elements: ${detail}`,
        });
      }
    }
  } finally {
    await browser?.close();
  }

  return results;
}
