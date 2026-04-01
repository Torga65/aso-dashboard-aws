/**
 * GET /api/transcripts/download?company=&days=30|60|all&type=transcript|attendance|both&id=<single-id>
 *
 * Returns a combined VTT file for download.
 * If `id` is provided, returns just that single file.
 * Otherwise returns all matching files for the date range combined into one VTT.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/amplify-server-utils";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const company   = searchParams.get("company")?.trim();
  const daysParam = searchParams.get("days") ?? "30";
  const typeParam = searchParams.get("type") ?? "both";
  const singleId  = searchParams.get("id")?.trim();

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
        headers: {
          "Content-Type": "text/vtt; charset=utf-8",
          "Content-Disposition": `attachment; filename="${data.fileName}"`,
        },
      });
    }

    // Range download
    let cutoffDate: string | null = null;
    if (daysParam !== "all") {
      const days = parseInt(daysParam, 10);
      if (!Number.isNaN(days) && days > 0) {
        const d = new Date();
        d.setDate(d.getDate() - days);
        cutoffDate = d.toISOString().slice(0, 10);
      }
    }

    const { data, errors } =
      await client.models.MeetingTranscript.listMeetingTranscriptByCompanyNameAndMeetingDate(
        { companyName: company },
        {
          sortDirection: "DESC",
          limit: 200,
          ...(cutoffDate ? { filter: { meetingDate: { ge: cutoffDate } } } : {}),
        }
      );

    if (errors?.length) {
      return NextResponse.json({ error: errors[0].message }, { status: 500 });
    }

    let records = data ?? [];
    if (typeParam !== "both") {
      records = records.filter((r) => r.fileType === typeParam);
    }

    if (records.length === 0) {
      return NextResponse.json({ error: "No transcripts found for this range" }, { status: 404 });
    }

    // Sort oldest first for chronological combined file
    records.sort((a, b) => a.meetingDate.localeCompare(b.meetingDate));

    // Build combined VTT: one WEBVTT header, NOTE separators between meetings
    const parts = records.map((r) =>
      `NOTE ────────────────────────────────────\nNOTE Meeting: ${r.companyName}\nNOTE Date: ${r.meetingDate}  Type: ${r.fileType}\nNOTE File: ${r.fileName}\nNOTE Uploaded by: ${r.uploadedBy ?? "unknown"}  at ${r.uploadedAt}\nNOTE ────────────────────────────────────\n\n${
        // Strip the WEBVTT header from all but the first entry content
        r.content.replace(/^WEBVTT[^\n]*\n/, "").trimStart()
      }`
    );

    const combined = `WEBVTT\nNOTE Combined transcript — ${company} — generated ${new Date().toISOString()}\n\n${parts.join("\n\n")}`;
    const rangeLabel = daysParam === "all" ? "all" : `last-${daysParam}d`;
    const filename = `${company.replace(/[^a-z0-9]/gi, "_")}_transcripts_${rangeLabel}.vtt`;

    return new NextResponse(combined, {
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("[/api/transcripts/download] error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Download failed" }, { status: 500 });
  }
}
