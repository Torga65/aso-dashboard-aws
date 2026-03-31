/**
 * GET /api/portfolio/opportunity-metrics
 *
 * Aggregates SpaceCat opportunity data across sites for the portfolio view.
 * Ported from cm-p186978-s23215-asodashboard/server/src/routes/portfolio.js
 *
 * Query params:
 *   orgId      - SpaceCat org ID (one customer's sites)
 *   siteIds    - comma-separated site IDs (explicit list)
 *   siteScope  - 'global' to fetch ALL sites
 *   from       - (required) 'YYYY-MM-DD'
 *   to         - (required) 'YYYY-MM-DD'
 *   includeLlmo    - '1' to include LLMO-only opportunities
 *   includeGeneric - '1' to include generic-opportunity type
 */

import { NextRequest, NextResponse } from "next/server";

// Extend the serverless function timeout as high as Amplify allows
export const maxDuration = 60;

const SPACECAT_BASE = "https://spacecat.experiencecloud.live/api/v1";
const BATCH_SIZE = 20; // higher parallelism to finish faster
const BATCH_DELAY_MS = 0;

// ─── In-memory cache (survives across requests within the same Lambda instance) ─

interface CacheEntry { data: unknown; expiresAt: number; }
const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function cacheGet(key: string) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.data;
}

function cacheSet(key: string, data: unknown) {
  _cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── SpaceCat helpers ────────────────────────────────────────────────────────

async function spacecatGet(url: string, token: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`SpaceCat ${res.status}: ${url}`);
  return res.json();
}

async function fetchAllSiteIds(token: string): Promise<string[]> {
  const cacheKey = "sites:global";
  const cached = cacheGet(cacheKey);
  if (cached) return cached as string[];
  const data = await spacecatGet(`${SPACECAT_BASE}/sites`, token);
  const sites: { id?: string; siteId?: string }[] = Array.isArray(data)
    ? data
    : data.sites || data.data || [];
  const ids = sites.map((s) => s.id || s.siteId).filter(Boolean) as string[];
  cacheSet(cacheKey, ids);
  return ids;
}

async function fetchOrgSiteIds(orgId: string, token: string): Promise<string[]> {
  const cacheKey = `sites:${orgId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached as string[];
  const data = await spacecatGet(`${SPACECAT_BASE}/organizations/${orgId}/sites`, token);
  const sites: { id?: string; siteId?: string }[] = Array.isArray(data)
    ? data
    : data.sites || data.data || [];
  const ids = sites.map((s) => s.id || s.siteId).filter(Boolean) as string[];
  cacheSet(cacheKey, ids);
  return ids;
}

async function fetchSiteOpportunities(siteId: string, token: string) {
  try {
    const data = await spacecatGet(`${SPACECAT_BASE}/sites/${siteId}/opportunities`, token);
    return Array.isArray(data) ? data : data.opportunities || data.data || [];
  } catch {
    return [];
  }
}

async function fetchOpportunitiesForSites(siteIds: string[], token: string) {
  const allOpps: unknown[] = [];
  for (let i = 0; i < siteIds.length; i += BATCH_SIZE) {
    const batch = siteIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((id) => fetchSiteOpportunities(id, token)));
    for (const opps of results) allOpps.push(...opps);
    if (i + BATCH_SIZE < siteIds.length) {
      await new Promise<void>((r) => { setTimeout(r, BATCH_DELAY_MS); });
    }
  }
  return allOpps;
}

// ─── Filtering ───────────────────────────────────────────────────────────────

const LLMO_ONLY_TYPES = new Set(["prerender", "readability", "summarization", "llm-blocked"]);

function isLlmoOnly(opp: { tags?: string[]; type?: string }) {
  const tags = Array.isArray(opp.tags) ? opp.tags : [];
  if (tags.includes("isElmo") && tags.includes("isASO")) return false;
  if (tags.includes("isASO") && !tags.includes("isElmo")) return false;
  if (tags.includes("isElmo") && !tags.includes("isASO")) return true;
  return LLMO_ONLY_TYPES.has((opp.type || "").toLowerCase());
}

function filterOpps(opps: { tags?: string[]; type?: string }[], includeLlmo: boolean, includeGeneric: boolean) {
  return opps.filter((o) => {
    const type = (o.type || "").toLowerCase();
    if (type === "product-metatags") return false;
    if ((o.tags || []).includes("Commerce")) return false;
    if (!includeLlmo && isLlmoOnly(o)) return false;
    if (!includeGeneric && type === "generic-opportunity") return false;
    return true;
  });
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

const OPEN_STATUSES = new Set(["NEW", "IN_PROGRESS"]);
const SUG_FIXED = "FIXED", SUG_SKIPPED = "SKIPPED", SUG_REJECTED = "REJECTED";
const SUG_PENDING = "PENDING_VALIDATION", SUG_OUTDATED = "OUTDATED", SUG_ERROR = "ERROR";
const AWAITING_CUSTOMER = new Set(["NEW", "APPROVED", "IN_PROGRESS"]);

interface Opportunity {
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  type?: string;
  tags?: string[];
  suggestionCounts?: {
    skippedCount?: number;
    rejectedRawCount?: number;
    pendingValidationCount?: number;
    newCount?: number;
    approvedCount?: number;
    inProgressCount?: number;
    fixedCount?: number;
    totalCount?: number;
  };
  suggestionStates?: { s: string; u?: string; c?: string }[];
}

function aggregateOpportunities(opportunities: Opportunity[], from: string, to: string) {
  const createdDayMap = new Map<string, Record<string, number>>();
  const totalCounts: Record<string, number> = {};
  const statusChangeDayMap = new Map<string, Record<string, number>>();
  const inScopeIndices = new Set<number>();

  let totalAvailable = 0, createdInPeriod = 0, fixedInPeriod = 0, outdatedInPeriod = 0;
  let skippedByCustomer = 0, rejectedByEse = 0, pendingValidation = 0;
  let awaitingCustomerReview = 0, suggestionsFixed = 0, totalSuggestions = 0;
  let movedToFixed = 0, movedToAwaitingCustomerReview = 0, movedToAwaitingEseReview = 0;
  let movedToSkipped = 0, movedToRejected = 0, movedToOutdated = 0, movedToError = 0;

  for (let i = 0; i < opportunities.length; i++) {
    const opp = opportunities[i];
    if (!opp.createdAt || !opp.status) continue;
    const createdDate = opp.createdAt.slice(0, 10);
    const updatedDate = opp.updatedAt ? opp.updatedAt.slice(0, 10) : null;
    const { status } = opp;
    const isCreatedInPeriod = createdDate >= from && createdDate <= to;

    if (isCreatedInPeriod) {
      if (!createdDayMap.has(createdDate)) createdDayMap.set(createdDate, {});
      const dc = createdDayMap.get(createdDate)!;
      dc[status] = (dc[status] || 0) + 1;
      totalCounts[status] = (totalCounts[status] || 0) + 1;
      createdInPeriod++;
      totalAvailable++;
      inScopeIndices.add(i);
    } else if (createdDate < from) {
      const isOpen = OPEN_STATUSES.has(status);
      const changedAfterStart = updatedDate && updatedDate >= from;
      if (isOpen || changedAfterStart) { totalAvailable++; inScopeIndices.add(i); }
    }

    if (status === "RESOLVED" && updatedDate && updatedDate >= from && updatedDate <= to) {
      fixedInPeriod++;
      if (!statusChangeDayMap.has(updatedDate)) statusChangeDayMap.set(updatedDate, {});
      const dc = statusChangeDayMap.get(updatedDate)!;
      dc.RESOLVED = (dc.RESOLVED || 0) + 1;
    }
    if (status === "IGNORED" && updatedDate && updatedDate >= from && updatedDate <= to) {
      outdatedInPeriod++;
      if (!statusChangeDayMap.has(updatedDate)) statusChangeDayMap.set(updatedDate, {});
      const dc = statusChangeDayMap.get(updatedDate)!;
      dc.IGNORED = (dc.IGNORED || 0) + 1;
    }
  }

  for (let i = 0; i < opportunities.length; i++) {
    if (!inScopeIndices.has(i)) continue;
    const opp = opportunities[i];
    const sc = opp.suggestionCounts;
    if (sc) {
      skippedByCustomer += sc.skippedCount ?? 0;
      rejectedByEse += sc.rejectedRawCount ?? 0;
      pendingValidation += sc.pendingValidationCount ?? 0;
      awaitingCustomerReview += (sc.newCount ?? 0) + (sc.approvedCount ?? 0) + (sc.inProgressCount ?? 0);
      suggestionsFixed += sc.fixedCount ?? 0;
      totalSuggestions += sc.totalCount ?? 0;
    }
    const states = opp.suggestionStates;
    if (Array.isArray(states)) {
      for (const { s: sug, u: upd, c: created } of states) {
        const inRange = (upd && upd >= from && upd <= to)
          || (!upd && created && created >= from && created <= to);
        if (!inRange) continue;
        if (sug === SUG_FIXED) movedToFixed++;
        else if (sug === SUG_SKIPPED) movedToSkipped++;
        else if (sug === SUG_REJECTED) movedToRejected++;
        else if (sug === SUG_PENDING) movedToAwaitingEseReview++;
        else if (sug === SUG_OUTDATED) movedToOutdated++;
        else if (sug === SUG_ERROR) movedToError++;
        else if (AWAITING_CUSTOMER.has(sug)) movedToAwaitingCustomerReview++;
      }
    }
  }

  const buckets = Array.from(createdDayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, counts }));
  const statusChangeBuckets = Array.from(statusChangeDayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, counts }));

  return {
    buckets,
    totalCounts,
    statusChangeBuckets,
    summary: {
      totalAvailable, createdInPeriod, fixedInPeriod, outdatedInPeriod,
      skippedByCustomer, rejectedByEse, pendingValidation, awaitingCustomerReview,
      suggestionsFixed, totalSuggestions,
      customerEngagement: skippedByCustomer + suggestionsFixed,
      movedToFixed, movedToAwaitingCustomerReview, movedToAwaitingEseReview,
      movedToSkipped, movedToRejected, movedToOutdated, movedToError,
      movedToCustomerEngagement: movedToSkipped + movedToFixed,
      totalCreatedOrUpdatedInPeriod: movedToFixed + movedToAwaitingCustomerReview
        + movedToAwaitingEseReview + movedToSkipped + movedToRejected + movedToOutdated + movedToError,
    },
  };
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "") || null;
  if (!token) {
    return NextResponse.json({ error: "Authorization token required" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const orgId = searchParams.get("orgId");
  const siteIdsParam = searchParams.get("siteIds");
  const siteScope = searchParams.get("siteScope");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const includeLlmo = searchParams.get("includeLlmo") === "1" || searchParams.get("includeLlmo") === "true";
  const includeGeneric = searchParams.get("includeGeneric") === "1" || searchParams.get("includeGeneric") === "true";

  if (!from || !to) {
    return NextResponse.json({ error: "`from` and `to` query params are required (YYYY-MM-DD)" }, { status: 400 });
  }

  let siteIds: string[];
  try {
    if (siteIdsParam) {
      siteIds = siteIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (siteScope === "global") {
      siteIds = await fetchAllSiteIds(token);
    } else if (orgId) {
      siteIds = await fetchOrgSiteIds(orgId, token);
    } else {
      return NextResponse.json({ error: "Provide `siteScope=global`, `orgId`, or `siteIds`" }, { status: 400 });
    }
  } catch (err) {
    console.error("[/api/portfolio/opportunity-metrics] Failed to fetch sites:", err);
    return NextResponse.json({ error: "Failed to fetch sites from SpaceCat" }, { status: 502 });
  }

  if (!siteIds.length) {
    return NextResponse.json({ buckets: [], totalCounts: {}, siteCount: 0, summary: {} });
  }

  const scope = siteIdsParam
    ? `custom:${siteIdsParam.split(",").sort().join(",")}`
    : siteScope === "global" ? "global" : (orgId ?? "unknown");
  const metricsCacheKey = `metrics:${scope}:${from}:${to}:llmo=${includeLlmo}:generic=${includeGeneric}`;
  const cachedResult = cacheGet(metricsCacheKey);
  if (cachedResult) {
    console.log(`[Portfolio] Cache hit: ${metricsCacheKey}`);
    return NextResponse.json(cachedResult);
  }

  try {
    console.log(`[Portfolio] Fetching opportunities for ${siteIds.length} sites...`);
    let opps = await fetchOpportunitiesForSites(siteIds, token);
    opps = filterOpps(opps as { tags?: string[]; type?: string }[], includeLlmo, includeGeneric);
    const result = { ...aggregateOpportunities(opps as Opportunity[], from, to), siteCount: siteIds.length, source: "live" };
    cacheSet(metricsCacheKey, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/portfolio/opportunity-metrics] Aggregation error:", err);
    return NextResponse.json({ error: "Failed to aggregate opportunity metrics" }, { status: 500 });
  }
}
