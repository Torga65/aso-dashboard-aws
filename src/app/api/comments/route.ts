/**
 * GET /api/comments?company=<name>&days=30|60|90|all
 *
 * Returns SnowComment entries for a customer, newest first.
 * days defaults to 30. Use days=all for no date filter.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/amplify-server-utils";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const company = searchParams.get("company")?.trim();
  const daysParam = searchParams.get("days") ?? "30";

  if (!company) {
    return NextResponse.json({ error: "company param required" }, { status: 400 });
  }

  try {
    const client = getServerClient();

    // Build date cutoff
    let cutoffDate: string | null = null;
    if (daysParam !== "all") {
      const days = parseInt(daysParam, 10);
      if (!Number.isNaN(days) && days > 0) {
        const d = new Date();
        d.setDate(d.getDate() - days);
        // commentDate format: "YYYY-MM-DD HH:MM:SS" — prefix compare works for string sort
        cutoffDate = d.toISOString().replace("T", " ").slice(0, 19);
      }
    }

    const { data, errors } =
      await client.models.SnowComment.listSnowCommentByCompanyNameAndCommentDate(
        { companyName: company },
        {
          sortDirection: "DESC",
          limit: 500,
          ...(cutoffDate
            ? { filter: { commentDate: { ge: cutoffDate } } }
            : {}),
        }
      );

    if (errors?.length) {
      console.error("[/api/comments] errors:", errors);
      return NextResponse.json({ error: errors[0].message }, { status: 500 });
    }

    const comments = (data ?? []).map((c) => ({
      companyName: c.companyName,
      commentDate: c.commentDate,
      author: c.author ?? "",
      body: c.body ?? "",
    }));

    return NextResponse.json({ data: comments });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load comments";
    console.error("[/api/comments]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
