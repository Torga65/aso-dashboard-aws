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
import { getServerClient } from "@/lib/amplify-server-utils";
import { toCustomer } from "@/lib/mappers";

export async function GET() {
  try {
    const client = getServerClient();
    const { data, errors } = await client.models.CustomerSnapshot.list({ limit: 2000 });

    if (errors?.length) {
      return NextResponse.json({ error: errors[0].message }, { status: 500 });
    }

    return NextResponse.json({ data: (data ?? []).map(toCustomer) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load customers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
