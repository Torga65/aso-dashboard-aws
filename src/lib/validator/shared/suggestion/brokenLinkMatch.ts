/**
 * Match "URL To" against hrefs found in the URL From page HTML.
 * Handles absolute URLs, protocol-relative, site-relative paths, ../ segments, and encoding differences.
 */

const FETCH_TIMEOUT_MS = 15_000;

/** Skip non-HTTP navigations when scanning anchors. */
function isSkippableHref(href: string): boolean {
  const t = href.trim().toLowerCase();
  return (
    t.startsWith('mailto:') ||
    t.startsWith('javascript:') ||
    t.startsWith('tel:') ||
    t.startsWith('#') ||
    t === ''
  );
}

/**
 * Extract `href` values from `<a>` and `<area>` tags (quoted and common unquoted forms).
 */
export function extractNavigableHrefs(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string | undefined) => {
    if (!raw || seen.has(raw)) return;
    seen.add(raw);
    out.push(raw);
  };

  const reQuoted = /<(?:a|area)\b[^>]*\bhref\s*=\s*(["'])([^"']*)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = reQuoted.exec(html)) !== null) {
    add(m[2]);
  }

  return out;
}

/**
 * Normalize absolute HTTP(S) URLs for stable equality (host lowercased, path decoded, trailing slash dropped except root semantics).
 */
export function normalizeUrlForLinkMatch(absoluteUrl: string): string {
  try {
    const u = new URL(absoluteUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return absoluteUrl.trim().toLowerCase();
    }
    let path = u.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      /* keep raw */
    }
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    const host = u.hostname.toLowerCase();
    const port =
      u.port &&
      !((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443'))
        ? `:${u.port}`
        : '';
    const proto = u.protocol.toLowerCase();
    const search = u.search;
    return `${proto}//${host}${port}${path}${search}`;
  } catch {
    return absoluteUrl.trim().toLowerCase();
  }
}

/**
 * Resolve an href from page source against the final page URL, then compare to the target absolute URL.
 */
export function hrefMatchesTarget(
  hrefRaw: string,
  pageBaseAbsolute: string,
  targetAbsolute: string
): boolean {
  if (isSkippableHref(hrefRaw)) return false;
  const t = hrefRaw.trim();
  let resolved: string;
  try {
    if (t.startsWith('//')) {
      resolved = new URL(`https:${t}`).href;
    } else {
      resolved = new URL(t, pageBaseAbsolute).href;
    }
  } catch {
    return false;
  }
  if (!/^https?:/i.test(resolved)) return false;
  return (
    normalizeUrlForLinkMatch(resolved) === normalizeUrlForLinkMatch(targetAbsolute)
  );
}

export interface FetchPageResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  html: string;
  error?: string;
}

export async function fetchPageHtml(url: string): Promise<FetchPageResult> {
  if (!url?.trim()) {
    return { ok: false, status: 0, finalUrl: '', html: '', error: 'Missing URL' };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ASO-Validator/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const finalUrl = response.url || url;
    if (response.status >= 400) {
      return {
        ok: false,
        status: response.status,
        finalUrl,
        html: '',
        error: `HTTP ${response.status}`,
      };
    }
    const html = await response.text();
    return { ok: true, status: response.status, finalUrl, html };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const err = message.includes('abort') ? 'Request timed out' : message;
    return { ok: false, status: 0, finalUrl: '', html: '', error: err };
  }
}

/** Result of checking whether URL To responds with a successful HTTP status after following redirects. */
export interface UrlTargetWorkingResult {
  /** True when final status is 2xx (working link). */
  working: boolean;
  status: number;
  finalUrl: string;
  /** Present when the request failed before a normal HTTP response (timeout, DNS, etc.). */
  error?: string;
}

/**
 * Verifies that a URL responds with a successful HTTP status (2xx) after redirects.
 * Uses HEAD first to avoid downloading large bodies; if HEAD is not successful (2xx), repeats with GET.
 * Some origins and CDNs mis-handle HEAD (e.g. 404 while GET returns 200), so GET is the source of truth when HEAD fails.
 */
export async function fetchUrlTargetWorking(url: string): Promise<UrlTargetWorkingResult> {
  if (!url?.trim()) {
    return { working: false, status: 0, finalUrl: '', error: 'Missing URL' };
  }

  const runFetch = async (method: 'HEAD' | 'GET'): Promise<{ response: Response; finalUrl: string }> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ASO-Validator/1.0)',
          Accept:
            method === 'HEAD'
              ? '*/*'
              : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });
      const finalUrl = response.url || url;
      if (method === 'GET') {
        await response.text();
      }
      return { response, finalUrl };
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    let { response, finalUrl } = await runFetch('HEAD');
    if (response.status < 200 || response.status >= 300) {
      ({ response, finalUrl } = await runFetch('GET'));
    }
    const status = response.status;
    const working = status >= 200 && status < 300;
    return { working, status, finalUrl };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const err = message.includes('abort') ? 'Request timed out' : message;
    return { working: false, status: 0, finalUrl: '', error: err };
  }
}

/**
 * Returns true if any anchor href resolves to the same normalized URL as `targetAbsolute`.
 * `pageBaseAbsolute` should be the final URL after redirects (response.url).
 */
export function pageHtmlContainsLinkTo(
  html: string,
  pageBaseAbsolute: string,
  targetAbsolute: string
): boolean {
  const hrefs = extractNavigableHrefs(html);
  for (const h of hrefs) {
    if (hrefMatchesTarget(h, pageBaseAbsolute, targetAbsolute)) {
      return true;
    }
  }
  return false;
}
