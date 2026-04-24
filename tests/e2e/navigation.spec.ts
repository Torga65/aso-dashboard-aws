import { test, expect } from "@playwright/test";

/**
 * Navigation smoke tests — verify every top-level route loads without a 500
 * or blank page. These run against a live dev server and do NOT require auth
 * for routes that are publicly accessible (static pages, etc.).
 * Auth-gated routes are expected to redirect to IMS sign-in.
 */

const AUTH_REDIRECT_PATTERNS = [
  /ims-na1\.adobelogin\.com/,
  /adobelogin\.com/,
  /\/login/,
];

function isAuthRedirect(url: string) {
  return AUTH_REDIRECT_PATTERNS.some((p) => p.test(url));
}

test.describe("Top-level routes", () => {
  test("/ redirects to /customer-history or auth", async ({ page }) => {
    const response = await page.goto("/");
    // Either we land on customer-history or get redirected to IMS login
    const finalUrl = page.url();
    const isExpectedRoute =
      finalUrl.includes("/customer-history") || isAuthRedirect(finalUrl);
    expect(isExpectedRoute).toBe(true);
    // No server error
    if (response) expect(response.status()).toBeLessThan(500);
  });

  test("/customer-history loads without 500", async ({ page }) => {
    const response = await page.goto("/customer-history");
    if (response) expect(response.status()).toBeLessThan(500);
    const finalUrl = page.url();
    // If not redirected to auth, page should have content
    if (!isAuthRedirect(finalUrl)) {
      await expect(page.locator("body")).not.toBeEmpty();
    }
  });

  test("/dashboard loads without 500", async ({ page }) => {
    const response = await page.goto("/dashboard");
    if (response) expect(response.status()).toBeLessThan(500);
  });

  test("/reports loads without 500", async ({ page }) => {
    const response = await page.goto("/reports");
    if (response) expect(response.status()).toBeLessThan(500);
  });

  test("/engagement loads without 500", async ({ page }) => {
    const response = await page.goto("/engagement");
    if (response) expect(response.status()).toBeLessThan(500);
  });

  test("/engagement/weekly loads without 500", async ({ page }) => {
    const response = await page.goto("/engagement/weekly");
    if (response) expect(response.status()).toBeLessThan(500);
  });

  test("/suggestion-lifecycle loads without 500", async ({ page }) => {
    const response = await page.goto("/suggestion-lifecycle");
    if (response) expect(response.status()).toBeLessThan(500);
  });

  test("/validator loads without 500", async ({ page }) => {
    const response = await page.goto("/validator");
    if (response) expect(response.status()).toBeLessThan(500);
  });

  test("/developer loads without 500", async ({ page }) => {
    const response = await page.goto("/developer");
    if (response) expect(response.status()).toBeLessThan(500);
  });

  test("/teams-settings loads without 500", async ({ page }) => {
    const response = await page.goto("/teams-settings");
    if (response) expect(response.status()).toBeLessThan(500);
  });
});

test.describe("API routes (unauthenticated)", () => {
  test("GET /api/customers returns JSON (not HTML error page)", async ({ page }) => {
    const response = await page.request.get("/api/customers");
    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/json");
  });

  test("GET /api/progression without company param returns 400", async ({ page }) => {
    const response = await page.request.get("/api/progression");
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
  });

  test("DELETE /api/progression without company param returns 400", async ({ page }) => {
    const response = await page.request.delete("/api/progression");
    expect(response.status()).toBe(400);
  });

  test("GET /api/teams/status returns JSON", async ({ page }) => {
    const response = await page.request.get("/api/teams/status");
    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/json");
  });
});
