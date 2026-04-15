/**
 * Gate validator for a11y-assistive opportunities (axe-core source).
 *
 * Data shape mirrors a11y-color-contrast:
 *   data.url              — page to check
 *   data.issues[]         — one or more axe-core violations
 *     issues[].id                             — axe rule id (e.g. "aria-label", "button-name")
 *     issues[].htmlWithIssues[].target_selector — CSS selector of the failing element
 *     issues[].failureSummary                  — human-readable description
 *
 * For each selector, checks whether the element still lacks a valid accessible name
 * using the appropriate method for the axe rule:
 *
 *   aria-label / aria-required-attr / aria-input-field-name / similar
 *     → aria-label attribute, aria-labelledby (resolved), title
 *   button-name
 *     → aria-label, aria-labelledby, title, visible text content
 *   link-name
 *     → aria-label, aria-labelledby, title, visible text, alt (img child)
 *   image-alt / input-image-alt
 *     → alt attribute present and non-empty
 *   label / label-content-name-mismatch
 *     → <label for=id>, wrapping <label>, aria-label
 *   (all others)
 *     → full accessible name check covering all of the above
 *
 * Outcomes:
 *   real_issue         — at least one element still fails
 *   false_positive     — all elements now have valid accessible names
 *   could_not_validate — page failed to load, or no selectors found in DOM
 *   invalid_data       — suggestion.data doesn't match expected schema
 */

import type { Browser } from 'playwright';
import type { Suggestion, ValidationResult } from '@validator-shared/types';
import { validateSuggestionData } from '@validator-shared/schema';
import { launchChromiumForValidation } from '@validator-shared/suggestion/playwrightRenderedPage';
import dataSchema from './data-schema.json';

const PAGE_NAV_TIMEOUT_MS = 45_000;
const PAGE_SETTLE_MS = 2_000;

// ─── Axe rule → check category mapping ───────────────────────────────────────

type CheckCategory = 'aria-name' | 'button-name' | 'link-name' | 'image-alt' | 'label' | 'generic';

function ruleToCategory(ruleId: string): CheckCategory {
  const r = ruleId.toLowerCase();
  if (r === 'image-alt' || r === 'input-image-alt' || r === 'image-redundant-alt') return 'image-alt';
  if (r === 'button-name') return 'button-name';
  if (r === 'link-name') return 'link-name';
  if (r === 'label' || r === 'label-content-name-mismatch' || r === 'label-title-only') return 'label';
  if (
    r.startsWith('aria-') ||
    r === 'aria-input-field-name' ||
    r === 'aria-toggle-field-name' ||
    r === 'aria-meter-name' ||
    r === 'aria-progressbar-name' ||
    r === 'aria-required-attr' ||
    r === 'aria-tooltip-name'
  ) return 'aria-name';
  return 'generic';
}

// ─── Per-selector result ──────────────────────────────────────────────────────

interface SelectorResult {
  selector: string;
  found: boolean;
  passing: boolean | undefined; // undefined = could not determine
  details: string;
}

// ─── Browser-side accessible name check ──────────────────────────────────────

async function checkSelector(
  page: import('playwright').Page,
  selector: string,
  category: CheckCategory
): Promise<SelectorResult> {
  try {
    const result = await page.evaluate(
      ({ sel, cat }: { sel: string; cat: CheckCategory }): SelectorResult => {
        const el = document.querySelector(sel);
        if (!el) return { selector: sel, found: false, passing: undefined, details: 'Element not found in DOM' };

        const tag = el.tagName.toUpperCase();
        const role = (el.getAttribute('role') ?? '').toLowerCase();

        // ── Helpers ──────────────────────────────────────────────────────────

        function ariaLabel(): string {
          return (el!.getAttribute('aria-label') ?? '').trim();
        }

        function ariaLabelledByText(): string | null {
          const ids = (el!.getAttribute('aria-labelledby') ?? '').trim().split(/\s+/).filter(Boolean);
          if (ids.length === 0) return null;
          const texts = ids.map((id) => document.getElementById(id)?.textContent?.trim() ?? '').filter(Boolean);
          return texts.length > 0 ? texts.join(' ') : null;
        }

        function titleAttr(): string {
          return (el!.getAttribute('title') ?? '').trim();
        }

        function visibleText(): string {
          return (el!.textContent ?? '').trim();
        }

        function associatedLabelText(): string | null {
          const id = el!.getAttribute('id');
          if (id) {
            const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
            const t = label?.textContent?.trim();
            if (t) return t;
          }
          const wrap = el!.closest('label');
          return wrap?.textContent?.trim() || null;
        }

        // ── Category-specific checks ─────────────────────────────────────────

        if (cat === 'image-alt') {
          const alt = el.getAttribute('alt');
          if (alt === null) return { selector: sel, found: true, passing: false, details: 'Image missing alt attribute' };
          if (!alt.trim()) return { selector: sel, found: true, passing: false, details: 'Image has empty alt="" — not appropriate for a meaningful image' };
          return { selector: sel, found: true, passing: true, details: `Has alt="${alt.trim()}"` };
        }

        if (cat === 'label') {
          const al = ariaLabel();
          if (al) return { selector: sel, found: true, passing: true, details: `Has aria-label="${al}"` };
          const lbt = ariaLabelledByText();
          if (lbt) return { selector: sel, found: true, passing: true, details: `Has aria-labelledby → "${lbt}"` };
          const labelText = associatedLabelText();
          if (labelText) return { selector: sel, found: true, passing: true, details: `Has associated <label>: "${labelText}"` };
          const placeholder = (el.getAttribute('placeholder') ?? '').trim();
          if (placeholder) return { selector: sel, found: true, passing: false, details: `Only placeholder="${placeholder}" — not a valid accessible name; add a <label> or aria-label` };
          return { selector: sel, found: true, passing: false, details: `<${tag.toLowerCase()}> has no <label>, aria-label, or aria-labelledby` };
        }

        if (cat === 'button-name') {
          const al = ariaLabel();
          if (al) return { selector: sel, found: true, passing: true, details: `Has aria-label="${al}"` };
          const lbt = ariaLabelledByText();
          if (lbt) return { selector: sel, found: true, passing: true, details: `Has aria-labelledby → "${lbt}"` };
          const t = titleAttr();
          if (t) return { selector: sel, found: true, passing: true, details: `Has title="${t}"` };
          const text = visibleText();
          if (text) return { selector: sel, found: true, passing: true, details: `Has visible text: "${text.slice(0, 80)}"` };
          return { selector: sel, found: true, passing: false, details: 'Button has no accessible name (no aria-label, title, or text content)' };
        }

        if (cat === 'link-name') {
          const al = ariaLabel();
          if (al) return { selector: sel, found: true, passing: true, details: `Has aria-label="${al}"` };
          const lbt = ariaLabelledByText();
          if (lbt) return { selector: sel, found: true, passing: true, details: `Has aria-labelledby → "${lbt}"` };
          const t = titleAttr();
          if (t) return { selector: sel, found: true, passing: true, details: `Has title="${t}"` };
          const text = visibleText();
          if (text) return { selector: sel, found: true, passing: true, details: `Has visible text: "${text.slice(0, 80)}"` };
          // child img with alt
          const img = el.querySelector('img');
          if (img) {
            const alt = (img.getAttribute('alt') ?? '').trim();
            if (alt) return { selector: sel, found: true, passing: true, details: `Child <img alt="${alt}"> provides accessible name` };
          }
          return { selector: sel, found: true, passing: false, details: 'Link has no accessible name (no aria-label, title, text, or alt on child image)' };
        }

        // aria-name and generic: check all ARIA label mechanisms
        const al = ariaLabel();
        if (al) return { selector: sel, found: true, passing: true, details: `Has aria-label="${al}"` };

        const lbt = ariaLabelledByText();
        if (lbt !== null) {
          if (lbt) return { selector: sel, found: true, passing: true, details: `Has aria-labelledby → "${lbt}"` };
          return { selector: sel, found: true, passing: false, details: `Has aria-labelledby but referenced element(s) have no text — label is broken` };
        }

        const t = titleAttr();
        if (t) return { selector: sel, found: true, passing: true, details: `Has title="${t}"` };

        // For interactive elements, visible text is also valid
        const isInteractive = tag === 'BUTTON' || tag === 'A' || role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab';
        if (isInteractive) {
          const text = visibleText();
          if (text) return { selector: sel, found: true, passing: true, details: `Has visible text: "${text.slice(0, 80)}"` };
        }

        return {
          selector: sel,
          found: true,
          passing: false,
          details: `<${tag.toLowerCase()}${role ? ` role="${role}"` : ''}> has no aria-label, aria-labelledby, or title`,
        };
      },
      { sel: selector, cat: category }
    );
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : String(e);
    return { selector, found: false, passing: undefined, details: `Evaluate error: ${msg}` };
  }
}

// ─── Data types ───────────────────────────────────────────────────────────────

interface HtmlWithIssue {
  target_selector?: string;
  [key: string]: unknown;
}

interface AssistiveIssue {
  id?: string;
  description?: string;
  htmlWithIssues?: HtmlWithIssue[];
  failureSummary?: string;
  [key: string]: unknown;
}

interface AssistiveData {
  url: string;
  issues: AssistiveIssue[];
  [key: string]: unknown;
}

// ─── Main validator ───────────────────────────────────────────────────────────

export async function validate(suggestions: Suggestion[]): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  let browser: Browser | undefined;

  try {
    for (const s of suggestions) {
      // 1. Schema check
      const { valid, errors } = validateSuggestionData(s, dataSchema as object);
      if (!valid) {
        results.push({
          suggestionId: s.id,
          validation_status: 'invalid_data',
          explanation: errors.length
            ? errors.map((e) => `${e.instancePath}: ${e.message ?? 'invalid'}`).join('; ')
            : 'Suggestion data does not match a11y-assistive schema',
        });
        continue;
      }

      const data = s.data as AssistiveData;
      const { url, issues } = data;

      // 2. Collect (selector, category) pairs from all issues
      const checks: Array<{ selector: string; category: CheckCategory; ruleId: string }> = [];
      for (const issue of issues) {
        const ruleId = issue.id ?? issue.description ?? 'unknown';
        const category = ruleToCategory(ruleId);
        for (const h of issue.htmlWithIssues ?? []) {
          const sel = h.target_selector?.trim();
          if (sel) checks.push({ selector: sel, category, ruleId });
        }
      }

      if (checks.length === 0) {
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation: 'No CSS selectors found in issues[].htmlWithIssues[].target_selector',
        });
        continue;
      }

      // 3. Launch browser once
      if (!browser) {
        browser = await launchChromiumForValidation();
      }

      // 4. Navigate to page
      const page = await browser.newPage({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ASO-Validator/1.0',
      });

      try {
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: PAGE_NAV_TIMEOUT_MS,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, PAGE_SETTLE_MS));

        if (response && response.status() >= 400) {
          results.push({
            suggestionId: s.id,
            validation_status: 'could_not_validate',
            explanation: `Page "${url}" returned HTTP ${response.status()}`,
          });
          await page.close();
          continue;
        }
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

      // 5. Check each selector
      const selectorResults: SelectorResult[] = [];
      for (const { selector, category } of checks) {
        selectorResults.push(await checkSelector(page, selector, category));
      }
      await page.close();

      // 6. Aggregate
      const found = selectorResults.filter((r) => r.found);

      if (found.length === 0) {
        const detail = selectorResults.map((r) => `"${r.selector}": ${r.details}`).join('; ');
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation: `None of the ${checks.length} flagged element(s) were found in the live DOM. ${detail}`,
        });
        continue;
      }

      const failing = found.filter((r) => r.passing === false);
      const passing = found.filter((r) => r.passing === true);
      const undetermined = found.filter((r) => r.passing === undefined);

      if (failing.length > 0) {
        const summary = failing.map((r) => `"${r.selector}": ${r.details}`).join(' | ');
        results.push({
          suggestionId: s.id,
          validation_status: 'real_issue',
          explanation: `✗ ${failing.length} of ${found.length} element(s) still missing accessible name: ${summary}`,
        });
      } else if (passing.length > 0 && undetermined.length === 0) {
        const summary = passing.map((r) => `"${r.selector}": ${r.details}`).join(' | ');
        results.push({
          suggestionId: s.id,
          validation_status: 'false_positive',
          explanation: `✓ All ${passing.length} element(s) now have valid accessible names: ${summary}`,
        });
      } else {
        const detail = found.map((r) => `"${r.selector}": ${r.details}`).join(' | ');
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation: `Accessible name could not be fully determined: ${detail}`,
        });
      }
    }
  } finally {
    await browser?.close();
  }

  return results;
}
