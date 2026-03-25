import { NextRequest, NextResponse } from "next/server";

const IMS_CLIENT_ID = "307b29831bd0423e9f2c720545df2251";

/**
 * POST /api/auth/exchange
 * Server-side proxy for IMS token exchange — avoids CORS restriction on direct
 * browser calls to ims-na1.adobelogin.com.
 *
 * Body: { code: string, codeVerifier: string, redirectURI: string }
 */
export async function POST(req: NextRequest) {
  let body: { code?: string; codeVerifier?: string; redirectURI?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { code, codeVerifier, redirectURI } = body;
  if (!code || !codeVerifier || !redirectURI) {
    return NextResponse.json(
      { error: "Missing required fields: code, codeVerifier, redirectURI" },
      { status: 400 }
    );
  }

  // Determine IMS base URL from the redirectURI host (same env as the app)
  const imsBase = "https://ims-na1.adobelogin.com";
  const tokenURL = `${imsBase}/ims/token/v3`;

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: IMS_CLIENT_ID,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectURI,
  });

  const imsRes = await fetch(tokenURL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await imsRes.json();

  if (!imsRes.ok) {
    return NextResponse.json(
      { error: data.error_description || data.error || "IMS token exchange failed" },
      { status: imsRes.status }
    );
  }

  return NextResponse.json(data);
}
