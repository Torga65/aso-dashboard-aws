/**
 * Shared helpers for MeetingTranscript list queries (API routes).
 */

import type { getServerClient } from "@/lib/amplify-server-utils";

type DataClient = ReturnType<typeof getServerClient>;

/**
 * When `days` is omitted or `"all"`, returns null (no date filter).
 * For a positive integer string, returns YYYY-MM-DD for (today − N days).
 */
export function meetingDateCutoffFromDaysParam(daysParam: string | null): string | null {
  const effective = daysParam ?? "all";
  if (effective === "all") return null;
  const days = parseInt(effective, 10);
  if (Number.isNaN(days) || days <= 0) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Lists every transcript for a company, optionally filtered by meetingDate >= cutoff.
 * Paginates past Amplify's per-request page size.
 */
export async function listAllMeetingTranscriptsForCompany(
  client: DataClient,
  companyName: string,
  meetingDateCutoff: string | null
) {
  const all: NonNullable<
    Awaited<
      ReturnType<DataClient["models"]["MeetingTranscript"]["listMeetingTranscriptByCompanyNameAndMeetingDate"]>
    >["data"]
  > = [];

  let nextToken: string | undefined;

  do {
    const result =
      await client.models.MeetingTranscript.listMeetingTranscriptByCompanyNameAndMeetingDate(
        { companyName },
        {
          sortDirection: "DESC",
          limit: 200,
          ...(meetingDateCutoff
            ? { filter: { meetingDate: { ge: meetingDateCutoff } } }
            : {}),
          ...(nextToken ? { nextToken } : {}),
        }
      );

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    const page = result.data ?? [];
    all.push(...page);

    nextToken = result.nextToken as string | undefined;
  } while (nextToken);

  return all;
}
