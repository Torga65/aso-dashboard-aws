/**
 * Application-level TypeScript types.
 *
 * DynamoDB model types are auto-generated from the Amplify schema.
 * Import them directly from the data resource:
 *
 *   import type { Schema } from "../../amplify/data/resource";
 *   type ContentItem = Schema["ContentItem"]["type"];
 *
 * Add shared UI or domain types below.
 */

export type PageParams<T extends Record<string, string> = Record<string, string>> = {
  params: T;
  searchParams?: Record<string, string | string[] | undefined>;
};
