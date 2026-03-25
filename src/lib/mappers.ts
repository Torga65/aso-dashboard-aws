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
import type { Customer, WeeklySummary, SyncJobRecord, CustomerNote } from "./types";

// Amplify generates nullable versions of every optional field (field | null | undefined).
// These aliases make the mapper signatures readable.
type SnapshotRecord  = Schema["CustomerSnapshot"]["type"];
type SummaryRecord   = Schema["WeeklySummary"]["type"];
type SyncJobDbRecord = Schema["DataSyncJob"]["type"];
type NoteRecord      = Schema["CustomerNote"]["type"];

// ─────────────────────────────────────────────────────────────────────────────
// CustomerSnapshot → Customer
// ─────────────────────────────────────────────────────────────────────────────

export function toCustomer(snap: SnapshotRecord): Customer {
  return {
    week:                       snap.week,
    companyName:                snap.companyName,
    licenseType:                snap.licenseType             ?? "",
    industry:                   snap.industry                ?? "",
    eseLead:                    snap.eseLead                 ?? "",
    status:                     snap.status                  ?? "",
    deploymentType:             snap.deploymentType          ?? "",
    engagement:                 snap.engagement              ?? "Unknown",
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
    owner:       record.owner  ?? null,
    createdAt:   record.createdAt,
    updatedAt:   record.updatedAt,
  };
}
