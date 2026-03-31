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
    const allRecords = [];
    let nextToken: string | null | undefined = undefined;

    // Paginate through all CustomerSnapshot records
    do {
      const result = await client.models.CustomerSnapshot.list({
        limit: 1000,
        ...(nextToken ? { nextToken } : {}),
      });

      if (result.errors?.length) {
        return NextResponse.json(
          { error: result.errors[0].message },
          { status: 500 }
        );
      }

      allRecords.push(...(result.data ?? []).map(toCustomer));
      nextToken = result.nextToken;
    } while (nextToken);

    return NextResponse.json({ data: allRecords });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load customers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
