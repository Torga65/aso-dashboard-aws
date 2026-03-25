import type { RawCustomer, RawApiResponse, Logger } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Typed API errors
// ─────────────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string
  ) {
    super(`HTTP ${status} ${statusText}`);
    this.name = "ApiError";
  }

  /** 4xx errors (except 429) are not retryable — bad request, auth failure, etc. */
  isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiClientConfig {
  /** Base URL of the external API, e.g. "https://api.example.com" */
  baseUrl: string;
  /** API key passed as a Bearer token */
  apiKey: string;
  /** Request timeout in milliseconds (default: 30 000) */
  timeoutMs?: number;
  /** Maximum number of attempts per request, including the first (default: 3) */
  maxAttempts?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all customer records from the external API.
 * Handles pagination automatically — keeps fetching until no nextToken is returned.
 * Each page is retried independently with exponential back-off.
 *
 * TODO: update `buildUrl()` and `parseResponse()` once the real API shape is known.
 */
export async function fetchCustomers(
  config: ApiClientConfig,
  logger: Logger
): Promise<RawCustomer[]> {
  const { baseUrl, apiKey, timeoutMs = 30_000, maxAttempts = 3 } = config;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const allCustomers: RawCustomer[] = [];
  let nextToken: string | undefined;
  let page = 0;

  do {
    page++;
    const url = buildUrl(baseUrl, nextToken);
    const log = logger.with({ page, url: redactUrl(url) });

    log.info("Fetching page");

    const response = await withRetry(
      () => timedFetch(url, { headers }, timeoutMs),
      { maxAttempts, label: `page ${page}`, logger: log }
    );

    const parsed = parseResponse(response);
    allCustomers.push(...parsed.data);
    nextToken = parsed.nextToken;

    log.info("Page fetched", { recordsOnPage: parsed.data.length, hasMore: !!nextToken });
  } while (nextToken);

  return allCustomers;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the paginated request URL.
 * TODO: adapt to the real API's pagination convention.
 */
function buildUrl(baseUrl: string, nextToken?: string): string {
  const url = new URL("/customers", baseUrl);
  if (nextToken) url.searchParams.set("nextToken", nextToken);
  return url.toString();
}

/**
 * Parse the raw response JSON into the expected shape.
 * TODO: adapt field names to the real API response.
 */
function parseResponse(body: unknown): RawApiResponse {
  if (
    typeof body !== "object" ||
    body === null ||
    !Array.isArray((body as Record<string, unknown>).data)
  ) {
    throw new Error(
      `Unexpected API response shape: ${JSON.stringify(body).slice(0, 200)}`
    );
  }
  const raw = body as { data: unknown[]; nextToken?: string };
  return {
    data: raw.data as RawCustomer[],
    nextToken: raw.nextToken,
  };
}

/** Fetch with an AbortController timeout. Returns parsed JSON. */
async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ApiError(res.status, res.statusText, body);
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Exponential back-off with full jitter: delay = random(0, min(cap, base * 2^attempt)). */
function backoffMs(attempt: number): number {
  const cap = 30_000;
  const base = 1_000;
  const ceiling = Math.min(cap, base * Math.pow(2, attempt - 1));
  return Math.random() * ceiling;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) return err.isRetryable();
  // Network errors (ECONNREFUSED, AbortError from timeout, etc.) are retryable
  return true;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts: number; label: string; logger: Logger }
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!isRetryable(err) || attempt === options.maxAttempts) {
        throw err;
      }

      const delay = backoffMs(attempt);
      options.logger.warn("Request failed, retrying", {
        attempt,
        maxAttempts: options.maxAttempts,
        nextDelayMs: Math.round(delay),
        label: options.label,
        error: err instanceof Error ? err.message : String(err),
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

/** Strip query params from logged URLs to avoid leaking tokens in logs. */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split("?")[0];
  }
}
