/**
 * Get a SpaceCat client for server-side use (API routes, etc.).
 * Returns null if API key is not configured (caller should return 401).
 */

import { loadConfig } from '@validator-shared/config';
import { SpaceCatClient } from './client';

let cachedClient: SpaceCatClient | null | undefined = undefined;

/**
 * Reset the cached client. Use in tests when you need to re-run config resolution
 * (e.g. after changing env or asserting behavior when API key is unset).
 */
export function resetSpaceCatClientCache(): void {
  cachedClient = undefined;
}

export function getSpaceCatClient(): SpaceCatClient | null {
  if (cachedClient !== undefined) return cachedClient;
  const config = loadConfig();
  if (!config.spacecat.apiKey?.trim()) {
    cachedClient = null;
    return null;
  }
  cachedClient = new SpaceCatClient({
    apiKey: config.spacecat.apiKey,
    baseURL: config.spacecat.baseURL,
  });
  return cachedClient;
}
