/**
 * GET /api/customers
 *
 * Returns all CustomerSnapshot records across all weeks as a flat JSON array.
 * Consumed by the static customer-history.html page (iframe) which cannot
 * use the Amplify client directly.
 *
 * Response shape: { data: Customer[] }
 *
 * Note: CustomerSnapshot uses a custom composite identifier (companyName, week),
 * which makes CustomerSnapshot.list() unreliable as a full table scan.
 * Instead we get all available weeks from WeeklySummary and query each week
 * in parallel using the week secondary index — the same approach that works
 * on the main dashboard pages.
 */

import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/amplify-server-utils";
import { toCustomer } from "@/lib/mappers";

export async function GET() {
  try {
    const client = getServerClient();

    // Step 1: get all known weeks from WeeklySummary (lightweight — at most ~52 records/yr)
    const { data: summaries, errors: weekErrors } =
      await client.models.WeeklySummary.list({ limit: 200 });

    if (weekErrors?.length) {
      return NextResponse.json({ error: weekErrors[0].message }, { status: 500 });
    }

    const weeks = (summaries ?? []).map((s) => s.week);

    if (weeks.length === 0) {
      return NextResponse.json({ data: [] });
    }

    // Step 2: query all customers for every week in parallel
    const weekResults = await Promise.all(
      weeks.map((week) =>
        client.models.CustomerSnapshot.listCustomerSnapshotByWeekAndCompanyName(
          { week },
          { limit: 1000 }
        )
      )
    );

    const allRecords = weekResults.flatMap(({ data }) =>
      (data ?? []).map(toCustomer)
    );

    return NextResponse.json({ data: allRecords });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load customers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
