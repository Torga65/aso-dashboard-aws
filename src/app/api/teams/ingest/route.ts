/**
 * POST /api/teams/ingest
 *
 * Accepts a VTT transcript from the browser bookmarklet running on
 * teams.microsoft.com. CORS-enabled for Teams web origins.
 *
 * Body: { meetingTitle, companyName, meetingDate, content, uploadedBy, fileName }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/amplify-server-utils";

const MAX_BYTES = 350 * 1024;

const CORS_ORIGINS = [
  "https://teams.microsoft.com",
  "https://teams.cloud.microsoft",
];

function corsHeaders(origin: string | null) {
  const allowed = origin && CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Preflight
export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    const body = await req.json() as {
      meetingTitle?: string;
      companyName?: string;
      meetingDate?: string;
      content?: string;
      uploadedBy?: string;
      fileName?: string;
    };

    const { meetingTitle, companyName, meetingDate, content, uploadedBy, fileName } = body;

    if (!companyName?.trim() || !meetingDate?.trim() || !content?.trim()) {
      return NextResponse.json(
        { error: "companyName, meetingDate, and content are required" },
        { status: 400, headers }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
      return NextResponse.json(
        { error: "meetingDate must be YYYY-MM-DD" },
        { status: 400, headers }
      );
    }

    const byteSize = new TextEncoder().encode(content).length;
    if (byteSize > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (${Math.round(byteSize / 1024)} KB). Maximum is 350 KB.` },
        { status: 413, headers }
      );
    }

    const client = getServerClient();
    const { data, errors } = await client.models.MeetingTranscript.create({
      companyName:  companyName.trim(),
      meetingDate:  meetingDate.trim(),
      fileType:     "transcript",
      fileName:     fileName?.trim() || `${meetingDate}-transcript.vtt`,
      description:  meetingTitle?.trim() || "",
      content,
      uploadedBy:   uploadedBy?.trim() || "",
      uploadedAt:   new Date().toISOString(),
    });

    if (errors?.length) {
      return NextResponse.json({ error: errors[0].message }, { status: 500, headers });
    }

    return NextResponse.json({ success: true, id: data?.id }, { headers });
  } catch (err) {
    console.error("[teams/ingest] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500, headers }
    );
  }
}
