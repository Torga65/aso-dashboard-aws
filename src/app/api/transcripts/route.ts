/**
 * POST /api/transcripts        — upload a VTT file for a customer meeting
 * GET  /api/transcripts?company=&days=all|<N>  — list metadata (no content)
 *
 * `days` defaults to `all` (no date filter). Pass a positive integer for
 * rolling last N days by meetingDate.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/amplify-server-utils";
import {
  listAllMeetingTranscriptsForCompany,
  meetingDateCutoffFromDaysParam,
} from "@/lib/meeting-transcripts";

const MAX_BYTES = 350 * 1024; // 350 KB — DynamoDB 400 KB item limit with headroom

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const company   = (form.get("company")   as string | null)?.trim();
    const meetingDate = (form.get("meetingDate") as string | null)?.trim();
    const fileType  = (form.get("fileType")  as string | null)?.trim();
    const uploadedBy = (form.get("uploadedBy") as string | null)?.trim() ?? "";
    const file      = form.get("file") as File | null;

    if (!company || !meetingDate || !file) {
      return NextResponse.json({ error: "company, meetingDate, and file are required" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
      return NextResponse.json({ error: "meetingDate must be YYYY-MM-DD" }, { status: 400 });
    }

    const content = await file.text();
    const byteSize = new TextEncoder().encode(content).length;
    if (byteSize > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (${Math.round(byteSize / 1024)} KB). Maximum is 350 KB.` },
        { status: 413 }
      );
    }

    const client = getServerClient();
    const { data, errors } = await client.models.MeetingTranscript.create({
      companyName: company,
      meetingDate,
      fileType: fileType === "notes" ? "notes" : "transcript",
      fileName: file.name,
      content,
      uploadedBy,
      uploadedAt: new Date().toISOString(),
    });

    if (errors?.length) {
      console.error("[/api/transcripts] create errors:", errors);
      return NextResponse.json({ error: errors[0].message }, { status: 500 });
    }

    return NextResponse.json({ data: { id: data?.id, meetingDate, fileType, fileName: file.name } });
  } catch (err) {
    console.error("[/api/transcripts] POST error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const company  = searchParams.get("company")?.trim();
  const daysParam = searchParams.get("days") ?? "all";

  if (!company) {
    return NextResponse.json({ error: "company param required" }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const cutoffDate = meetingDateCutoffFromDaysParam(daysParam);

    const rows = await listAllMeetingTranscriptsForCompany(client, company, cutoffDate);

    // Return metadata only (omit content to keep response small)
    const items = rows.map((r) => ({
      id: r.id,
      companyName: r.companyName,
      meetingDate: r.meetingDate,
      fileType: r.fileType,
      fileName: r.fileName,
      uploadedBy: r.uploadedBy ?? "",
      uploadedAt: r.uploadedAt,
    }));

    return NextResponse.json({ data: items });
  } catch (err) {
    console.error("[/api/transcripts] GET error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load" }, { status: 500 });
  }
}
