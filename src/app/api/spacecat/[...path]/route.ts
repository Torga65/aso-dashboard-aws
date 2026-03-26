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

const SPACECAT_BASE = "https://spacecat.experiencecloud.live/api/v1";

async function handleRequest(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization") ?? "";

  if (!authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing IMS token" }, { status: 401 });
  }

  // Build upstream URL, preserving query params
  const { path } = await params;
  const upstreamUrl = new URL(`${SPACECAT_BASE}/${path.join("/")}`);
  req.nextUrl.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.set(key, value);
  });

  const method = req.method;
  const body = ["GET", "HEAD"].includes(method) ? undefined : await req.text();

  // Forward request to SpaceCat with the user's IMS token as-is
  const upstreamResp = await fetch(upstreamUrl.toString(), {
    method,
    headers: {
      Authorization: authHeader,
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
