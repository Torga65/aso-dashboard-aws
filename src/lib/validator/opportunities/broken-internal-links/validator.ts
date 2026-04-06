/**
 * Gate validator for broken internal link opportunities.
 * 1) Fetches URL From and checks that some `<a href>` resolves to the same URL as URL To.
 *    If not found in static HTML, optionally loads the page in headless Chromium (Playwright) and checks again (CSR / SPA).
 * 2) Requests URL To (HEAD, then GET if HEAD is not 2xx) and requires a 2xx response after redirects — otherwise real_issue.
 */

import type { Browser } from 'playwright';

import type { Suggestion, ValidationResult } from '@validator-shared/types';
import { validateSuggestionData } from '@validator-shared/schema';
import { getAbsoluteUrlTo, getOpenHrefForUrlFrom } from '@validator-shared/suggestion/brokenInternalLinks';
import {
  fetchPageHtml,
  fetchUrlTargetWorking,
  normalizeUrlForLinkMatch,
  pageHtmlContainsLinkTo,
} from '@validator-shared/suggestion/brokenLinkMatch';
import {
  fetchRenderedPageHtml,
  isRenderedDomFallbackAvailable,
  launchChromiumForValidation,
} from '@validator-shared/suggestion/playwrightRenderedPage';
import { describePossibleBotMitigation } from '@validator-shared/suggestion/botBlockHeuristics';
import dataSchema from './data-schema.json';

const MAX_PAGE_SOURCE_SNIPPET_CHARS = 18_000;

/** Verbose Playwright logs (dev or ASO_LOG_PLAYWRIGHT=1). */
function logPlaywrightVerbose(message: string, ...args: unknown[]): void {
  if (process.env.NODE_ENV !== 'development' && process.env.ASO_LOG_PLAYWRIGHT !== '1') return;
  console.info('[broken-internal-links]', message, ...args);
}

/** Always log when Playwright runs so production/API routes still show one line in the server terminal. */
function logPlaywrightStart(context: {
  suggestionId: string;
  urlFrom: string;
  staticFetchOk: boolean;
  reason: 'static_fetch_failed' | 'no_matching_anchor_in_html';
}): void {
  console.info(
    '[broken-internal-links] Playwright fallback starting (headless Chromium, no browser window).',
    context
  );
}

function truncatePageSource(html: string): string {
  if (html.length <= MAX_PAGE_SOURCE_SNIPPET_CHARS) return html;
  return `${html.slice(0, MAX_PAGE_SOURCE_SNIPPET_CHARS)}\n\n… (truncated; page source exceeded ${MAX_PAGE_SOURCE_SNIPPET_CHARS} characters)`;
}

export async function validate(suggestions: Suggestion[]): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  let playwrightBrowser: Browser | undefined;

  try {
    for (const s of suggestions) {
      const { valid, errors } = validateSuggestionData(s, dataSchema as object);
      if (!valid) {
        const explanation = errors.length
          ? errors.map((e) => `${e.instancePath}: ${e.message ?? 'invalid'}`).join('; ')
          : 'Suggestion data does not match broken-internal-links schema';
        results.push({
          suggestionId: s.id,
          validation_status: 'invalid_data',
          explanation,
        });
        continue;
      }

      const urlFrom = getOpenHrefForUrlFrom(s);
      const urlTo = getAbsoluteUrlTo(s);

      if (!urlFrom) {
        results.push({
          suggestionId: s.id,
          validation_status: 'invalid_data',
          explanation:
            'Missing URL From: set pageUrl, url, canonicalUrl, or urlFrom / url_from so the referring page can be fetched.',
        });
        continue;
      }

      if (!urlTo) {
        results.push({
          suggestionId: s.id,
          validation_status: 'invalid_data',
          explanation:
            'Missing URL To: set urlTo, url_to, brokenUrl, brokenHref, or another target field so the link can be matched.',
        });
        continue;
      }

      const staticFetch = await fetchPageHtml(urlFrom);
      let pageHtml = staticFetch.html;
      let pageBase = staticFetch.finalUrl;
      let found = staticFetch.ok && pageHtmlContainsLinkTo(pageHtml, pageBase, urlTo);

      let checkedRenderedDom = false;
      let playwrightLoadedOk = false;
      let playwrightAttempted = false;
      let playwrightError: string | undefined;

      const needPlaywright = isRenderedDomFallbackAvailable() && (!staticFetch.ok || !found);

      if (!found && !isRenderedDomFallbackAvailable()) {
        logPlaywrightVerbose(
          'No matching anchor in static HTML; Playwright disabled (DISABLE_PLAYWRIGHT_FALLBACK).',
          { suggestionId: s.id, urlFrom }
        );
      }

      if (needPlaywright) {
        logPlaywrightStart({
          suggestionId: s.id,
          urlFrom,
          staticFetchOk: staticFetch.ok,
          reason: !staticFetch.ok ? 'static_fetch_failed' : 'no_matching_anchor_in_html',
        });
        playwrightAttempted = true;
        try {
          if (!playwrightBrowser) {
            playwrightBrowser = await launchChromiumForValidation();
          }
          const rendered = await fetchRenderedPageHtml(playwrightBrowser, urlFrom, {
            waitForTargetUrl: urlTo,
          });
          if (rendered.ok) {
            playwrightLoadedOk = true;
            checkedRenderedDom = true;
            pageHtml = rendered.html;
            pageBase = rendered.finalUrl;
            found = pageHtmlContainsLinkTo(pageHtml, pageBase, urlTo);
            logPlaywrightVerbose(
              found
                ? 'Playwright: link found in rendered DOM.'
                : 'Playwright: page loaded but still no matching anchor.',
              { suggestionId: s.id, finalUrl: pageBase }
            );
          } else {
            playwrightError = rendered.error ?? `HTTP ${rendered.status}`;
            console.warn(
              '[broken-internal-links] Playwright navigation did not return a usable page:',
              playwrightError,
              { suggestionId: s.id, urlFrom }
            );
          }
        } catch (e) {
          playwrightError = e instanceof Error ? e.message : String(e);
          console.warn('[broken-internal-links] Playwright fallback failed:', e);
        }
      }

      if (!found) {
        if (!staticFetch.ok && !playwrightLoadedOk) {
          let explanation = `Could not load URL From page for link matching. Static request: ${staticFetch.error ?? `HTTP ${staticFetch.status}`}.`;
          if (playwrightAttempted) {
            explanation += ` Playwright: ${playwrightError ?? 'failed'}.`;
          }
          const botHint = describePossibleBotMitigation({
            httpStatus: staticFetch.status,
            html: staticFetch.ok ? staticFetch.html : '',
            transportError: playwrightAttempted ? playwrightError : undefined,
          });
          if (botHint) {
            explanation += ` ${botHint}`;
          }
          results.push({
            suggestionId: s.id,
            validation_status: 'could_not_validate',
            explanation,
          });
          continue;
        }

        const domNote = checkedRenderedDom
          ? ' Checked initial HTML and client-rendered DOM (Playwright).'
          : '';
        let falsePositiveExplanation =
          'Not a valid issue: no anchor on the URL From page resolves to the reported URL To (absolute, relative, and protocol-relative hrefs).' +
          domNote +
          ' The link may have been removed or the markup differs.';
        const botHintFp = describePossibleBotMitigation({
          httpStatus: playwrightLoadedOk ? 200 : staticFetch.status,
          html: pageHtml,
        });
        if (botHintFp) {
          falsePositiveExplanation += ` ${botHintFp}`;
        }
        results.push({
          suggestionId: s.id,
          validation_status: 'false_positive',
          explanation: falsePositiveExplanation,
        });
        continue;
      }

      const targetCheck = await fetchUrlTargetWorking(urlTo);
      if (targetCheck.error) {
        results.push({
          suggestionId: s.id,
          validation_status: 'could_not_validate',
          explanation: `Link found on URL From page, but URL To could not be checked (${targetCheck.error}).`,
        });
        continue;
      }

      if (!targetCheck.working) {
        const redirectNote =
          targetCheck.finalUrl &&
          normalizeUrlForLinkMatch(targetCheck.finalUrl) !== normalizeUrlForLinkMatch(urlTo)
            ? ` Final URL after redirects: ${targetCheck.finalUrl}.`
            : '';
        results.push({
          suggestionId: s.id,
          validation_status: 'real_issue',
          explanation: `Link found on URL From page, but URL To is not a working link (HTTP ${targetCheck.status}).${redirectNote}`,
          pageSourceSnippet: truncatePageSource(pageHtml),
        });
        continue;
      }

      results.push({
        suggestionId: s.id,
        validation_status: 'gate_passed',
        explanation: `The URL To was found on the URL From page and returned HTTP ${targetCheck.status} when requested (working link). Proceeding to AI review to confirm whether the issue is valid.`,
        pageSourceSnippet: truncatePageSource(pageHtml),
      });
    }

    return results;
  } finally {
    await playwrightBrowser?.close();
  }
}
