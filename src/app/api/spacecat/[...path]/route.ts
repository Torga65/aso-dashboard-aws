/**
 * SpaceCat API Proxy
 *
 * Proxies all SpaceCat API calls through the Next.js backend so:
 *  - No CORS issues (browser → same origin → SpaceCat)
 *  - IMS / SpaceCat tokens are never exposed to the browser directly
 *
 * Flow:
 *   1. Client calls /api/spacecat/<path> with Authorization: Bearer <ims_token>
 *   2. This route forwards the request to SpaceCat with the same IMS token
 *   3. Returns the SpaceCat response to the client
 *
 * When SpaceCat S2S credentials are available, swap step 2 to use
 * getServiceToken() (client_credentials grant) instead of the user token.
 *
 * Supports GET, POST, PUT, PATCH, DELETE.
 */

import { NextRequest, NextResponse } from "next/server";

// Allow up to 60 seconds for SpaceCat to respond (GET /sites returns all sites
// and can take 15–20 s). Next.js / OpenNext propagates this to the Lambda timeout.
export const maxDuration = 60;

const SPACECAT_BASE = "https://spacecat.experiencecloud.live/api/v1";

async function handleRequest(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization") ?? "";

  // Build upstream URL, preserving query params
  const { path } = await params;
  const pathStr = path.join("/");
  const upstreamUrl = new URL(`${SPACECAT_BASE}/${pathStr}`);
  req.nextUrl.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.set(key, value);
  });

  // auth/login receives the IMS token in the request body — no Bearer header needed.
  // All other endpoints require a Bearer token.
  const isAuthLogin = pathStr === "auth/login";
  if (!isAuthLogin && !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing IMS token" }, { status: 401 });
  }

  const method = req.method;
  const body = ["GET", "HEAD"].includes(method) ? undefined : await req.text();

  // Forward request to SpaceCat. Don't forward Authorization on auth/login
  // since SpaceCat's login endpoint only expects the token in the body.
  const upstreamResp = await fetch(upstreamUrl.toString(), {
    method,
    headers: {
      ...(!isAuthLogin && authHeader ? { Authorization: authHeader } : {}),
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body,
  });

  const respText = await upstreamResp.text();
  return new NextResponse(respText, {
    status: upstreamResp.status,
    headers: {
      "Content-Type": upstreamResp.headers.get("content-type") ?? "application/json",
    },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handleRequest(req, ctx);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handleRequest(req, ctx);
}
export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handleRequest(req, ctx);
}
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handleRequest(req, ctx);
}
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handleRequest(req, ctx);
}
