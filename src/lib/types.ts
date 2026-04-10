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
  healthScoreRaw: string;
  /** 0–100 */
  healthScore: number;
  summary: string;
  mau: string;
  ttiv: string;
  autoOptimizeButtonPressed: string;
  lastUpdated: string;
  hidden?: boolean;
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
  avgHealthScore: number;
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
export type MigrationSource  = "On Prem" | "AMS";
export type MigrationTech    = "AEM" | "Not AEM";

export interface CustomerProgression {
  companyName:      string;
  progressionTrack: ProgressionTrack;
  progressionStage: ProgressionStage;
  migrationSource:  MigrationSource | null;
  migrationTech:    MigrationTech | null;
  stageEnteredAt:   string; // "YYYY-MM-DD"
  updatedBy:        string;
  updatedAt:        string; // ISO datetime
  notes:            string | null;
}

export interface CustomerStageHistoryEntry {
  id:               string;
  companyName:      string;
  changedAt:        string; // ISO datetime
  progressionTrack: string;
  progressionStage: string;
  migrationSource:  string | null;
  migrationTech:    string | null;
  changedBy:        string;
  notes:            string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Query result envelope — forces callers to handle both paths
// ─────────────────────────────────────────────────────────────────────────────

export type QueryResult<T> =
  | { data: T; error: null }
  | { data: null; error: string };
