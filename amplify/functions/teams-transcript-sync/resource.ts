import { defineFunction, secret } from "@aws-amplify/backend";

export const teamsTranscriptSync = defineFunction({
  name: "teams-transcript-sync",
  timeoutSeconds: 300,
  memoryMB: 512,
  environment: {
    TEAMS_CLIENT_ID:     secret("TEAMS_CLIENT_ID"),
    TEAMS_CLIENT_SECRET: secret("TEAMS_CLIENT_SECRET"),
    TEAMS_TENANT_ID:     secret("TEAMS_TENANT_ID"),
  },
});
