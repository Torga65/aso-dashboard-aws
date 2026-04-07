/**
 * Page URL from suggestion.data (`pageUrl` | `url` | `canonicalUrl`), with leading/trailing
 * whitespace removed.
 */
export function getTrimmedPageUrlFromData(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Record<string, unknown>;
  const raw = d.pageUrl ?? d.url ?? d.canonicalUrl;
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  return t || undefined;
}
