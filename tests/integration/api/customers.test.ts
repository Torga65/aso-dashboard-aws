import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Mock the Amplify server utilities before importing the route
vi.mock("@/lib/server/load-all-customers", () => ({
  loadAllCustomers: vi.fn(),
}));

import { GET } from "@/app/api/customers/route";
import { loadAllCustomers } from "@/lib/server/load-all-customers";

const mockLoadAllCustomers = vi.mocked(loadAllCustomers);

const SAMPLE_CUSTOMERS = [
  {
    week: "2026-04-21",
    companyName: "Acme Corp",
    imsOrgId: "org1",
    licenseType: "Enterprise",
    industry: "Tech",
    eseLead: "user@adobe.com",
    status: "Active",
    deploymentType: "Cloud",
    engagement: "High",
    blockersStatus: "",
    blockers: "",
    feedbackStatus: "",
    feedback: "",
    healthScoreRaw: "80",
    healthScore: 80,
    summary: "",
    mau: "",
    ttiv: "",
    autoOptimizeButtonPressed: "No",
    lastUpdated: "2026-04-21",
  },
];

describe("GET /api/customers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with customer data array", async () => {
    mockLoadAllCustomers.mockResolvedValue(SAMPLE_CUSTOMERS as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].companyName).toBe("Acme Corp");
  });

  it("returns 200 with empty array when no customers", async () => {
    mockLoadAllCustomers.mockResolvedValue([]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("returns 500 with error message when loadAllCustomers throws", async () => {
    mockLoadAllCustomers.mockRejectedValue(new Error("DB connection failed"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toHaveProperty("error");
    expect(body.error).toContain("DB connection failed");
  });

  it("returns 500 with generic message for non-Error throws", async () => {
    mockLoadAllCustomers.mockRejectedValue("unknown failure");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load customers");
  });

  it("response shape always has a data key on success", async () => {
    mockLoadAllCustomers.mockResolvedValue(SAMPLE_CUSTOMERS as never);
    const response = await GET();
    const body = await response.json();
    expect(Object.keys(body)).toContain("data");
    expect(Object.keys(body)).not.toContain("error");
  });
});
