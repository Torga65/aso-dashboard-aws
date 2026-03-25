"use client";

/**
 * data-client.ts — browser-side Amplify data client
 *
 * Import this module only from Client Components or the hooks in lib/hooks/.
 * Server Components must use getServerClient() from lib/amplify-server-utils.ts.
 *
 * The `generateClient<Schema>()` call is safe to run at module load time;
 * it does not make any network requests until a query is executed.
 */
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

export const dataClient = generateClient<Schema>();

// Re-export the Schema type alias so hooks can reference it without an extra import.
export type { Schema };
