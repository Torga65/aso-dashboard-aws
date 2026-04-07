/**
 * Load a URL in headless Chromium and return the DOM HTML after scripts run.
 * Used as a fallback when static fetch() HTML does not contain expected links (CSR / SPA).
 */

import type { Browser, Page } from 'playwright';

import type { FetchPageResult } from './brokenLinkMatch';

function envMs(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v?.trim()) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** `load` often never fires on heavy SPAs (analytics, stalled assets). Override: PLAYWRIGHT_GOTO_TIMEOUT_MS */
function gotoTimeoutMs(): number {
  return envMs('PLAYWRIGHT_GOTO_TIMEOUT_MS', 60_000);
}

/** After DOM is ready, allow JS to paint anchors. Override: PLAYWRIGHT_POST_LOAD_SETTLE_MS */
function postLoadSettleMs(): number {
  return envMs('PLAYWRIGHT_POST_LOAD_SETTLE_MS', 4_000);
}

/** Wait for target href substring. Override: PLAYWRIGHT_WAIT_FOR_ANCHOR_MS */
function waitForAnchorMs(): number {
  return envMs('PLAYWRIGHT_WAIT_FOR_ANCHOR_MS', 30_000);
}

export interface FetchRenderedPageHtmlOptions {
  /**
   * When set (URL To), wait for an anchor whose href contains the last path segment (e.g. `quantum-view`).
   * Strings in JS bundles are ignored — we need a DOM link.
   */
  waitForTargetUrl?: string;
}

function isPlaywrightFallbackDisabled(): boolean {
  return (
    process.env.DISABLE_PLAYWRIGHT_FALLBACK === '1' ||
    process.env.DISABLE_PLAYWRIGHT_FALLBACK === 'true'
  );
}

export function isRenderedDomFallbackAvailable(): boolean {
  return !isPlaywrightFallbackDisabled();
}

/**
 * Some sites (e.g. behind certain CDNs) fail with net::ERR_HTTP2_PROTOCOL_ERROR in headless Chromium.
 * Disabling HTTP/2 / QUIC matches workarounds used for Playwright + strict hosts.
 */
function chromiumLaunchOptions(): Parameters<typeof import('playwright').chromium.launch>[0] {
  const useSystemChrome = process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === '1';
  const extra =
    process.env.PLAYWRIGHT_CHROMIUM_EXTRA_ARGS?.trim().split(/\s+/).filter(Boolean) ?? [];

  return {
    headless: true,
    ...(useSystemChrome ? { channel: 'chrome' as const } : {}),
    args: ['--disable-dev-shm-usage', '--disable-http2', '--disable-quic', ...extra],
  };
}

export async function launchChromiumForValidation(): Promise<Browser> {
  const { chromium } = await import('playwright');
  return chromium.launch(chromiumLaunchOptions());
}

/** Escape a substring for use inside a[href*="..."] (minimal safe subset). */
function escapeForHrefContainsSelector(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Best-effort: wait until a navigable anchor appears whose href contains the target path.
 * Angular/React often inject links after DOM ready + hydration; bundle strings alone do not count.
 */
async function waitForTargetAnchorInDom(page: Page, targetUrl: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(targetUrl);
  } catch {
    return;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return;

  const segments = u.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last || last.length < 2) return;

  const selector = `a[href*="${escapeForHrefContainsSelector(last)}"]`;
  try {
    await page.waitForSelector(selector, {
      timeout: waitForAnchorMs(),
      state: 'attached',
    });
  } catch {
    /* Link may use a different shape, or never render — still snapshot DOM below */
  }
}

/**
 * Navigate with an existing browser (reuse across suggestions in one batch).
 */
export async function fetchRenderedPageHtml(
  browser: Browser,
  url: string,
  options?: FetchRenderedPageHtmlOptions
): Promise<FetchPageResult> {
  if (!url?.trim()) {
    return { ok: false, status: 0, finalUrl: '', html: '', error: 'Missing URL' };
  }

  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ASO-Validator/1.0',
  });

  try {
    // `domcontentloaded` — SPAs/CDNs often never reach `load` before timeout (stalling scripts, beacons).
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: gotoTimeoutMs(),
    });

    await new Promise<void>((resolve) => setTimeout(resolve, postLoadSettleMs()));

    if (options?.waitForTargetUrl?.trim()) {
      await waitForTargetAnchorInDom(page, options.waitForTargetUrl.trim());
    }

    const finalUrl = page.url();
    const html = await page.content();
    const status = response?.status() ?? 200;

    if (status >= 400) {
      return {
        ok: false,
        status,
        finalUrl,
        html: '',
        error: `HTTP ${status}`,
      };
    }

    return { ok: true, status, finalUrl, html };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const err = message.includes('Timeout') ? 'Page load timed out' : message;
    return { ok: false, status: 0, finalUrl: '', html: '', error: err };
  } finally {
    await page.close();
  }
}
