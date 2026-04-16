/**
 * GET /api/transcripts/download?company=&days=all|<N>&id=<single-id>&view=1
 *
 * Returns a combined VTT file for download.
 * If `id` is provided, returns just that single file.
 * Otherwise returns all transcripts for the date range combined into one VTT.
 *
 * `days` defaults to `all` (no date filter). Pass a positive integer for
 * rolling last N days by meetingDate.
 *
 * ?view=1  — returns plain text/plain with no Content-Disposition header so
 *            the content renders directly in a browser or can be fetched by
 *            Claude for analysis (no auth required — uses server API key).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/amplify-server-utils";
import {
  listAllMeetingTranscriptsForCompany,
  meetingDateCutoffFromDaysParam,
} from "@/lib/meeting-transcripts";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const company   = searchParams.get("company")?.trim();
  const daysParam = searchParams.get("days") ?? "all";
  const singleId  = searchParams.get("id")?.trim();
  const viewMode  = searchParams.get("view") === "1";

  if (!company) {
    return NextResponse.json({ error: "company param required" }, { status: 400 });
  }

  try {
    const client = getServerClient();

    if (singleId) {
      // Single-file download
      const { data, errors } = await client.models.MeetingTranscript.get({ id: singleId });
      if (errors?.length || !data) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return new NextResponse(data.content, {
        headers: viewMode
          ? { "Content-Type": "text/plain; charset=utf-8" }
          : {
              "Content-Type": "text/vtt; charset=utf-8",
              "Content-Disposition": `attachment; filename="${data.fileName}"`,
            },
      });
    }

    // Range download (paginated — no 200-row cap)
    const cutoffDate = meetingDateCutoffFromDaysParam(daysParam);
    const records = await listAllMeetingTranscriptsForCompany(client, company, cutoffDate);
    if (records.length === 0) {
      return NextResponse.json({ error: "No transcripts found for this range" }, { status: 404 });
    }

    // Sort oldest first for chronological combined file
    records.sort((a, b) => a.meetingDate.localeCompare(b.meetingDate));

    // Build combined VTT: one WEBVTT header, NOTE separators between meetings
    const parts = records.map((r) =>
      [
        `NOTE ────────────────────────────────────`,
        `NOTE Meeting: ${r.companyName}`,
        `NOTE Date: ${r.meetingDate}  Type: ${r.fileType}`,
        `NOTE File: ${r.fileName}`,
        r.description ? `NOTE Description: ${r.description}` : null,
        `NOTE Uploaded by: ${r.uploadedBy ?? "unknown"}  at ${r.uploadedAt}`,
        `NOTE ────────────────────────────────────`,
        ``,
        // Strip the WEBVTT header from entry content
        r.content.replace(/^WEBVTT[^\n]*\n/, "").trimStart(),
      ].filter((line) => line !== null).join("\n")
    );

    const combined = `WEBVTT\nNOTE Combined transcript — ${company} — generated ${new Date().toISOString()}\n\n${parts.join("\n\n")}`;
    const rangeLabel = daysParam === "all" ? "all" : `last-${daysParam}d`;
    const filename = `${company.replace(/[^a-z0-9]/gi, "_")}_transcripts_${rangeLabel}.vtt`;

    return new NextResponse(combined, {
      headers: viewMode
        ? { "Content-Type": "text/plain; charset=utf-8" }
        : {
            "Content-Type": "text/vtt; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
          },
    });
  } catch (err) {
    console.error("[/api/transcripts/download] error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Download failed" }, { status: 500 });
  }
}
