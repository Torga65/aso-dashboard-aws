/**
 * Heuristics for bot / WAF / CDN challenge pages. Not definitive — sites change copy and some
 * legitimate pages match — but useful for validation UX when automation cannot see real content.
 */

export interface BotMitigationHintInput {
  httpStatus: number;
  /** Response body (static fetch or Playwright snapshot). */
  html?: string;
  /** Playwright or fetch error message. */
  transportError?: string;
}

/**
 * Returns a short human-readable note when signals suggest bot mitigation or a challenge page.
 * Returns `undefined` when there are no notable signals.
 */
export function describePossibleBotMitigation(input: BotMitigationHintInput): string | undefined {
  const { httpStatus, html = '', transportError } = input;
  const parts: string[] = [];

  if (httpStatus === 403 || httpStatus === 401) {
    parts.push(`HTTP ${httpStatus} often indicates access control or bot mitigation.`);
  }
  if (httpStatus === 429) {
    parts.push('HTTP 429 indicates rate limiting (may block automated clients).');
  }

  const sample = html.slice(0, 120_000).toLowerCase();
  const markers: { phrase: string; label: string }[] = [
    { phrase: 'captcha', label: 'captcha' },
    { phrase: 'recaptcha', label: 'reCAPTCHA' },
    { phrase: 'hcaptcha', label: 'hCaptcha' },
    { phrase: 'cloudflare', label: 'Cloudflare' },
    { phrase: 'attention required', label: 'CDN challenge' },
    { phrase: 'checking your browser', label: 'browser check' },
    { phrase: 'access denied', label: 'access denied' },
    { phrase: 'akamai', label: 'Akamai' },
    { phrase: 'datadome', label: 'DataDome' },
    { phrase: 'perimeterx', label: 'PerimeterX' },
    { phrase: 'please verify you are human', label: 'human verification' },
    { phrase: 'verify you are a human', label: 'human verification' },
    { phrase: 'incapsula', label: 'Incapsula' },
    { phrase: 'imperva', label: 'Imperva' },
    { phrase: 'bot detection', label: 'bot detection' },
    { phrase: 'automated access', label: 'automated access' },
    { phrase: 'unusual traffic', label: 'unusual traffic' },
    { phrase: 'enable javascript', label: 'JS challenge copy' },
    { phrase: 'enable cookies', label: 'cookie challenge' },
    { phrase: 'request blocked', label: 'request blocked' },
    { phrase: 'forbidden: bot', label: 'bot forbidden' },
  ];

  const hits = [...new Set(markers.filter((m) => sample.includes(m.phrase)).map((m) => m.label))];
  if (hits.length > 0) {
    parts.push(`HTML content suggests a bot/WAF challenge or block page (signals: ${hits.join(', ')}).`);
  }

  /* Extreme stubs only — many real pages are <2.5kb */
  if (httpStatus >= 200 && httpStatus < 300 && html.length > 0 && html.length < 180) {
    parts.push('Very small HTML body — may be an interstitial or minimal challenge page.');
  }

  if (transportError) {
    const te = transportError.toLowerCase();
    if (
      te.includes('blocked') ||
      te.includes('forbidden') ||
      te.includes('refused') ||
      te.includes('unauthorized')
    ) {
      parts.push(
        `Underlying error text may indicate blocking: ${transportError.slice(0, 180)}${transportError.length > 180 ? '…' : ''}`
      );
    }
  }

  if (parts.length === 0) return undefined;
  return `[Possible bot/WAF interference] ${parts.join(' ')}`;
}
