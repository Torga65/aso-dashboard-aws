/**
 * GET /api/customers
 *
 * Returns all CustomerSnapshot records across all weeks as a flat JSON array.
 * Consumed by the static customer-history.html page (iframe) which cannot
 * use the Amplify client directly.
 *
 * Response shape: { data: Customer[] }
 *
 * Strategy (in order):
 *  1. Get available weeks from WeeklySummary and query each week in parallel
 *     via the week GSI — avoids full-table-scan issues with composite keys.
 *  2. If WeeklySummary is empty (hasn't been seeded yet), fall back to
 *     CustomerSnapshot.list() with nextToken pagination.
 */

import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/amplify-server-utils";
import { toCustomer } from "@/lib/mappers";

export async function GET() {
  try {
    const client = getServerClient();

    // ── Strategy 1: week-based parallel queries via GSI ──────────────────────
    const { data: summaries, errors: weekErrors } =
      await client.models.WeeklySummary.list({ limit: 200 });

    if (weekErrors?.length) {
      console.error("[/api/customers] WeeklySummary.list errors:", weekErrors);
    }

    const weeks = (summaries ?? []).map((s) => s.week).filter(Boolean);

    if (weeks.length > 0) {
      const weekResults = await Promise.all(
        weeks.map((week) =>
          client.models.CustomerSnapshot.listCustomerSnapshotByWeekAndCompanyName(
            { week },
            { limit: 1000 }
          )
        )
      );

      // Log any per-week errors to help diagnose schema mismatches
      weekResults.forEach(({ errors }, i) => {
        if (errors?.length) {
          console.error(`[/api/customers] week ${weeks[i]} query errors:`, errors);
        }
      });

      const allRecords = weekResults.flatMap(({ data }) =>
        (data ?? []).map(toCustomer)
      );

      if (allRecords.length > 0) {
        return NextResponse.json({ data: allRecords });
      }

      console.warn(
        "[/api/customers] Week-based queries returned 0 records across",
        weeks.length,
        "weeks — falling back to CustomerSnapshot.list()"
      );
    } else {
      console.warn("[/api/customers] WeeklySummary empty — falling back to CustomerSnapshot.list()");
    }

    // ── Strategy 2: paginated full-table scan ─────────────────────────────────
    const allRecords = [];
    let nextToken: string | undefined = undefined;

    do {
      const listOpts: { limit: number; nextToken?: string } = { limit: 1000 };
      if (nextToken) listOpts.nextToken = nextToken;
      const result = await client.models.CustomerSnapshot.list(listOpts);
      const { data, errors } = result;
      const next: string | undefined = (result as { nextToken?: string }).nextToken ?? undefined;

      if (errors?.length) {
        console.error("[/api/customers] CustomerSnapshot.list errors:", errors);
        break;
      }

      allRecords.push(...(data ?? []).map(toCustomer));
      nextToken = next ?? undefined;
    } while (nextToken);

    console.log(`[/api/customers] CustomerSnapshot.list returned ${allRecords.length} records`);
    return NextResponse.json({ data: allRecords });

  } catch (err) {
    console.error("[/api/customers] Unhandled error:", err);
    const message = err instanceof Error ? err.message : "Failed to load customers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
