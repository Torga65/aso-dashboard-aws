/**
 * DELETE /api/teams/disconnect?userId=<imsUserId>
 *
 * Marks the user's Teams connection as inactive and clears the stored token.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/amplify-server-utils";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId")?.trim();
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  try {
    const client = getServerClient();

    await client.models.TeamsConnection.update({
      userId,
      isActive: false,
    });

    // Clear the stored refresh token
    const existingToken = await client.models.TeamsToken.get({ userId });
    if (existingToken.data) {
      await client.models.TeamsToken.update({
        userId,
        refreshToken: "",
        updatedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[teams/disconnect] error:", err);
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
  }
}
