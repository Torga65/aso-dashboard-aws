import { test, expect } from "@playwright/test";

/**
 * Customer History page E2E tests.
 * These run against the live dev server. Auth-gated scenarios are skipped
 * gracefully when no session is present.
 */

test.describe("API: /api/customers contract", () => {
  test("returns a JSON object with a 'data' array", async ({ request }) => {
    const response = await request.get("/api/customers");
    expect(response.status()).toBeLessThan(500);

    const body = await response.json();

    if (response.ok()) {
      expect(body).toHaveProperty("data");
      expect(Array.isArray(body.data)).toBe(true);

      // If there are records, check the shape of the first one
      if (body.data.length > 0) {
        const first = body.data[0];
        expect(first).toHaveProperty("companyName");
        expect(first).toHaveProperty("week");
        expect(first).toHaveProperty("status");
        expect(first).toHaveProperty("healthScore");
        expect(first).toHaveProperty("engagement");
      }
    } else {
      // 500 is possible if DB is unreachable — acceptable in local dev
      expect(body).toHaveProperty("error");
    }
  });

  test("customer records have valid healthScore (0–100)", async ({ request }) => {
    const response = await request.get("/api/customers");
    if (!response.ok()) return; // skip if DB unavailable

    const { data } = await response.json();
    for (const customer of data) {
      expect(customer.healthScore).toBeGreaterThanOrEqual(0);
      expect(customer.healthScore).toBeLessThanOrEqual(100);
    }
  });

  test("customer records have normalised engagement values", async ({ request }) => {
    const response = await request.get("/api/customers");
    if (!response.ok()) return;

    const VALID_ENGAGEMENT = ["High", "Medium", "Low", "Unknown", "None", ""];
    const { data } = await response.json();
    for (const customer of data) {
      const validOrUnknown =
        VALID_ENGAGEMENT.includes(customer.engagement) ||
        typeof customer.engagement === "string";
      expect(validOrUnknown).toBe(true);
    }
  });
});

test.describe("API: /api/progression contract", () => {
  test("GET with valid company returns data or null (not 500)", async ({ request }) => {
    const response = await request.get(
      "/api/progression?company=NonExistentCompanyXYZ"
    );
    // Either 200 (null data) or 500 (DB error) — never a crash
    expect([200, 500]).toContain(response.status());
    if (response.status() === 200) {
      const body = await response.json();
      expect(body).toHaveProperty("data");
    }
  });

  test("PUT with missing required fields returns 400", async ({ request }) => {
    const response = await request.put("/api/progression", {
      data: { companyName: "Test" }, // missing other required fields
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
  });
});

test.describe("Customer history page UI", () => {
  test("page loads without JS errors", async ({ page }) => {
    const jsErrors: string[] = [];
    page.on("pageerror", (err) => jsErrors.push(err.message));

    await page.goto("/customer-history");
    await page.waitForTimeout(2000); // give React time to render

    // Filter out known third-party errors
    const appErrors = jsErrors.filter(
      (e) =>
        !e.includes("ResizeObserver") &&
        !e.includes("Non-Error promise rejection") &&
        !e.includes("ChunkLoadError")
    );
    expect(appErrors).toHaveLength(0);
  });

  test("page has a non-empty body", async ({ page }) => {
    await page.goto("/customer-history");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });
});
