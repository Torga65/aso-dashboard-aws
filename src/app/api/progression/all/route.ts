/**
 * GET /api/progression/all — list all customer progressions (paginated, up to 1000)
 */

import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/amplify-server-utils";
import { toCustomerProgression } from "@/lib/mappers";

export async function GET() {
  try {
    const client = getServerClient();
    const items: ReturnType<typeof toCustomerProgression>[] = [];
    let nextToken: string | null | undefined = undefined;

    do {
      const { data, errors, nextToken: nt } =
        await client.models.CustomerProgression.list({
          limit: 500,
          ...(nextToken ? { nextToken } : {}),
        });
      if (errors?.length) {
        return NextResponse.json({ error: errors[0].message }, { status: 500 });
      }
      items.push(...(data ?? []).map(toCustomerProgression));
      nextToken = nt as string | null | undefined;
    } while (nextToken);

    return NextResponse.json({ data: items });
  } catch (err) {
    console.error("[/api/progression/all] error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
