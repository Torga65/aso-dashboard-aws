import { defineFunction, secret } from "@aws-amplify/backend";

/**
 * daily-fetch Lambda definition.
 *
 * Schedule: NOT set here. EventBridge Scheduler is configured via CDK override
 * in amplify/backend.ts — this gives us flexible time windows, retry policies,
 * and a dead-letter queue, which the built-in `schedule` property does not support.
 *
 * Secrets: stored in AWS Secrets Manager, never in source or environment files.
 *   npx ampx secret set EXTERNAL_API_KEY
 *   npx ampx secret set EXTERNAL_API_BASE_URL
 *
 * Memory / timeout: sized for fetching ~600 records + 600 AppSync writes.
 * Adjust if the record count or API latency changes significantly.
 */
export const dailyFetch = defineFunction({
  name: "daily-fetch",
  // 5 minutes: generous for API call + batch writes + summary computation
  timeoutSeconds: 300,
  // 512 MB: safe for JSON parsing of large payloads; reduce to 256 if cost matters
  memoryMB: 512,
  environment: {
    EXTERNAL_API_KEY: secret("EXTERNAL_API_KEY"),
    // Base URL kept as a secret so it can differ between sandbox / staging / prod
    // without code changes. Set with: npx ampx secret set EXTERNAL_API_BASE_URL
    EXTERNAL_API_BASE_URL: secret("EXTERNAL_API_BASE_URL"),
  },
});
