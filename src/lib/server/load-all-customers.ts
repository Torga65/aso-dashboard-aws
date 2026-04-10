/**
 * Load every CustomerSnapshot (all weeks) for server-side reports.
 * Mirrors strategy in GET /api/customers.
 */

import { getServerClient } from "@/lib/amplify-server-utils";
import { toCustomer } from "@/lib/mappers";
import type { Customer } from "@/lib/types";

export async function loadAllCustomers(): Promise<Customer[]> {
  const client = getServerClient();

  const { data: summaries, errors: weekErrors } =
    await client.models.WeeklySummary.list({ limit: 200 });

  if (weekErrors?.length) {
    console.error("[loadAllCustomers] WeeklySummary.list errors:", weekErrors);
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

    weekResults.forEach(({ errors }, i) => {
      if (errors?.length) {
        console.error(`[loadAllCustomers] week ${weeks[i]} query errors:`, errors);
      }
    });

    const allRecords = weekResults.flatMap(({ data }) =>
      (data ?? []).map(toCustomer)
    );

    if (allRecords.length > 0) return allRecords;
  }

  const allRecords: Customer[] = [];
  let nextToken: string | undefined = undefined;

  do {
    const listOpts: { limit: number; nextToken?: string } = { limit: 1000 };
    if (nextToken) listOpts.nextToken = nextToken;
    const result = await client.models.CustomerSnapshot.list(listOpts);
    const { data, errors } = result;
    const next: string | undefined = (result as { nextToken?: string }).nextToken ?? undefined;

    if (errors?.length) {
      console.error("[loadAllCustomers] CustomerSnapshot.list errors:", errors);
      break;
    }

    allRecords.push(...(data ?? []).map(toCustomer));
    nextToken = next ?? undefined;
  } while (nextToken);

  return allRecords;
}
