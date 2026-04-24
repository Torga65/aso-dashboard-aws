import { describe, it, expect } from "vitest";
import {
  toCustomer,
  toWeeklySummary,
  toSyncJob,
  toCustomerNote,
  toCustomerProgression,
  toStageHistoryEntry,
} from "@/lib/mappers";

// Minimal snapshot factory — only the fields mappers actually read
function makeSnap(overrides: Record<string, unknown> = {}) {
  return {
    week: "2026-04-21",
    companyName: "Acme Corp",
    imsOrgId: "org123",
    licenseType: "Enterprise",
    industry: "Technology",
    eseLead: "john.doe@adobe.com",
    status: "Active",
    deploymentType: "Cloud",
    engagement: "High",
    blockersStatus: "",
    blockers: "",
    feedbackStatus: "",
    feedback: "",
    healthScore: 80,
    summary: "",
    mau: "",
    ttiv: "",
    autoOptimizeButtonPressed: "No",
    sourceLastUpdated: "2026-04-21",
    ingestedAt: "2026-04-22",
    hidden: false,
    ...overrides,
  };
}

// ─── normalizeStatus (tested via toCustomer) ──────────────────────────────────

describe("normalizeStatus", () => {
  it.each([
    ["production", "Active"],
    ["Production", "Active"],
    ["pre-production", "Pre-Production"],
    ["Pre-Production", "Pre-Production"],
    ["on-hold", "On-Hold"],
    ["dead", "Churned"],
    ["terminated", "Churned"],
    ["sandbox", "Pre-Production"],
    ["Active", "Active"],
    ["At-Risk", "At-Risk"],
    ["Onboarding", "Onboarding"],
  ])("maps %s → %s", (raw, expected) => {
    const c = toCustomer(makeSnap({ status: raw }) as never);
    expect(c.status).toBe(expected);
  });

  it("passes through unknown statuses unchanged", () => {
    const c = toCustomer(makeSnap({ status: "Mystery" }) as never);
    expect(c.status).toBe("Mystery");
  });

  it("returns empty string for null status", () => {
    const c = toCustomer(makeSnap({ status: null }) as never);
    expect(c.status).toBe("");
  });
});

// ─── normalizeEngagement (tested via toCustomer) ──────────────────────────────

describe("normalizeEngagement", () => {
  it.each([
    ["active", "High"],
    ["at risk", "Medium"],
    ["critical", "Low"],
    ["High", "High"],
    ["Medium", "Medium"],
    ["Low", "Low"],
    ["high", "High"],
    ["medium", "Medium"],
    ["low", "Low"],
  ])("maps %s → %s", (raw, expected) => {
    const c = toCustomer(makeSnap({ engagement: raw }) as never);
    expect(c.engagement).toBe(expected);
  });

  it("returns Unknown for unrecognised engagement values", () => {
    const c = toCustomer(makeSnap({ engagement: "weird" }) as never);
    expect(c.engagement).toBe("Unknown");
  });

  it("returns Unknown for null engagement", () => {
    const c = toCustomer(makeSnap({ engagement: null }) as never);
    expect(c.engagement).toBe("Unknown");
  });
});

// ─── toCustomer ───────────────────────────────────────────────────────────────

describe("toCustomer", () => {
  it("maps all fields correctly for a complete snapshot", () => {
    const snap = makeSnap();
    const c = toCustomer(snap as never);

    expect(c.week).toBe("2026-04-21");
    expect(c.companyName).toBe("Acme Corp");
    expect(c.imsOrgId).toBe("org123");
    expect(c.healthScore).toBe(80);
    expect(c.healthScoreRaw).toBe("80");
    expect(c.lastUpdated).toBe("2026-04-21"); // prefers sourceLastUpdated
  });

  it("falls back to ingestedAt when sourceLastUpdated is null", () => {
    const c = toCustomer(makeSnap({ sourceLastUpdated: null }) as never);
    expect(c.lastUpdated).toBe("2026-04-22");
  });

  it("defaults healthScore to 50 when null", () => {
    const c = toCustomer(makeSnap({ healthScore: null }) as never);
    expect(c.healthScore).toBe(50);
    expect(c.healthScoreRaw).toBe("50");
  });

  it("defaults hidden to false", () => {
    const c = toCustomer(makeSnap({ hidden: null }) as never);
    expect(c.hidden).toBe(false);
  });

  it("defaults autoOptimizeButtonPressed to No", () => {
    const c = toCustomer(makeSnap({ autoOptimizeButtonPressed: null }) as never);
    expect(c.autoOptimizeButtonPressed).toBe("No");
  });
});

// ─── toWeeklySummary ──────────────────────────────────────────────────────────

describe("toWeeklySummary", () => {
  const base = {
    week: "2026-04-21",
    totalCustomers: 100,
    activeCount: 60,
    atRiskCount: 10,
    onboardingCount: 5,
    preProductionCount: 15,
    churnedCount: 10,
    avgHealthScore: 72,
    highEngagementCount: 40,
    mediumEngagementCount: 30,
    lowEngagementCount: 30,
    computedAt: "2026-04-21T00:00:00Z",
    dataSource: "amplify",
  };

  it("maps all fields", () => {
    const s = toWeeklySummary(base as never);
    expect(s.totalCustomers).toBe(100);
    expect(s.avgHealthScore).toBe(72);
    expect(s.week).toBe("2026-04-21");
  });

  it("defaults numeric fields to 0 when null", () => {
    const s = toWeeklySummary({ ...base, totalCustomers: null, activeCount: null } as never);
    expect(s.totalCustomers).toBe(0);
    expect(s.activeCount).toBe(0);
  });

  it("defaults dataSource to empty string when null", () => {
    const s = toWeeklySummary({ ...base, dataSource: null } as never);
    expect(s.dataSource).toBe("");
  });
});

// ─── toSyncJob ────────────────────────────────────────────────────────────────

describe("toSyncJob", () => {
  it("maps all fields with nulls preserved", () => {
    const record = {
      id: "job-1",
      status: "COMPLETED",
      startedAt: "2026-04-21T10:00:00Z",
      completedAt: "2026-04-21T10:05:00Z",
      weekIngested: "2026-04-21",
      recordsProcessed: 100,
      recordsFailed: 0,
      errorMessage: null,
      triggeredBy: "admin",
    };
    const j = toSyncJob(record as never);
    expect(j.id).toBe("job-1");
    expect(j.status).toBe("COMPLETED");
    expect(j.errorMessage).toBeNull();
  });

  it("defaults optional fields to null", () => {
    const j = toSyncJob({
      id: "job-2",
      status: "RUNNING",
      startedAt: "2026-04-21T10:00:00Z",
    } as never);
    expect(j.completedAt).toBeNull();
    expect(j.weekIngested).toBeNull();
    expect(j.recordsProcessed).toBeNull();
    expect(j.errorMessage).toBeNull();
  });
});

// ─── toCustomerNote ───────────────────────────────────────────────────────────

describe("toCustomerNote", () => {
  it("maps all fields", () => {
    const record = {
      id: "note-1",
      companyName: "Acme Corp",
      week: "2026-04-21",
      note: "Good progress",
      createdAt: "2026-04-21T12:00:00Z",
      updatedAt: "2026-04-21T12:00:00Z",
    };
    const n = toCustomerNote(record as never);
    expect(n.id).toBe("note-1");
    expect(n.note).toBe("Good progress");
  });
});

// ─── toCustomerProgression ────────────────────────────────────────────────────

describe("toCustomerProgression", () => {
  it("maps all fields", () => {
    const record = {
      companyName: "Acme Corp",
      progressionTrack: "Moving",
      progressionStage: "Prod",
      migrationSource: "On Prem",
      migrationTech: "AEM",
      stageEnteredAt: "2026-04-01",
      updatedBy: "user@adobe.com",
      updatedAt: "2026-04-21T12:00:00Z",
      notes: "On track",
    };
    const p = toCustomerProgression(record as never);
    expect(p.progressionTrack).toBe("Moving");
    expect(p.migrationSource).toBe("On Prem");
    expect(p.notes).toBe("On track");
  });

  it("defaults notes and migration fields to null", () => {
    const p = toCustomerProgression({
      companyName: "Acme",
      progressionTrack: "On Hold",
      progressionStage: "POC",
      migrationSource: null,
      migrationTech: null,
      stageEnteredAt: "2026-04-01",
      updatedBy: "user@adobe.com",
      updatedAt: "2026-04-21T12:00:00Z",
      notes: null,
    } as never);
    expect(p.migrationSource).toBeNull();
    expect(p.notes).toBeNull();
  });
});

// ─── toStageHistoryEntry ──────────────────────────────────────────────────────

describe("toStageHistoryEntry", () => {
  it("maps all fields", () => {
    const record = {
      id: "hist-1",
      companyName: "Acme Corp",
      changedAt: "2026-04-21T12:00:00Z",
      progressionTrack: "Moving",
      progressionStage: "Prod",
      migrationSource: null,
      migrationTech: null,
      changedBy: "admin@adobe.com",
      notes: null,
    };
    const h = toStageHistoryEntry(record as never);
    expect(h.id).toBe("hist-1");
    expect(h.changedBy).toBe("admin@adobe.com");
    expect(h.migrationSource).toBeNull();
  });
});
