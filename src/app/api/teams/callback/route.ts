/**
 * GET /api/teams/callback?code=&state=<userId>
 *
 * Microsoft redirects here after the user consents. Exchanges the auth code
 * for tokens, fetches the user's MS profile, then persists the connection and
 * refresh token via AppSync before redirecting back to the settings page.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/amplify-server-utils";

export const dynamic = "force-dynamic";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  error?: string;
  error_description?: string;
}

interface MsProfile {
  id: string;
  mail?: string;
  userPrincipalName?: string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code   = searchParams.get("code");
  const userId = searchParams.get("state"); // Adobe IMS userId passed through OAuth state
  const error  = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/teams-settings?error=${encodeURIComponent(searchParams.get("error_description") ?? error)}`, req.url)
    );
  }

  if (!code || !userId) {
    return NextResponse.redirect(new URL("/teams-settings?error=missing_code", req.url));
  }

  const clientId     = process.env.TEAMS_CLIENT_ID;
  const clientSecret = process.env.TEAMS_CLIENT_SECRET;
  const tenantId     = process.env.TEAMS_TENANT_ID;
  const redirectUri  = process.env.TEAMS_REDIRECT_URI;

  if (!clientId || !clientSecret || !tenantId || !redirectUri) {
    return NextResponse.redirect(new URL("/teams-settings?error=not_configured", req.url));
  }

  try {
    // Exchange auth code for tokens
    const tokenResp = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id:     clientId,
          client_secret: clientSecret,
          grant_type:    "authorization_code",
          code,
          redirect_uri:  redirectUri,
          scope:         "OnlineMeetings.Read OnlineMeetingTranscript.Read.All offline_access",
        }).toString(),
      }
    );

    const tokens = (await tokenResp.json()) as TokenResponse;
    if (tokens.error) {
      console.error("[teams/callback] token exchange error:", tokens.error_description);
      return NextResponse.redirect(
        new URL(`/teams-settings?error=${encodeURIComponent(tokens.error_description ?? tokens.error)}`, req.url)
      );
    }

    // Fetch Microsoft user profile to get their MS email
    const profileResp = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const msProfile = (await profileResp.json()) as MsProfile;
    const msEmail = msProfile.mail ?? msProfile.userPrincipalName ?? "";

    const client = getServerClient();
    const now = new Date().toISOString();

    // Upsert TeamsConnection
    const existing = await client.models.TeamsConnection.get({ userId });
    if (existing.data) {
      await client.models.TeamsConnection.update({
        userId,
        msEmail,
        msUserId: msProfile.id,
        isActive: true,
      });
    } else {
      // We need the user's Adobe email — passed via the IMS profile stored client-side.
      // Fall back to msEmail if Adobe email is unavailable server-side.
      await client.models.TeamsConnection.create({
        userId,
        email:    msEmail, // updated by the UI after redirect if Adobe email is available
        msEmail,
        msUserId: msProfile.id,
        connectedAt: now,
        isActive: true,
      });
    }

    // Upsert TeamsToken
    const existingToken = await client.models.TeamsToken.get({ userId });
    if (existingToken.data) {
      await client.models.TeamsToken.update({
        userId,
        refreshToken: tokens.refresh_token,
        updatedAt: now,
      });
    } else {
      await client.models.TeamsToken.create({
        userId,
        refreshToken: tokens.refresh_token,
        updatedAt: now,
      });
    }

    return NextResponse.redirect(new URL("/teams-settings?connected=1", req.url));
  } catch (err) {
    console.error("[teams/callback] error:", err);
    return NextResponse.redirect(new URL("/teams-settings?error=callback_failed", req.url));
  }
}
