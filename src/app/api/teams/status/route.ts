/**
 * GET /api/teams/status?userId=<imsUserId>
 *
 * Returns the connection status for the given user.
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
    const { data } = await client.models.TeamsConnection.get({ userId });

    if (!data || !data.isActive) {
      return NextResponse.json({ connected: false });
    }

    return NextResponse.json({
      connected: true,
      msEmail: data.msEmail ?? "",
      connectedAt: data.connectedAt,
    });
  } catch (err) {
    console.error("[teams/status] error:", err);
    return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
  }
}
