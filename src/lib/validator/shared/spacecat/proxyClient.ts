/**
 * IMS-aware SpaceCat client that routes through the /api/spacecat proxy
 * instead of calling SpaceCat directly. Uses the user's IMS Bearer token.
 *
 * Mirrors the interface of SpaceCatClient but sends all requests to
 * /api/spacecat/<path> with Authorization: Bearer <token>.
 */

import type { Opportunity, Site, Suggestion } from '../types';

export class SpaceCatProxyClient {
  private readonly bearerToken: string;
  private readonly proxyBase: string;

  constructor(bearerToken: string) {
    this.bearerToken = bearerToken;
    // Call SpaceCat directly from server-side API routes (relative URLs don't
    // work in Node.js). The proxy exists for browser→server CORS; server-side
    // code can call SpaceCat directly with the same IMS Bearer token.
    this.proxyBase = 'https://spacecat.experiencecloud.live/api/v1';
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.proxyBase}${endpoint}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.bearerToken}`,
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

  async getSiteByBaseURL(baseURL: string): Promise<Site | null> {
    const sites = await this.getSites();
    const normalized = (baseURL || '').trim().replace(/\/$/, '').toLowerCase();
    return (
      sites.find(
        (s) => ((s.baseURL ?? '') as string).trim().replace(/\/$/, '').toLowerCase() === normalized
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
