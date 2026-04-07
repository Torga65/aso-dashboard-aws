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

/** Returns the ISO date string (YYYY-MM-DD) for the Monday of the current week. */
function currentWeekMonday(): string {
  const d = new Date();
  const day = d.getUTCDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { companyName, week: rawWeek, ...rest } = body;

    if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
      return NextResponse.json({ error: "companyName is required" }, { status: 400 });
    }

    const week = (rawWeek && typeof rawWeek === "string" && rawWeek.trim())
      ? rawWeek.trim()
      : currentWeekMonday();

    const client = getServerClient();

    const input = {
      companyName: companyName.trim(),
      week,
      ingestedAt: new Date().toISOString(),
      dataSource: "Manual",
      ...rest,
    };

    // Check for existing record
    const { data: existing } = await client.models.CustomerSnapshot.get({ companyName: input.companyName, week });

    if (existing) {
      const { data, errors } = await client.models.CustomerSnapshot.update(input);
      if (errors?.length) {
        return NextResponse.json({ error: errors.map((e: { message: string }) => e.message).join(", ") }, { status: 500 });
      }
      return NextResponse.json({ action: "updated", data });
    }

    const { data, errors } = await client.models.CustomerSnapshot.create(input);
    if (errors?.length) {
      return NextResponse.json({ error: errors.map((e: { message: string }) => e.message).join(", ") }, { status: 500 });
    }
    return NextResponse.json({ action: "created", data });

  } catch (err) {
    console.error("[/api/customers/upsert] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to save customer";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
