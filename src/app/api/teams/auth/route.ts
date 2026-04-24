/**
 * GET /api/teams/auth?userId=<imsUserId>
 *
 * Initiates the Microsoft OAuth 2.0 authorization code flow.
 * Redirects the user to Microsoft's consent page. After consent,
 * Microsoft redirects to /api/teams/callback with the auth code.
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId")?.trim();
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const clientId    = process.env.TEAMS_CLIENT_ID;
  const tenantId    = process.env.TEAMS_TENANT_ID;
  const redirectUri = process.env.TEAMS_REDIRECT_URI;

  if (!clientId || !tenantId || !redirectUri) {
    return NextResponse.json(
      { error: "Teams OAuth is not configured. Set TEAMS_CLIENT_ID, TEAMS_TENANT_ID, TEAMS_REDIRECT_URI." },
      { status: 503 }
    );
  }

  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: "code",
    redirect_uri:  redirectUri,
    response_mode: "query",
    scope:         "OnlineMeetings.Read OnlineMeetingTranscript.Read.All offline_access",
    state:         userId, // passed back verbatim in the callback
  });

  const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`;
  return NextResponse.redirect(authUrl);
}
