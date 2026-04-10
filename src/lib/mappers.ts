/**
 * mappers.ts
 *
 * Converts Amplify-generated Schema types into the domain types used by the UI.
 * All nullable coercion lives here so query functions and components stay clean.
 *
 * Import pattern:
 *   import { toCustomer, toWeeklySummary } from "@/lib/mappers";
 */
import type { Schema } from "../../amplify/data/resource";
import type { Customer, WeeklySummary, SyncJobRecord, CustomerNote, CustomerProgression, CustomerStageHistoryEntry } from "./types";

// Amplify generates nullable versions of every optional field (field | null | undefined).
// These aliases make the mapper signatures readable.
type SnapshotRecord      = Schema["CustomerSnapshot"]["type"];
type SummaryRecord       = Schema["WeeklySummary"]["type"];
type SyncJobDbRecord     = Schema["DataSyncJob"]["type"];
type NoteRecord          = Schema["CustomerNote"]["type"];
type ProgressionRecord   = Schema["CustomerProgression"]["type"];
type StageHistoryRecord  = Schema["CustomerStageHistory"]["type"];

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation helpers
//
// Legacy data from the SharePoint/JSON import uses different vocabulary to the
// canonical values the UI expects.  These functions map both so the rest of the
// code (filters, stats, badges) can use a single consistent set of values.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeStatus(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase().trim().replace(/\s+/g, "-");
  if (s === "production")                    return "Active";
  if (s === "pre-production")                return "Pre-Production";
  if (s === "on-hold")                       return "On-Hold";
  if (s === "dead" || s === "terminated")    return "Churned";
  if (s === "sandbox")                       return "Pre-Production";
  // Already canonical (Active, At-Risk, Onboarding, Churned, On-Hold, …)
  return raw ?? "";
}

function normalizeEngagement(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase().trim();
  if (s === "active")   return "High";
  if (s === "at risk")  return "Medium";
  if (s === "critical") return "Low";
  if (s === "high" || s === "medium" || s === "low") {
    // Already canonical — preserve capitalisation
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return "Unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// CustomerSnapshot → Customer
// ─────────────────────────────────────────────────────────────────────────────

export function toCustomer(snap: SnapshotRecord): Customer {
  return {
    week:                       snap.week,
    companyName:                snap.companyName,
    imsOrgId:                   snap.imsOrgId                ?? "",
    licenseType:                snap.licenseType             ?? "",
    industry:                   snap.industry                ?? "",
    eseLead:                    snap.eseLead                 ?? "",
    status:                     normalizeStatus(snap.status),
    deploymentType:             snap.deploymentType          ?? "",
    engagement:                 normalizeEngagement(snap.engagement),
    blockersStatus:             snap.blockersStatus          ?? "",
    blockers:                   snap.blockers                ?? "",
    feedbackStatus:             snap.feedbackStatus          ?? "",
    feedback:                   snap.feedback                ?? "",
    // healthScoreRaw kept as a string for display; healthScore is the integer
    healthScoreRaw:             String(snap.healthScore      ?? 50),
    healthScore:                snap.healthScore             ?? 50,
    summary:                    snap.summary                 ?? "",
    mau:                        snap.mau                     ?? "",
    ttiv:                       snap.ttiv                    ?? "",
    autoOptimizeButtonPressed:  snap.autoOptimizeButtonPressed ?? "No",
    // UI uses `lastUpdated` — prefer the source date, fall back to ingest time
    lastUpdated:                snap.sourceLastUpdated ?? snap.ingestedAt ?? "",
    hidden:                     snap.hidden ?? false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    headless:                   (snap as any).headless ?? false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    preflightEnabled:           (snap as any).preflightEnabled ?? false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customFields:               (snap as any).customFields ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WeeklySummary → WeeklySummary
// ─────────────────────────────────────────────────────────────────────────────

export function toWeeklySummary(record: SummaryRecord): WeeklySummary {
  return {
    week:                   record.week,
    totalCustomers:         record.totalCustomers       ?? 0,
    activeCount:            record.activeCount          ?? 0,
    atRiskCount:            record.atRiskCount          ?? 0,
    onboardingCount:        record.onboardingCount      ?? 0,
    preProductionCount:     record.preProductionCount   ?? 0,
    churnedCount:           record.churnedCount         ?? 0,
    avgHealthScore:         record.avgHealthScore       ?? 0,
    highEngagementCount:    record.highEngagementCount  ?? 0,
    mediumEngagementCount:  record.mediumEngagementCount ?? 0,
    lowEngagementCount:     record.lowEngagementCount   ?? 0,
    computedAt:             record.computedAt,
    dataSource:             record.dataSource           ?? "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DataSyncJob → SyncJobRecord
// ─────────────────────────────────────────────────────────────────────────────

export function toSyncJob(record: SyncJobDbRecord): SyncJobRecord {
  return {
    id:               record.id,
    status:           record.status as SyncJobRecord["status"],
    startedAt:        record.startedAt,
    completedAt:      record.completedAt   ?? null,
    weekIngested:     record.weekIngested  ?? null,
    recordsProcessed: record.recordsProcessed ?? null,
    recordsFailed:    record.recordsFailed    ?? null,
    errorMessage:     record.errorMessage     ?? null,
    triggeredBy:      record.triggeredBy      ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CustomerNote → CustomerNote
// ─────────────────────────────────────────────────────────────────────────────

export function toCustomerNote(record: NoteRecord): CustomerNote {
  return {
    id:          record.id,
    companyName: record.companyName,
    week:        record.week,
    note:        record.note,
    createdAt:   record.createdAt,
    updatedAt:   record.updatedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CustomerProgression → CustomerProgression
// ─────────────────────────────────────────────────────────────────────────────

export function toCustomerProgression(record: ProgressionRecord): CustomerProgression {
  return {
    companyName:      record.companyName,
    progressionTrack: record.progressionTrack as CustomerProgression["progressionTrack"],
    progressionStage: record.progressionStage as CustomerProgression["progressionStage"],
    migrationSource:  (record.migrationSource ?? null) as CustomerProgression["migrationSource"],
    migrationTech:    (record.migrationTech   ?? null) as CustomerProgression["migrationTech"],
    stageEnteredAt:   record.stageEnteredAt,
    updatedBy:        record.updatedBy,
    updatedAt:        record.updatedAt,
    notes:            record.notes ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CustomerStageHistory → CustomerStageHistoryEntry
// ─────────────────────────────────────────────────────────────────────────────

export function toStageHistoryEntry(record: StageHistoryRecord): CustomerStageHistoryEntry {
  return {
    id:               record.id,
    companyName:      record.companyName,
    changedAt:        record.changedAt,
    progressionTrack: record.progressionTrack,
    progressionStage: record.progressionStage,
    migrationSource:  record.migrationSource ?? null,
    migrationTech:    record.migrationTech   ?? null,
    changedBy:        record.changedBy,
    notes:            record.notes           ?? null,
  };
}
