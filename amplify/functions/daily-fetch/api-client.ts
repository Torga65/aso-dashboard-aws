import type { RawCustomer, Logger } from "./types";

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

export interface ServiceNowConfig {
  /**
   * Pre-encoded Basic auth token. Accepts either:
   *   - A base64 "user:password" string  →  prefix "Basic " is added automatically
   *   - A full "Basic <base64>" string   →  used as-is
   */
  authToken: string;
  /** ServiceNow instance hostname prefix (default: "adobems") */
  instance?: string;
  /** Records per page (default: 200) */
  pageSize?: number;
  /** Request timeout in milliseconds (default: 30 000) */
  timeoutMs?: number;
  /** Maximum retry attempts per request (default: 3) */
  maxAttempts?: number;
}

// ServiceNow query constants
const SNOW_TABLE = "core_company";
const SNOW_QUERY =
  "nameLIKEASO -^u_active=true";
const SNOW_FIELDS = [
  "sys_id",
  "name",
  "u_product",
  "u_status",
  "u_active",
  "u_customer_success_engineer",
  "u_account_name",
  "u_env",
  "u_ims_org_id",
  "u_created",
  "u_updated",
].join(",");

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all ASO customer records from ServiceNow (core_company table).
 * Handles offset-based pagination automatically — keeps fetching until the
 * last page (fewer records than pageSize) or the reported total is reached.
 * Each page is retried independently with exponential back-off.
 */
export async function fetchCustomers(
  config: ServiceNowConfig,
  logger: Logger
): Promise<RawCustomer[]> {
  const {
    authToken,
    instance = "adobems",
    pageSize = 200,
    timeoutMs = 30_000,
    maxAttempts = 3,
  } = config;

  const authHeader = authToken.startsWith("Basic ")
    ? authToken
    : `Basic ${authToken}`;

  const baseUrl = `https://${instance}.service-now.com/api/now/table/${SNOW_TABLE}`;
  const currentWeek = getCurrentISOWeek();
  const allCustomers: RawCustomer[] = [];
  let offset = 0;
  let page = 0;
  let totalCount: number | undefined;

  do {
    page++;
    const url = buildUrl(baseUrl, offset, pageSize);
    const log = logger.with({ page, offset });

    log.info("Fetching page from ServiceNow");

    const { records, total } = await withRetry(
      () => timedFetchSnow(url, authHeader, timeoutMs),
      { maxAttempts, label: `page ${page}`, logger: log }
    );

    // Capture reported total on first page
    if (totalCount === undefined && total !== undefined) {
      totalCount = total;
      log.info("ServiceNow total record count", { totalCount });
    }

    const mapped = records.map((r) => mapToRawCustomer(r, currentWeek));
    allCustomers.push(...mapped);

    log.info("Page fetched", {
      recordsOnPage: records.length,
      totalSoFar: allCustomers.length,
    });

    offset += records.length;

    // Last page: fewer records than requested
    if (records.length < pageSize) break;
    // Safety: stop when we've reached the reported total
    if (totalCount !== undefined && allCustomers.length >= totalCount) break;
  } while (true); // eslint-disable-line no-constant-condition

  return allCustomers;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function buildUrl(baseUrl: string, offset: number, limit: number): string {
  const params = new URLSearchParams({
    sysparm_query: SNOW_QUERY,
    sysparm_fields: SNOW_FIELDS,
    sysparm_limit: limit.toString(),
    sysparm_offset: offset.toString(),
    sysparm_display_value: "true",
    sysparm_orderby: "name",
  });
  return `${baseUrl}?${params.toString()}`;
}

// ServiceNow returns fields as either plain strings or objects with
// { display_value: string; value: string } when sysparm_display_value=true
interface SnowField {
  display_value: string;
  value: string;
}

type SnowValue = string | SnowField | undefined;

interface SnowRecord {
  sys_id?: SnowValue;
  name?: SnowValue;
  u_product?: SnowValue;
  u_status?: SnowValue;
  u_customer_success_engineer?: SnowValue;
  u_account_name?: SnowValue;
  u_env?: SnowValue;
  u_ims_org_id?: SnowValue;
  u_created?: SnowValue;
  u_updated?: SnowValue;
}

function getDisplayValue(field: SnowValue): string {
  if (!field) return "";
  if (typeof field === "object" && "display_value" in field) {
    return field.display_value ?? "";
  }
  return String(field);
}

function mapToRawCustomer(record: SnowRecord, week: string): RawCustomer {
  return {
    companyName: getDisplayValue(record.name),
    week,
    status: getDisplayValue(record.u_status),
    eseLead: getDisplayValue(record.u_customer_success_engineer),
    licenseType: getDisplayValue(record.u_product),
    deploymentType: getDisplayValue(record.u_env),
    lastUpdated: getDisplayValue(record.u_updated),
    // Fields not directly available in ServiceNow core_company —
    // left as empty defaults; can be enriched via additional queries
    // or manual data entry in the dashboard.
    industry: "",
    engagement: "",
    blockersStatus: "",
    blockers: "",
    feedbackStatus: "",
    feedback: "",
    summary: "",
    mau: "",
    ttiv: "",
    autoOptimizeButtonPressed: "",
    healthScore: 0,
  };
}

/** Return the current ISO 8601 week string, e.g. "2025-W12". */
function getCurrentISOWeek(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7
  );
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** Fetch a ServiceNow page; returns parsed records and optional total count. */
async function timedFetchSnow(
  url: string,
  authHeader: string,
  timeoutMs: number
): Promise<{ records: SnowRecord[]; total?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ApiError(res.status, res.statusText, body);
    }

    const json = (await res.json()) as { result?: unknown[] };
    const records = (json.result ?? []) as SnowRecord[];
    const totalHeader = res.headers.get("x-total-count");
    const total = totalHeader ? parseInt(totalHeader, 10) : undefined;

    return { records, total };
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
