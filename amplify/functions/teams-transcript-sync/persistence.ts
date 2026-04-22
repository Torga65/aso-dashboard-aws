import { AppSyncClient } from "./appsync-client";
import type { TeamsConnection, TeamsToken, TeamsMeetingMapping } from "./types";

// ─── Queries ─────────────────────────────────────────────────────────────────

const LIST_ACTIVE_CONNECTIONS = /* GraphQL */ `
  query ListActiveConnections($nextToken: String) {
    listTeamsConnections(nextToken: $nextToken) {
      items { userId email msUserId isActive }
      nextToken
    }
  }
`;

const GET_TOKEN = /* GraphQL */ `
  query GetTeamsToken($userId: String!) {
    getTeamsToken(userId: $userId) {
      userId refreshToken
    }
  }
`;

const LIST_MAPPINGS_BY_USER = /* GraphQL */ `
  query ListMappingsByUser($userId: String!, $nextToken: String) {
    listTeamsMeetingMappingsByUserIdAndCreatedAt(userId: $userId, nextToken: $nextToken) {
      items { userId keyword companyName }
      nextToken
    }
  }
`;

const LIST_TRANSCRIPTS_BY_COMPANY_DATE = /* GraphQL */ `
  query ListTranscripts($companyName: String!, $meetingDate: String!) {
    listMeetingTranscriptsByCompanyNameAndMeetingDate(
      companyName: $companyName,
      meetingDate: { eq: $meetingDate }
    ) {
      items { id fileName }
    }
  }
`;

// ─── Mutations ────────────────────────────────────────────────────────────────

const UPDATE_TOKEN = /* GraphQL */ `
  mutation UpdateTeamsToken($input: UpdateTeamsTokenInput!) {
    updateTeamsToken(input: $input) { userId updatedAt }
  }
`;

const CREATE_TRANSCRIPT = /* GraphQL */ `
  mutation CreateMeetingTranscript($input: CreateMeetingTranscriptInput!) {
    createMeetingTranscript(input: $input) { id }
  }
`;

// ─── Exported helpers ─────────────────────────────────────────────────────────

export async function listActiveConnections(
  client: AppSyncClient
): Promise<TeamsConnection[]> {
  const results: TeamsConnection[] = [];
  let nextToken: string | null = null;

  do {
    const res = await client.request<{
      listTeamsConnections: {
        items: TeamsConnection[];
        nextToken: string | null;
      };
    }>(LIST_ACTIVE_CONNECTIONS, nextToken ? { nextToken } : {});

    const items = res.data?.listTeamsConnections.items ?? [];
    results.push(...items.filter((c) => c.isActive));
    nextToken = res.data?.listTeamsConnections.nextToken ?? null;
  } while (nextToken);

  return results;
}

export async function getToken(
  client: AppSyncClient,
  userId: string
): Promise<TeamsToken | null> {
  const res = await client.request<{ getTeamsToken: TeamsToken | null }>(
    GET_TOKEN,
    { userId }
  );
  return res.data?.getTeamsToken ?? null;
}

export async function updateToken(
  client: AppSyncClient,
  userId: string,
  refreshToken: string
): Promise<void> {
  await client.request(UPDATE_TOKEN, {
    input: { userId, refreshToken, updatedAt: new Date().toISOString() },
  });
}

export async function listMappingsForUser(
  client: AppSyncClient,
  userId: string
): Promise<TeamsMeetingMapping[]> {
  const results: TeamsMeetingMapping[] = [];
  let nextToken: string | null = null;

  do {
    const res = await client.request<{
      listTeamsMeetingMappingsByUserIdAndCreatedAt: {
        items: TeamsMeetingMapping[];
        nextToken: string | null;
      };
    }>(LIST_MAPPINGS_BY_USER, { userId, ...(nextToken ? { nextToken } : {}) });

    results.push(
      ...(res.data?.listTeamsMeetingMappingsByUserIdAndCreatedAt.items ?? [])
    );
    nextToken =
      res.data?.listTeamsMeetingMappingsByUserIdAndCreatedAt.nextToken ?? null;
  } while (nextToken);

  return results;
}

export function resolveCompanyName(
  subject: string,
  mappings: TeamsMeetingMapping[]
): string | null {
  const lower = subject.toLowerCase();
  for (const m of mappings) {
    if (lower.includes(m.keyword.toLowerCase())) return m.companyName;
  }
  return null;
}

export async function transcriptAlreadyExists(
  client: AppSyncClient,
  companyName: string,
  meetingDate: string,
  fileName: string
): Promise<boolean> {
  const res = await client.request<{
    listMeetingTranscriptsByCompanyNameAndMeetingDate: {
      items: { id: string; fileName: string }[];
    };
  }>(LIST_TRANSCRIPTS_BY_COMPANY_DATE, { companyName, meetingDate });

  const items =
    res.data?.listMeetingTranscriptsByCompanyNameAndMeetingDate.items ?? [];
  return items.some((t) => t.fileName === fileName);
}

const MAX_BYTES = 350 * 1024;

export async function createTranscript(
  client: AppSyncClient,
  params: {
    companyName: string;
    meetingDate: string;
    fileName: string;
    content: string;
    uploadedBy: string;
    subject: string;
  }
): Promise<boolean> {
  const byteSize = new TextEncoder().encode(params.content).length;
  if (byteSize > MAX_BYTES) {
    console.warn(
      `[teams-sync] Skipping ${params.fileName} — ${Math.round(byteSize / 1024)} KB exceeds 350 KB limit`
    );
    return false;
  }

  const res = await client.request(CREATE_TRANSCRIPT, {
    input: {
      companyName: params.companyName,
      meetingDate: params.meetingDate,
      fileType: "transcript",
      fileName: params.fileName,
      description: params.subject,
      content: params.content,
      uploadedBy: params.uploadedBy,
      uploadedAt: new Date().toISOString(),
    },
  });

  if (res.errors?.length) {
    throw new Error(res.errors[0].message);
  }
  return true;
}
