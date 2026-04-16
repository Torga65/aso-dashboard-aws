/**
 * GET /api/customers
 *
 * Returns all CustomerSnapshot records across all weeks as a flat JSON array.
 * Consumed by the static customer-history.html page (iframe) which cannot
 * use the Amplify client directly.
 *
 * Response shape: { data: Customer[] }
 */

import { NextResponse } from "next/server";
import { loadAllCustomers } from "@/lib/server/load-all-customers";

/** Uses cookie-based Amplify client; always run per-request (avoid stale/empty static snapshot). */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const allRecords = await loadAllCustomers();
    console.log(`[/api/customers] returning ${allRecords.length} records`);
    return NextResponse.json({ data: allRecords });
  } catch (err) {
    console.error("[/api/customers] Unhandled error:", err);
    const message = err instanceof Error ? err.message : "Failed to load customers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
