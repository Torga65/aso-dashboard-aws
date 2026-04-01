/**
 * GET /api/progression/history?company=<name>  — stage change history for one customer
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/amplify-server-utils";
import { toStageHistoryEntry } from "@/lib/mappers";

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get("company")?.trim();
  if (!company) {
    return NextResponse.json({ error: "company param required" }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const { data, errors } =
      await client.models.CustomerStageHistory.listCustomerStageHistoryByCompanyNameAndChangedAt(
        { companyName: company },
        { sortDirection: "DESC", limit: 100 }
      );

    if (errors?.length) {
      return NextResponse.json({ error: errors[0].message }, { status: 500 });
    }

    return NextResponse.json({ data: (data ?? []).map(toStageHistoryEntry) });
  } catch (err) {
    console.error("[/api/progression/history] error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
