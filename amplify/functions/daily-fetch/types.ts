// ─────────────────────────────────────────────────────────────────────────────
// Raw shape — what the external API returns (fields may be missing/inconsistent)
// ─────────────────────────────────────────────────────────────────────────────

export interface RawCustomer {
  week?: string;
  companyName?: string;
  imsOrgId?: string;
  licenseType?: string;
  industry?: string;
  eseLead?: string;
  status?: string;
  deploymentType?: string;
  engagement?: string;
  blockersStatus?: string;
  blockers?: string;
  feedbackStatus?: string;
  feedback?: string;
  healthScore?: number | string;
  summary?: string;
  mau?: string;
  ttiv?: string;
  autoOptimizeButtonPressed?: string;
  lastUpdated?: string;
}

export interface RawApiResponse {
  data: RawCustomer[];
  /** Pagination cursor — use if the API is paginated */
  nextToken?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalized shape — written to DynamoDB via AppSync
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizedSnapshot {
  companyName: string;
  week: string;
  imsOrgId: string;
  licenseType: string;
  industry: string;
  eseLead: string;
  status: string;
  deploymentType: string;
  engagement: string;
  blockersStatus: string;
  blockers: string;
  feedbackStatus: string;
  feedback: string;
  healthScore: number;
  summary: string;
  mau: string;
  ttiv: string;
  autoOptimizeButtonPressed: string;
  sourceLastUpdated: string;
  ingestedAt: string;
  dataSource: string;
}

export interface WeeklySummaryInput {
  week: string;
  totalCustomers: number;
  activeCount: number;
  atRiskCount: number;
  onboardingCount: number;
  preProductionCount: number;
  churnedCount: number;
  avgHealthScore: number;
  highEngagementCount: number;
  mediumEngagementCount: number;
  lowEngagementCount: number;
  computedAt: string;
  dataSource: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence results
// ─────────────────────────────────────────────────────────────────────────────

export type UpsertAction = "created" | "updated" | "skipped";

export interface UpsertResult {
  action: UpsertAction;
  companyName: string;
  week: string;
}

export interface SyncStats {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ companyName: string; week: string; reason: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured logger — writes JSON to stdout (CloudWatch Logs Insights friendly)
// ─────────────────────────────────────────────────────────────────────────────

export class Logger {
  private ctx: Record<string, unknown>;

  constructor(context: Record<string, unknown> = {}) {
    this.ctx = context;
  }

  /** Return a child logger with extra context fields merged in. */
  with(extra: Record<string, unknown>): Logger {
    return new Logger({ ...this.ctx, ...extra });
  }

  info(msg: string, data?: Record<string, unknown>): void {
    console.log(
      JSON.stringify({ level: "INFO", ts: new Date().toISOString(), msg, ...this.ctx, ...data })
    );
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    console.warn(
      JSON.stringify({ level: "WARN", ts: new Date().toISOString(), msg, ...this.ctx, ...data })
    );
  }

  error(msg: string, err?: unknown, data?: Record<string, unknown>): void {
    console.error(
      JSON.stringify({
        level: "ERROR",
        ts: new Date().toISOString(),
        msg,
        ...this.ctx,
        ...data,
        error:
          err instanceof Error
            ? { message: err.message, name: err.name, stack: err.stack }
            : String(err),
      })
    );
  }
}
