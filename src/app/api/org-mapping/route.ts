/**
 * GET  /api/org-mapping?company=<companyName>
 *   Returns { spacecatOrgId } for the given company, or 404 if not mapped.
 *
 * PUT  /api/org-mapping
 *   Body: { companyName, spacecatOrgId }
 *   Saves (upsert) the org mapping. Returns { ok: true }.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/amplify-server-utils";

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get("company")?.trim();
  if (!company) {
    return NextResponse.json({ error: "Missing company param" }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const { data, errors } = await client.models.CustomerOrgMapping.get({ companyName: company });

    if (errors?.length) {
      return NextResponse.json({ error: errors[0].message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ spacecatOrgId: data.spacecatOrgId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get org mapping";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  let body: { companyName?: string; spacecatOrgId?: string; updatedBy?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { companyName, spacecatOrgId, updatedBy } = body;
  if (!companyName || !spacecatOrgId) {
    return NextResponse.json({ error: "companyName and spacecatOrgId are required" }, { status: 400 });
  }

  try {
    const client = getServerClient();

    // Upsert: try update first, fall back to create
    const { errors: updateErrors } = await client.models.CustomerOrgMapping.update({
      companyName,
      spacecatOrgId,
      ...(updatedBy ? { updatedBy } : {}),
    });

    if (updateErrors?.length) {
      // Record may not exist yet — create it
      const { errors: createErrors } = await client.models.CustomerOrgMapping.create({
        companyName,
        spacecatOrgId,
        ...(updatedBy ? { updatedBy } : {}),
      });
      if (createErrors?.length) {
        return NextResponse.json({ error: createErrors[0].message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save org mapping";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
