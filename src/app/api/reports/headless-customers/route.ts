/**
 * GET /api/reports/headless-customers
 *
 * Latest snapshot per company where the customer is marked headless:
 *   - deploymentType contains "headless" (case-insensitive), or
 *   - customFields.headless is truthy (true / yes / 1 / y; supports { value: "..." } shape)
 *
 * Excludes hidden customers. No auth required (same access pattern as GET /api/customers).
 */

import { NextResponse } from "next/server";
import { isCustomerHeadless } from "@/lib/customer-headless";
import { loadAllCustomers } from "@/lib/server/load-all-customers";

export const dynamic = "force-dynamic";

function latestByCompanyName<T extends { companyName: string; week: string; hidden?: boolean }>(
  rows: T[]
): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) {
    if (r.hidden) continue;
    const prev = m.get(r.companyName);
    if (!prev || r.week > prev.week) m.set(r.companyName, r);
  }
  return m;
}

export async function GET() {
  try {
    const all = await loadAllCustomers();
    const latest = [...latestByCompanyName(all).values()];
    const headless = latest.filter(isCustomerHeadless).sort((a, b) =>
      a.companyName.localeCompare(b.companyName)
    );

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      count: headless.length,
      definition:
        'Latest snapshot per company; headless = deploymentType contains "headless" OR customFields.headless in {true,yes,1,y}.',
      customers: headless.map((c) => ({
        companyName: c.companyName,
        week: c.week,
        status: c.status,
        licenseType: c.licenseType,
        deploymentType: c.deploymentType || "",
        eseLead: c.eseLead || "",
        imsOrgId: c.imsOrgId || "",
        headlessFlag: (() => {
          const cf = c.customFields as Record<string, unknown> | null | undefined;
          const h = cf?.headless ?? cf?.Headless;
          if (h != null && typeof h === "object" && h !== null && "value" in h) {
            return (h as { value: unknown }).value;
          }
          return h ?? null;
        })(),
      })),
    });
  } catch (err) {
    console.error("[/api/reports/headless-customers]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to build report" },
      { status: 500 }
    );
  }
}
