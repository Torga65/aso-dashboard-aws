/**
 * SpaceCat API client. Used by API routes, CLI, and validators.
 * Aligned with aso-validating-tools fetch scripts.
 */

import type { Opportunity, Site, Suggestion } from '../types';

const DEFAULT_BASE_URL = 'https://spacecat.experiencecloud.live/api/v1';

export interface SpaceCatClientConfig {
  apiKey: string;
  baseURL?: string;
}

export class SpaceCatClient {
  private readonly apiKey: string;
  private readonly baseURL: string;

  constructor(config: SpaceCatClientConfig) {
    if (!config.apiKey?.trim()) {
      throw new Error('SpaceCat API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseURL = (config.baseURL || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const headers: HeadersInit = {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SpaceCat API Error: ${response.status} - ${text}`);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    const trimmed = text.trim();
    if (trimmed === '') {
      return undefined as T;
    }
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      throw new Error(
        `SpaceCat API Error: ${response.status} - response was not valid JSON (first 200 chars): ${text.slice(0, 200)}`
      );
    }
  }

  async getSites(): Promise<Site[]> {
    const result = await this.request<Site[] | { data: Site[] }>('/sites');
    if (result == null) return [];
    if (Array.isArray(result)) return result;
    return (result as { data: Site[] }).data ?? [];
  }

  /**
   * Normalize URL for lookup: trim, strip trailing slash, lowercase so
   * https://Example.com and https://example.com/ match.
   */
  private static normalizeBaseURL(url: string): string {
    return (url || '').trim().replace(/\/$/, '').toLowerCase();
  }

  async getSiteByBaseURL(baseURL: string): Promise<Site | null> {
    const sites = await this.getSites();
    const normalized = SpaceCatClient.normalizeBaseURL(baseURL);
    return (
      sites.find(
        (s) => SpaceCatClient.normalizeBaseURL((s.baseURL ?? '') as string) === normalized
      ) ?? null
    );
  }

  async getOpportunitiesForSite(siteId: string): Promise<Opportunity[]> {
    const result = await this.request<Opportunity[] | { data: Opportunity[] }>(
      `/sites/${siteId}/opportunities`
    );
    if (result == null) return [];
    if (Array.isArray(result)) return result;
    return (result as { data: Opportunity[] }).data ?? [];
  }

  async getSuggestionsForOpportunity(siteId: string, opportunityId: string): Promise<Suggestion[]> {
    const result = await this.request<Suggestion[] | { data: Suggestion[] }>(
      `/sites/${siteId}/opportunities/${opportunityId}/suggestions`
    );
    if (result == null) return [];
    if (Array.isArray(result)) return result;
    return (result as { data: Suggestion[] }).data ?? [];
  }

  async updateSuggestionStatus(
    siteId: string,
    opportunityId: string,
    updates: Array<{ id: string; status: string }>
  ): Promise<unknown> {
    const endpoint = `/sites/${siteId}/opportunities/${opportunityId}/suggestions/status`;
    return this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }
}

export function createSpaceCatClient(apiKey?: string, baseURL?: string): SpaceCatClient {
  const key = apiKey ?? process.env.SPACECAT_API_KEY ?? process.env.USER_API_KEY;
  const url = baseURL ?? process.env.SPACECAT_BASE_URL;
  return new SpaceCatClient({ apiKey: key ?? '', baseURL: url });
}
