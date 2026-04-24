import type { Handler } from "aws-lambda";
import type { EventBridgeEvent } from "aws-lambda";
import { AppSyncClient } from "./appsync-client";
import {
  refreshAccessToken,
  listRecentMeetings,
  listTranscripts,
  downloadVtt,
} from "./graph-client";
import {
  listActiveConnections,
  getToken,
  updateToken,
  listMappingsForUser,
  resolveCompanyName,
  transcriptAlreadyExists,
  createTranscript,
} from "./persistence";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler<EventBridgeEvent<"Scheduled Event", any>> = async (event) => {
  const clientId     = process.env.TEAMS_CLIENT_ID;
  const clientSecret = process.env.TEAMS_CLIENT_SECRET;
  const tenantId     = process.env.TEAMS_TENANT_ID;
  const endpoint     = process.env.APPSYNC_ENDPOINT;
  const apiKey       = process.env.APPSYNC_API_KEY;

  if (!clientId || !clientSecret || !tenantId || !endpoint || !apiKey) {
    throw new Error("Missing required environment variables");
  }

  const client = new AppSyncClient(endpoint, apiKey);

  const connections = await listActiveConnections(client);
  console.log(`[teams-sync] Processing ${connections.length} active connections`);

  // Look back 25 hours to handle any overlap from previous run
  const since = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

  let totalCreated = 0;
  let totalSkipped = 0;
  let totalErrors  = 0;

  for (const conn of connections) {
    try {
      const tokenRecord = await getToken(client, conn.userId);
      if (!tokenRecord) {
        console.warn(`[teams-sync] No token for user ${conn.userId} — skipping`);
        continue;
      }

      // Refresh access token and persist the new refresh token
      const newTokens = await refreshAccessToken(
        tokenRecord.refreshToken,
        clientId,
        clientSecret,
        tenantId
      );
      await updateToken(client, conn.userId, newTokens.refresh_token);

      const mappings = await listMappingsForUser(client, conn.userId);
      if (mappings.length === 0) {
        console.log(`[teams-sync] User ${conn.email} has no mappings — skipping`);
        continue;
      }

      const meetings = await listRecentMeetings(newTokens.access_token, since);
      console.log(`[teams-sync] ${conn.email}: ${meetings.length} meetings found`);

      for (const meeting of meetings) {
        const companyName = resolveCompanyName(meeting.subject ?? "", mappings);
        if (!companyName) continue;

        const meetingDate = meeting.startDateTime.slice(0, 10); // "YYYY-MM-DD"
        const transcripts = await listTranscripts(newTokens.access_token, meeting.id);

        for (const transcript of transcripts) {
          const fileName = `teams-${transcript.id}.vtt`;

          const exists = await transcriptAlreadyExists(
            client,
            companyName,
            meetingDate,
            fileName
          );
          if (exists) {
            totalSkipped++;
            continue;
          }

          const vtt = await downloadVtt(
            newTokens.access_token,
            meeting.id,
            transcript.id
          );

          const created = await createTranscript(client, {
            companyName,
            meetingDate,
            fileName,
            content: vtt,
            uploadedBy: conn.email,
            subject: meeting.subject ?? "",
          });

          if (created) {
            totalCreated++;
            console.log(`[teams-sync] Created: ${companyName} / ${meetingDate} / ${fileName}`);
          }
        }
      }
    } catch (err) {
      totalErrors++;
      console.error(`[teams-sync] Error processing user ${conn.userId}:`, err);
      // Continue with next user rather than failing the whole run
    }
  }

  console.log(
    `[teams-sync] Done — created: ${totalCreated}, skipped: ${totalSkipped}, errors: ${totalErrors}`
  );

  return { created: totalCreated, skipped: totalSkipped, errors: totalErrors };
};
