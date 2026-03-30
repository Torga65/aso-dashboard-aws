import type {
  RawCustomer,
  NormalizedSnapshot,
  WeeklySummaryInput,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

const DATA_SOURCE = "external-api";

/**
 * Normalize one raw customer record into the shape expected by DynamoDB.
 * Returns null for records that are missing the two required key fields
 * (companyName + week) so the caller can log and skip them.
 */
export function normalizeCustomer(
  raw: RawCustomer,
  ingestedAt: string
): NormalizedSnapshot | null {
  const companyName = raw.companyName?.trim();
  const week = normalizeWeek(raw.week);

  if (!companyName || !week) return null;

  return {
    companyName,
    week,
    licenseType: raw.licenseType?.trim() ?? "",
    industry: raw.industry?.trim() ?? "",
    eseLead: raw.eseLead?.trim() ?? "",
    status: normalizeStatus(raw.status),
    deploymentType: raw.deploymentType?.trim() ?? "",
    engagement: normalizeEngagement(raw.engagement),
    blockersStatus: raw.blockersStatus?.trim() ?? "",
    blockers: raw.blockers?.trim() ?? "None",
    feedbackStatus: raw.feedbackStatus?.trim() ?? "",
    feedback: raw.feedback?.trim() ?? "",
    healthScore: normalizeHealthScore(raw.healthScore),
    summary: raw.summary?.trim() ?? "",
    mau: raw.mau?.trim() ?? "",
    ttiv: raw.ttiv?.trim() ?? "",
    autoOptimizeButtonPressed: raw.autoOptimizeButtonPressed?.trim() ?? "No",
    sourceLastUpdated: raw.lastUpdated?.trim() ?? "",
    ingestedAt,
    dataSource: DATA_SOURCE,
  };
}

/**
 * Determine the dominant week value from a batch of snapshots.
 * Uses the most-frequent value so that a handful of mis-dated records
 * do not affect the overall week label.
 */
export function resolveIngestionWeek(snapshots: NormalizedSnapshot[]): string {
  if (snapshots.length === 0) return "";
  const tally: Record<string, number> = {};
  for (const s of snapshots) {
    tally[s.week] = (tally[s.week] ?? 0) + 1;
  }
  return Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
}

/** Compute aggregate statistics for one week from a batch of snapshots. */
export function computeWeeklySummary(
  week: string,
  snapshots: NormalizedSnapshot[]
): WeeklySummaryInput {
  let active = 0, atRisk = 0, onboarding = 0, preProduction = 0, churned = 0;
  let high = 0, medium = 0, low = 0;
  let healthTotal = 0;

  for (const s of snapshots) {
    switch (s.status) {
      case "Active":        active++;        break;
      case "At-Risk":       atRisk++;        break;
      case "Onboarding":    onboarding++;    break;
      case "Pre-Production":preProduction++; break;
      case "Churned":       churned++;       break;
    }

    switch (s.engagement) {
      case "High":   high++;   break;
      case "Medium": medium++; break;
      case "Low":    low++;    break;
    }

    healthTotal += s.healthScore;
  }

  return {
    week,
    totalCustomers: snapshots.length,
    activeCount: active,
    atRiskCount: atRisk,
    onboardingCount: onboarding,
    preProductionCount: preProduction,
    churnedCount: churned,
    avgHealthScore:
      snapshots.length > 0
        ? Math.round((healthTotal / snapshots.length) * 10) / 10
        : 0,
    highEngagementCount: high,
    mediumEngagementCount: medium,
    lowEngagementCount: low,
    computedAt: new Date().toISOString(),
    dataSource: DATA_SOURCE,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Field normalisers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coerce status strings from the source data into canonical values.
 * The source Excel file has inconsistent casing and occasional typos.
 */
export function normalizeStatus(raw: string | undefined): string {
  const s = raw?.trim().toLowerCase() ?? "";

  if (s === "active" || s === "production") return "Active";
  if (s === "at-risk" || s === "at risk") return "At-Risk";
  if (s === "onboarding") return "Onboarding";
  if (s === "pre-production" || s === "pre production" || s === "preprod")
    return "Pre-Production";
  if (s === "churned" || s === "inactive") return "Churned";
  if (s === "on-hold" || s === "on hold") return "On-Hold";

  // Unknown values are stored as-is so nothing is silently lost
  return raw?.trim() ?? "";
}

/**
 * Coerce engagement level strings into canonical values.
 */
export function normalizeEngagement(raw: string | undefined): string {
  const s = raw?.trim().toLowerCase() ?? "";

  if (s === "high") return "High";
  if (s === "medium" || s === "med") return "Medium";
  if (s === "low") return "Low";
  if (s === "none" || s === "n/a" || s === "") return "Unknown";

  return raw?.trim() ?? "Unknown";
}

/**
 * Parse health score to an integer in the range [0, 100].
 * Defaults to 50 when the value is missing, non-numeric, or out of range.
 */
export function normalizeHealthScore(raw: number | string | undefined): number {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

/**
 * Validate and normalise the week date string.
 * Expects ISO 8601 date (YYYY-MM-DD). Returns empty string if invalid.
 */
function normalizeWeek(raw: string | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  // Accept ISO week format (2026-W14) or date format (YYYY-MM-DD)
  if (/^\d{4}-W\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return "";
}
