/**
 * POST /api/customers/upsert
 *
 * Creates or updates a CustomerSnapshot record.
 * Used by the customer-history-edit.html form page.
 *
 * Body: Partial CustomerSnapshot fields. companyName is required.
 * week defaults to the current Monday if not supplied.
 * ingestedAt and dataSource are always set server-side.
 */

import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/amplify-server-utils";

export const dynamic = "force-dynamic";

/** Known CustomerSnapshot fields safe to pass to Amplify (matches deployed schema). */
const SNAPSHOT_FIELDS = [
  "licenseType", "industry", "eseLead", "status", "deploymentType",
  "engagement", "blockersStatus", "blockers", "feedbackStatus", "feedback",
  "healthScore", "summary", "mau", "ttiv", "autoOptimizeButtonPressed",
  "imsOrgId", "tenantId", "terminationReason", "comments", "sourceLastUpdated",
] as const;

/** Returns the ISO date string (YYYY-MM-DD) for the Monday of the current week. */
function currentWeekMonday(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { companyName, week: rawWeek, customFields, hidden, headless, preflightEnabled, ...rest } = body;

    if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
      return NextResponse.json({ error: "companyName is required" }, { status: 400 });
    }

    const week = rawWeek?.trim() || currentWeekMonday();

    // Build input from explicit known fields only — avoids passing unknown fields
    // to the Amplify client which would cause the AppSync mutation to be rejected.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input: Record<string, any> = {
      companyName: companyName.trim(),
      week,
      ingestedAt: new Date().toISOString(),
      dataSource: "Manual",
    };

    for (const field of SNAPSHOT_FIELDS) {
      const val = rest[field] ?? body[field];
      if (val !== undefined && val !== null && val !== "") {
        input[field] = field === "healthScore" ? Number(val) : val;
      }
    }

    // customFields — only include if non-empty, so older deployments without the
    // field aren't broken.
    if (customFields && typeof customFields === "object" && Object.keys(customFields).length > 0) {
      input.customFields = customFields;
    }

    // boolean flags — explicitly store false so toggles work correctly
    if (typeof hidden === "boolean") input.hidden = hidden;
    if (typeof headless === "boolean") input.headless = headless;
    if (typeof preflightEnabled === "boolean") input.preflightEnabled = preflightEnabled;

    const client = getServerClient();

    // Check for existing record
    const { data: existing, errors: getErrors } = await client.models.CustomerSnapshot.get({
      companyName: input.companyName as string,
      week,
    });

    if (getErrors?.length) {
      console.error("[/api/customers/upsert] get errors:", getErrors);
    }

    if (existing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, errors } = await client.models.CustomerSnapshot.update(input as any);
      if (errors?.length) {
        console.error("[/api/customers/upsert] update errors:", errors);
        return NextResponse.json({ error: errors.map((e: { message: string }) => e.message).join(", ") }, { status: 500 });
      }
      if (!data) {
        console.error("[/api/customers/upsert] update returned null — possible schema mismatch");
        return NextResponse.json({ error: "Update returned no data — record may not have been saved" }, { status: 500 });
      }
      await ensureWeeklySummary(client, week);
      return NextResponse.json({ action: "updated", data });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, errors } = await client.models.CustomerSnapshot.create(input as any);
    if (errors?.length) {
      console.error("[/api/customers/upsert] create errors:", errors);
      return NextResponse.json({ error: errors.map((e: { message: string }) => e.message).join(", ") }, { status: 500 });
    }
    if (!data) {
      console.error("[/api/customers/upsert] create returned null — possible schema mismatch");
      return NextResponse.json({ error: "Create returned no data — record may not have been saved" }, { status: 500 });
    }
    await ensureWeeklySummary(client, week);
    return NextResponse.json({ action: "created", data });

  } catch (err) {
    console.error("[/api/customers/upsert] Unhandled error:", err);
    const message = err instanceof Error ? err.message : "Failed to save customer";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Ensure a WeeklySummary row exists for the given week so that
 * /api/customers Strategy 1 (week-based GSI queries) will include
 * this week and return the upserted snapshot.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureWeeklySummary(client: any, week: string) {
  try {
    const { data: existing } = await client.models.WeeklySummary.get({ week });
    if (!existing) {
      await client.models.WeeklySummary.create({ week, totalCustomers: 0, dataSource: "Manual" });
    }
  } catch (err) {
    // Non-fatal — the fallback full-scan in /api/customers will still work
    console.warn("[/api/customers/upsert] WeeklySummary upsert failed (non-fatal):", err);
  }
}
