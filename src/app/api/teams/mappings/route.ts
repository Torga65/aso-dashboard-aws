/**
 * GET    /api/teams/mappings?userId=       — list mappings for a user
 * POST   /api/teams/mappings               — create a mapping { userId, keyword, companyName }
 * DELETE /api/teams/mappings?id=           — delete a mapping by id
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/amplify-server-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId")?.trim();
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const { data, errors } = await client.models.TeamsMeetingMapping.listTeamsMeetingMappingsByUserIdAndCreatedAt(
      { userId }
    );

    if (errors?.length) {
      return NextResponse.json({ error: errors[0].message }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    console.error("[teams/mappings] GET error:", err);
    return NextResponse.json({ error: "Failed to load mappings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { userId?: string; keyword?: string; companyName?: string };
    const { userId, keyword, companyName } = body;

    if (!userId || !keyword?.trim() || !companyName?.trim()) {
      return NextResponse.json(
        { error: "userId, keyword, and companyName are required" },
        { status: 400 }
      );
    }

    const client = getServerClient();
    const { data, errors } = await client.models.TeamsMeetingMapping.create({
      userId,
      keyword:     keyword.trim(),
      companyName: companyName.trim(),
      createdAt:   new Date().toISOString(),
    });

    if (errors?.length) {
      return NextResponse.json({ error: errors[0].message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error("[teams/mappings] POST error:", err);
    return NextResponse.json({ error: "Failed to create mapping" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const { errors } = await client.models.TeamsMeetingMapping.delete({ id });

    if (errors?.length) {
      return NextResponse.json({ error: errors[0].message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[teams/mappings] DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete mapping" }, { status: 500 });
  }
}
