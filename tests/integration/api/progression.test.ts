import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock Amplify server client
const mockGet = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock("@/lib/amplify-server-utils", () => ({
  getServerClient: () => ({
    models: {
      CustomerProgression: {
        get: mockGet,
        create: mockCreate,
        update: mockUpdate,
        delete: mockDelete,
      },
      CustomerStageHistory: {
        create: vi.fn().mockResolvedValue({ data: {}, errors: null }),
      },
    },
  }),
}));

import { GET, PUT, DELETE } from "@/app/api/progression/route";

function makeRequest(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "Content-Type": "application/json" } : undefined,
  });
}

const SAMPLE_PROGRESSION = {
  companyName: "Acme Corp",
  progressionTrack: "Moving",
  progressionStage: "Prod",
  migrationSource: null,
  migrationTech: null,
  stageEnteredAt: "2026-04-01",
  updatedBy: "admin@adobe.com",
  updatedAt: "2026-04-21T12:00:00Z",
  notes: null,
};

describe("GET /api/progression", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when company param is missing", async () => {
    const req = makeRequest("GET", "http://localhost/api/progression");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/company param required/i);
  });

  it("returns 200 with progression data", async () => {
    mockGet.mockResolvedValue({ data: SAMPLE_PROGRESSION, errors: null });
    const req = makeRequest("GET", "http://localhost/api/progression?company=Acme+Corp");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.companyName).toBe("Acme Corp");
  });

  it("returns 200 with null data when no record found", async () => {
    mockGet.mockResolvedValue({ data: null, errors: null });
    const req = makeRequest("GET", "http://localhost/api/progression?company=NoOne");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeNull();
  });

  it("returns 500 on Amplify errors", async () => {
    mockGet.mockResolvedValue({ data: null, errors: [{ message: "Access denied" }] });
    const req = makeRequest("GET", "http://localhost/api/progression?company=Acme");
    const res = await GET(req);
    expect(res.status).toBe(500);
  });
});

describe("PUT /api/progression", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when required fields are missing", async () => {
    const req = makeRequest("PUT", "http://localhost/api/progression", {
      companyName: "Acme Corp",
      // missing progressionTrack, progressionStage, stageEnteredAt
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("creates a new progression when none exists", async () => {
    mockGet.mockResolvedValue({ data: null }); // no existing record
    mockCreate.mockResolvedValue({ data: SAMPLE_PROGRESSION, errors: null });

    const req = makeRequest("PUT", "http://localhost/api/progression", {
      companyName: "Acme Corp",
      progressionTrack: "Moving",
      progressionStage: "Prod",
      stageEnteredAt: "2026-04-01",
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("updates an existing progression", async () => {
    mockGet.mockResolvedValue({ data: SAMPLE_PROGRESSION }); // existing record
    mockUpdate.mockResolvedValue({ data: SAMPLE_PROGRESSION, errors: null });

    const req = makeRequest("PUT", "http://localhost/api/progression", {
      companyName: "Acme Corp",
      progressionTrack: "On Hold",
      progressionStage: "POC",
      stageEnteredAt: "2026-04-10",
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/progression", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when company param is missing", async () => {
    const req = makeRequest("DELETE", "http://localhost/api/progression");
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it("returns 200 with deleted company name on success", async () => {
    mockDelete.mockResolvedValue({ errors: null });
    const req = makeRequest("DELETE", "http://localhost/api/progression?company=Acme+Corp");
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe("Acme Corp");
  });

  it("returns 500 on Amplify errors", async () => {
    mockDelete.mockResolvedValue({ errors: [{ message: "Not found" }] });
    const req = makeRequest("DELETE", "http://localhost/api/progression?company=Acme");
    const res = await DELETE(req);
    expect(res.status).toBe(500);
  });
});
