import type { TokenResponse, GraphMeeting, GraphTranscript } from "./types";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TOKEN_URL = (tenantId: string) =>
  `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

const SCOPES = "OnlineMeetings.Read OnlineMeetingTranscript.Read.All offline_access";

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  tenantId: string
): Promise<TokenResponse> {
  const resp = await fetch(TOKEN_URL(tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      scope: SCOPES,
      refresh_token: refreshToken,
    }).toString(),
  });

  const data = (await resp.json()) as TokenResponse;
  if (data.error) throw new Error(`Token refresh failed: ${data.error_description}`);
  return data;
}

export async function listRecentMeetings(
  accessToken: string,
  sinceIso: string
): Promise<GraphMeeting[]> {
  const url = `${GRAPH_BASE}/me/onlineMeetings?$filter=startDateTime ge ${sinceIso}&$top=50`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Graph listMeetings ${resp.status}: ${body}`);
  }

  const json = (await resp.json()) as { value?: GraphMeeting[] };
  return json.value ?? [];
}

export async function listTranscripts(
  accessToken: string,
  meetingId: string
): Promise<GraphTranscript[]> {
  const url = `${GRAPH_BASE}/me/onlineMeetings/${meetingId}/transcripts`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // 404 means transcription was not enabled for this meeting — skip silently
  if (resp.status === 404) return [];
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Graph listTranscripts ${resp.status}: ${body}`);
  }

  const json = (await resp.json()) as { value?: GraphTranscript[] };
  return json.value ?? [];
}

export async function downloadVtt(
  accessToken: string,
  meetingId: string,
  transcriptId: string
): Promise<string> {
  const url = `${GRAPH_BASE}/me/onlineMeetings/${meetingId}/transcripts/${transcriptId}/content?$format=text/vtt`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Graph downloadVtt ${resp.status}: ${body}`);
  }

  return resp.text();
}
