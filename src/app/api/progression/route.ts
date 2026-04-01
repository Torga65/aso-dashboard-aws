/**
 * GET    /api/progression?company=<name>  — get current progression for a customer
 * PUT    /api/progression                 — upsert progression (create or update)
 * DELETE /api/progression?company=<name>  — remove a customer from the pipeline
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/amplify-server-utils";
import { toCustomerProgression, toStageHistoryEntry } from "@/lib/mappers";

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get("company")?.trim();
  if (!company) {
    return NextResponse.json({ error: "company param required" }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const { data, errors } = await client.models.CustomerProgression.get({ companyName: company });
    if (errors?.length) {
      return NextResponse.json({ error: errors[0].message }, { status: 500 });
    }
    return NextResponse.json({ data: data ? toCustomerProgression(data) : null });
  } catch (err) {
    console.error("[/api/progression] GET error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      companyName, progressionTrack, progressionStage,
      migrationSource, migrationTech, stageEnteredAt,
      updatedBy, notes,
    } = body;

    if (!companyName || !progressionTrack || !progressionStage || !stageEnteredAt) {
      return NextResponse.json(
        { error: "companyName, progressionTrack, progressionStage, stageEnteredAt are required" },
        { status: 400 }
      );
    }
    const resolvedUpdatedBy = updatedBy || "unknown";

    const now = new Date().toISOString();
    const client = getServerClient();

    // Upsert: try update first, fallback to create
    let result;
    const { data: existing } = await client.models.CustomerProgression.get({ companyName });

    const payload = {
      companyName,
      progressionTrack,
      progressionStage,
      migrationSource: migrationSource ?? null,
      migrationTech:   migrationTech   ?? null,
      stageEnteredAt,
      updatedBy: resolvedUpdatedBy,
      updatedAt: now,
      notes:     notes ?? null,
    };

    if (existing) {
      const { data, errors } = await client.models.CustomerProgression.update(payload);
      if (errors?.length) return NextResponse.json({ error: errors[0].message }, { status: 500 });
      result = data;
    } else {
      const { data, errors } = await client.models.CustomerProgression.create(payload);
      if (errors?.length) return NextResponse.json({ error: errors[0].message }, { status: 500 });
      result = data;
    }

    // Append history record
    await client.models.CustomerStageHistory.create({
      companyName,
      changedAt:        now,
      progressionTrack,
      progressionStage,
      migrationSource:  migrationSource ?? null,
      migrationTech:    migrationTech   ?? null,
      changedBy:        resolvedUpdatedBy,
      notes:            notes ?? null,
    });

    return NextResponse.json({ data: result ? toCustomerProgression(result) : null });
  } catch (err) {
    console.error("[/api/progression] PUT error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const company = req.nextUrl.searchParams.get("company")?.trim();
  if (!company) {
    return NextResponse.json({ error: "company param required" }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const { errors } = await client.models.CustomerProgression.delete({ companyName: company });
    if (errors?.length) {
      return NextResponse.json({ error: errors[0].message }, { status: 500 });
    }
    return NextResponse.json({ data: { deleted: company } });
  } catch (err) {
    console.error("[/api/progression] DELETE error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
