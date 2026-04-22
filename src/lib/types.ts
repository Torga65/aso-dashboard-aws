// ─────────────────────────────────────────────────────────────────────────────
// Domain types — derived from cm-p186978-s23215-asodashboard data shape
// ─────────────────────────────────────────────────────────────────────────────

export type CustomerStatus =
  | "Active"
  | "At-Risk"
  | "Onboarding"
  | "Churned"
  | "Pre-Production"
  | "On-Hold"
  | string;

export type EngagementLevel = "High" | "Medium" | "Low" | "Unknown" | "None" | string;

export interface Customer {
  week: string;
  companyName: string;
  imsOrgId: string;
  licenseType: string;
  industry: string;
  eseLead: string;
  status: CustomerStatus;
  deploymentType: string;
  engagement: EngagementLevel;
  blockersStatus: string;
  blockers: string;
  feedbackStatus: string;
  feedback: string;
  summary: string;
  mau: string;
  ttiv: string;
  autoOptimizeButtonPressed: string;
  lastUpdated: string;
  hidden?: boolean;
  headless?: boolean;
  preflightEnabled?: boolean;
  customFields?: Record<string, { value: string; section: string } | string> | null;
}

export interface CustomersDataset {
  data: Customer[];
}

export interface Week {
  id: string; // ISO date string e.g. "2026-01-23"
  label: string;
}

export interface AISummarySection {
  title: string;
  content: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Additional domain types matching the Amplify schema models
// ─────────────────────────────────────────────────────────────────────────────

export interface WeeklySummary {
  week: string;
  totalCustomers: number;
  activeCount: number;
  atRiskCount: number;
  onboardingCount: number;
  preProductionCount: number;
  churnedCount: number;
  highEngagementCount: number;
  mediumEngagementCount: number;
  lowEngagementCount: number;
  computedAt: string;
  dataSource: string;
}

export interface SyncJobRecord {
  id: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  startedAt: string;
  completedAt: string | null;
  weekIngested: string | null;
  recordsProcessed: number | null;
  recordsFailed: number | null;
  errorMessage: string | null;
  triggeredBy: string | null;
}

export interface CustomerNote {
  id: string;
  companyName: string;
  week: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer Progression — manual tracking of Moving / On Hold pipeline
// ─────────────────────────────────────────────────────────────────────────────

export type ProgressionTrack = "Moving" | "On Hold";
export type ProgressionStage = "Prod" | "POC" | "Preprod" | "Future Date" | "Migration";
export type MigrationSource  = "On Prem > AEMCS" | "Non-AEM > AEMCS" | "AMS > AEMCS";
export type MigrationTech    = string; // legacy field, no longer used in UI

export interface CustomerProgression {
  companyName:          string;
  progressionTrack:     ProgressionTrack;
  progressionStage:     ProgressionStage;
  migrationSource:      MigrationSource | null;
  migrationTech:        MigrationTech | null;
  stageEnteredAt:       string; // "YYYY-MM-DD"
  updatedBy:            string;
  updatedAt:            string; // ISO datetime
  notes:                string | null;
  projectedGoLiveDate:       string | null;  // "YYYY-MM-DD" — On Hold + Future Date only
  holdReason:                string | null;  // "Customer requested" | "Security" | "Competing priorities" | "Other"
  holdReasonOther:           string | null;  // free text when holdReason === "Other"
  preprodOnboardFirstSite:      boolean | null; // Active + Preprod checklist
  preprodFcmCompleted:          boolean | null;
  preprodPreflightCompleted:    boolean | null;
  prodAutoOptimizeEnabled:      boolean | null; // Active + Prod checklist
  prodAutoOptimizedOpportunity: boolean | null;
}

export interface CustomerStageHistoryEntry {
  id:                   string;
  companyName:          string;
  changedAt:            string; // ISO datetime
  progressionTrack:     string;
  progressionStage:     string;
  migrationSource:      string | null;
  migrationTech:        string | null;
  changedBy:            string;
  notes:                string | null;
  projectedGoLiveDate:       string | null;
  holdReason:                string | null;
  holdReasonOther:           string | null;
  preprodOnboardFirstSite:      boolean | null;
  preprodFcmCompleted:          boolean | null;
  preprodPreflightCompleted:    boolean | null;
  prodAutoOptimizeEnabled:      boolean | null;
  prodAutoOptimizedOpportunity: boolean | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Query result envelope — forces callers to handle both paths
// ─────────────────────────────────────────────────────────────────────────────

export type QueryResult<T> =
  | { data: T; error: null }
  | { data: null; error: string };
