/**
 * SpaceCat API Proxy
 *
 * Proxies all SpaceCat API calls through the Next.js backend so the IMS
 * token never needs to be sent directly from the browser to spacecat.experiencecloud.live.
 *
 * Flow:
 *   1. Client calls /api/spacecat/<path> with Authorization: Bearer <ims_token>
 *   2. This route exchanges the IMS token for a SpaceCat JWT (POST /auth/login)
 *   3. Forwards the request to SpaceCat with the SpaceCat JWT
 *   4. Returns the SpaceCat response to the client
 *
 * Supports GET, POST, PUT, PATCH, DELETE.
 */

import { NextRequest, NextResponse } from "next/server";

const SPACECAT_BASE = "https://spacecat.experiencecloud.live/api/v1";
const AUTH_LOGIN_URL = `${SPACECAT_BASE}/auth/login`;

// In-memory token cache: imsToken -> { spacecatToken, expiresAt }
const tokenCache = new Map<string, { spacecatToken: string; expiresAt: number }>();

/**
 * Exchange an IMS access token for a SpaceCat JWT.
 * Results are cached until 60 s before the SpaceCat token expires.
 */
async function getSpacecatToken(imsToken: string): Promise<string | null> {
  const cached = tokenCache.get(imsToken);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.spacecatToken;
  }

  const resp = await fetch(AUTH_LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken: imsToken }),
  });

  if (!resp.ok) {
    console.error("[SpaceCat proxy] Token exchange failed:", resp.status);
    return null;
  }

  const data = await resp.json();
  const spacecatToken: string = data.token || data.accessToken || data.access_token;
  if (!spacecatToken) return null;

  // Parse expiry from JWT payload
  let expiresAt = Date.now() + 3_600_000; // default 1 h
  try {
    const payload = JSON.parse(Buffer.from(spacecatToken.split(".")[1], "base64").toString());
    if (payload.exp) expiresAt = payload.exp * 1000;
  } catch { /* ignore */ }

  tokenCache.set(imsToken, { spacecatToken, expiresAt });
  return spacecatToken;
}

async function handleRequest(req: NextRequest, params: { path: string[] }): Promise<NextResponse> {
  // Extract IMS token from Authorization header
  const authHeader = req.headers.get("authorization") ?? "";
  const imsToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!imsToken) {
    return NextResponse.json({ error: "Missing IMS token" }, { status: 401 });
  }

  // Exchange for SpaceCat JWT
  const spacecatToken = await getSpacecatToken(imsToken);
  if (!spacecatToken) {
    return NextResponse.json({ error: "SpaceCat token exchange failed" }, { status: 401 });
  }

  // Build upstream URL
  const path = params.path.join("/");
  const upstreamUrl = new URL(`${SPACECAT_BASE}/${path}`);
  req.nextUrl.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.set(key, value);
  });

  // Forward request
  const method = req.method;
  const body = ["GET", "HEAD"].includes(method) ? undefined : await req.text();

  const upstreamResp = await fetch(upstreamUrl.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${spacecatToken}`,
    },
    body,
  });

  const respText = await upstreamResp.text();

  // Pass through status and body
  return new NextResponse(respText, {
    status: upstreamResp.status,
    headers: { "Content-Type": upstreamResp.headers.get("content-type") ?? "application/json" },
  });
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return handleRequest(req, params);
}
export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return handleRequest(req, params);
}
export async function PUT(req: NextRequest, { params }: { params: { path: string[] } }) {
  return handleRequest(req, params);
}
export async function PATCH(req: NextRequest, { params }: { params: { path: string[] } }) {
  return handleRequest(req, params);
}
export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return handleRequest(req, params);
}
