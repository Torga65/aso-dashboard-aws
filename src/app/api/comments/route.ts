/**
 * GET /api/comments?company=<name>&days=latest|30|60|90|all
 *
 * Returns SnowComment entries for a customer, newest first.
 * days=latest (default) returns only the single most recent comment.
 * days=all returns all comments with no date filter.
 *
 * Falls back to parsing CustomerSnapshot.comments raw text if the
 * SnowComment table has no entries yet (i.e. Lambda hasn't re-run
 * since the schema was deployed).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/amplify-server-utils";

interface CommentEntry {
  companyName: string;
  commentDate: string;
  author: string;
  body: string;
}

// Matches: "2025-10-07 12:01:17 - Author Name (Comments)"
const HEADER_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) - (.+?) \(Comments\)$/m;
const HEADER_RE_GLOBAL = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) - (.+?) \(Comments\)$/gm;

/** Parse raw u_comments blob into individual entries, newest first. */
function parseRawComments(companyName: string, raw: string): CommentEntry[] {
  if (!raw?.trim()) return [];

  const lines = raw.split("\n");
  const results: CommentEntry[] = [];
  let currentDate: string | null = null;
  let currentAuthor = "";
  const bodyLines: string[] = [];

  function flush() {
    if (!currentDate) return;
    results.push({
      companyName,
      commentDate: currentDate,
      author: currentAuthor,
      body: bodyLines.join("\n").trim(),
    });
    bodyLines.length = 0;
  }

  for (const line of lines) {
    const m = line.match(HEADER_RE);
    if (m) {
      flush();
      currentDate = m[1];
      currentAuthor = m[2].trim();
    } else if (currentDate !== null) {
      bodyLines.push(line);
    }
  }
  flush();

  // Return newest first
  return results.sort((a, b) => b.commentDate.localeCompare(a.commentDate));
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const company = searchParams.get("company")?.trim();
  const daysParam = searchParams.get("days") ?? "latest";

  if (!company) {
    return NextResponse.json({ error: "company param required" }, { status: 400 });
  }

  try {
    const client = getServerClient();

    // ── 1. Try SnowComment table (populated by Lambda after schema deployment) ──
    let cutoffDate: string | null = null;
    if (daysParam !== "all" && daysParam !== "latest") {
      const days = parseInt(daysParam, 10);
      if (!Number.isNaN(days) && days > 0) {
        const d = new Date();
        d.setDate(d.getDate() - days);
        cutoffDate = d.toISOString().replace("T", " ").slice(0, 19);
      }
    }

    const { data: snowData, errors: snowErrors } =
      await client.models.SnowComment.listSnowCommentByCompanyNameAndCommentDate(
        { companyName: company },
        {
          sortDirection: "DESC",
          limit: daysParam === "latest" ? 1 : 500,
          ...(cutoffDate ? { filter: { commentDate: { ge: cutoffDate } } } : {}),
        }
      );

    if (snowErrors?.length) {
      console.warn("[/api/comments] SnowComment query errors:", snowErrors);
    }

    if (snowData && snowData.length > 0) {
      const comments = snowData.map((c) => ({
        companyName: c.companyName,
        commentDate: c.commentDate,
        author: c.author ?? "",
        body: c.body ?? "",
      }));
      return NextResponse.json({ data: comments, source: "table" });
    }

    // ── 2. Fallback: parse from CustomerSnapshot.comments raw text ─────────────
    // Fetch the most recent snapshot(s) for this company
    const { data: snapshots, errors: snapErrors } =
      await client.models.CustomerSnapshot.listCustomerSnapshotByCompanyNameAndWeek(
        { companyName: company },
        { sortDirection: "DESC", limit: 5 }
      );

    if (snapErrors?.length) {
      console.warn("[/api/comments] Snapshot fallback errors:", snapErrors);
    }

    // Find the most recent snapshot that has a non-empty comments field
    const withComments = (snapshots ?? []).find((s) => s.comments?.trim());
    if (!withComments?.comments) {
      return NextResponse.json({ data: [], source: "fallback" });
    }

    let parsed = parseRawComments(company, withComments.comments);

    if (daysParam === "latest") {
      parsed = parsed.slice(0, 1);
    } else if (cutoffDate) {
      parsed = parsed.filter((c) => c.commentDate >= cutoffDate!);
    }

    return NextResponse.json({ data: parsed, source: "fallback" });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load comments";
    console.error("[/api/comments]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
