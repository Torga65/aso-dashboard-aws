/**
 * Maps thrown errors (e.g. from SpaceCatClient) to an HTTP status for API routes.
 * Prefer the numeric status in `SpaceCat API Error: <status> - ...` when present.
 */
export function httpStatusFromThrownError(err: unknown): number {
  const message = err instanceof Error ? err.message : String(err);
  const spaceCat = message.match(/SpaceCat API Error:\s*(\d{3})\b/);
  if (spaceCat) {
    const n = Number(spaceCat[1]);
    if (n >= 400 && n < 600) return n;
  }
  if (message.includes('401')) return 401;
  if (message.includes('404')) return 404;
  return 502;
}
