/**
 * spacecat-api.ts — SpaceCat API client (client-side)
 *
 * All requests require an IMS Bearer token from ims.ts.
 */

const SPACECAT_BASE = "https://spacecat.experiencecloud.live/api/v1";

export interface SpaceCatSite {
  id: string;
  baseURL: string;
  deliveryType?: string;
  gitHubURL?: string;
  organizationId?: string;
  isLive?: boolean;
}

export interface SpaceCatOpportunity {
  id: string;
  siteId: string;
  type: string;
  status: string;
  title?: string;
  description?: string;
  updatedAt?: string;
}

export interface SpaceCatSuggestion {
  id: string;
  opportunityId: string;
  status: string;
  type?: string;
  data?: Record<string, unknown>;
  updatedAt?: string;
}

export const SUGGESTION_STATUS = {
  NEW: "NEW",
  APPROVED: "APPROVED",
  IN_PROGRESS: "IN_PROGRESS",
  PENDING_VALIDATION: "PENDING_VALIDATION",
  FIXED: "FIXED",
  SKIPPED: "SKIPPED",
  REJECTED: "REJECTED",
  ERROR: "ERROR",
  OUTDATED: "OUTDATED",
} as const;

export type SuggestionStatusKey = keyof typeof SUGGESTION_STATUS;

export interface SuggestionCounts {
  newCount: number;
  approvedCount: number;
  inProgressCount: number;
  pendingValidationCount: number;
  fixedCount: number;
  skippedCount: number;
  rejectedCount: number;
  errorCount: number;
  outdatedCount: number;
  totalCount: number;
  /** NEW + APPROVED + IN_PROGRESS + PENDING_VALIDATION */
  pendingCount: number;
  /** FIXED + SKIPPED + REJECTED + ERROR + OUTDATED */
  terminalCount: number;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function spacecat<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${SPACECAT_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SpaceCat ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Fetch all sites the user has access to. */
export async function fetchSites(token: string): Promise<SpaceCatSite[]> {
  const data = await spacecat<SpaceCatSite[] | { sites: SpaceCatSite[] }>("/sites", token);
  return Array.isArray(data) ? data : (data as { sites: SpaceCatSite[] }).sites ?? [];
}

/** Fetch all opportunities for a site. */
export async function fetchOpportunities(
  siteId: string,
  token: string
): Promise<SpaceCatOpportunity[]> {
  const data = await spacecat<
    SpaceCatOpportunity[] | { opportunities: SpaceCatOpportunity[] }
  >(`/sites/${siteId}/opportunities`, token);
  return Array.isArray(data)
    ? data
    : (data as { opportunities: SpaceCatOpportunity[] }).opportunities ?? [];
}

/** Fetch all suggestions for one opportunity. */
export async function fetchSuggestions(
  siteId: string,
  opportunityId: string,
  token: string
): Promise<SpaceCatSuggestion[]> {
  const data = await spacecat<
    SpaceCatSuggestion[] | { suggestions: SpaceCatSuggestion[] }
  >(`/sites/${siteId}/opportunities/${opportunityId}/suggestions`, token);
  return Array.isArray(data)
    ? data
    : (data as { suggestions: SpaceCatSuggestion[] }).suggestions ?? [];
}

/** Aggregate suggestions into counts per status. */
export function aggregateSuggestions(suggestions: SpaceCatSuggestion[]): SuggestionCounts {
  const c: SuggestionCounts = {
    newCount: 0,
    approvedCount: 0,
    inProgressCount: 0,
    pendingValidationCount: 0,
    fixedCount: 0,
    skippedCount: 0,
    rejectedCount: 0,
    errorCount: 0,
    outdatedCount: 0,
    totalCount: suggestions.length,
    pendingCount: 0,
    terminalCount: 0,
  };

  for (const s of suggestions) {
    switch (s.status) {
      case "NEW": c.newCount++; break;
      case "APPROVED": c.approvedCount++; break;
      case "IN_PROGRESS": c.inProgressCount++; break;
      case "PENDING_VALIDATION": c.pendingValidationCount++; break;
      case "FIXED": c.fixedCount++; break;
      case "SKIPPED": c.skippedCount++; break;
      case "REJECTED": c.rejectedCount++; break;
      case "ERROR": c.errorCount++; break;
      case "OUTDATED": c.outdatedCount++; break;
      default: c.newCount++;
    }
  }

  c.pendingCount = c.newCount + c.approvedCount + c.inProgressCount + c.pendingValidationCount;
  c.terminalCount = c.fixedCount + c.skippedCount + c.rejectedCount + c.errorCount + c.outdatedCount;

  return c;
}

export interface EnrichedOpportunity extends SpaceCatOpportunity {
  suggestions: SpaceCatSuggestion[];
  counts: SuggestionCounts;
}

/** Fetch opportunities + all their suggestions for a site. */
export async function fetchLifecycleData(
  siteId: string,
  token: string
): Promise<{ opportunities: EnrichedOpportunity[]; totalSuggestions: number }> {
  const opportunities = await fetchOpportunities(siteId, token);

  // Fetch suggestions for all opportunities in parallel (batched 10 at a time)
  const BATCH = 10;
  const enriched: EnrichedOpportunity[] = [];

  for (let i = 0; i < opportunities.length; i += BATCH) {
    const batch = opportunities.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (opp) => {
        try {
          const suggestions = await fetchSuggestions(siteId, opp.id, token);
          return { ...opp, suggestions, counts: aggregateSuggestions(suggestions) };
        } catch {
          return { ...opp, suggestions: [], counts: aggregateSuggestions([]) };
        }
      })
    );
    enriched.push(...results);
  }

  const withSuggestions = enriched.filter((o) => o.counts.totalCount > 0);
  const totalSuggestions = withSuggestions.reduce((s, o) => s + o.counts.totalCount, 0);

  return { opportunities: withSuggestions, totalSuggestions };
}
