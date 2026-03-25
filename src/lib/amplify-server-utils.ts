import { createServerRunner } from "@aws-amplify/adapter-nextjs";
import { generateServerClientUsingCookies } from "@aws-amplify/adapter-nextjs/data";
import { cookies } from "next/headers";
import outputs from "../../amplify_outputs.json";
import type { Schema } from "../../amplify/data/resource";

/**
 * Server-side Amplify runner.
 * Used in Server Components, Route Handlers, and Server Actions.
 */
export const { runWithAmplifyServerContext } = createServerRunner({
  config: outputs,
});

/**
 * API-key client — use in Server Components for public data
 * (CustomerSnapshot, WeeklySummary).
 * No Cognito session required; safe for SSR and static generation.
 */
export function getServerClient() {
  return generateServerClientUsingCookies<Schema>({
    config: outputs,
    cookies,
    authMode: "apiKey",
  });
}
