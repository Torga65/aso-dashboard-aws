/**
 * GET /api/reports/paid-resolved-opportunities-week
 *
 * Paid customers (latest weekly snapshot, license contains "paid") who had at least one
 * SpaceCat opportunity move to RESOLVED during the report window.
 *
 * Query (optional):
 *   from, to — YYYY-MM-DD inclusive (UTC calendar dates compared to opportunity updatedAt).
 *   If omitted, uses the UTC Monday–Sunday week containing the current request date.
 *
 * Auth: Authorization: Bearer <IMS token> (same as SpaceCat portfolio routes).
 */

import { NextRequest, NextResponse } from "next/server";
import { loadAllCustomers } from "@/lib/server/load-all-customers";
import type { Customer } from "@/lib/types";

export const maxDuration = 120;

const SPACECAT_BASE = "https://spacecat.experiencecloud.live/api/v1";
const BATCH_SIZE = 25;

function utcWeekRangeContaining(d = new Date()): { from: string; to: string } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  const daysFromMonday = (dow + 6) % 7;
  const monday = new Date(Date.UTC(y, m, day - daysFromMonday));
  const sunday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6));
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  return { from: fmt(monday), to: fmt(sunday) };
}

function isPaidCustomer(c: Customer): boolean {
  const lt = (c.licenseType || "").toLowerCase();
  return lt.includes("paid");
}

/** Latest snapshot per company (lexicographic week — matches ISO dates and 2026-Wxx if consistent). */
function latestByCompanyName(rows: Customer[]): Map<string, Customer> {
  const m = new Map<string, Customer>();
  for (const r of rows) {
    if (r.hidden) continue;
    const prev = m.get(r.companyName);
    if (!prev || r.week > prev.week) m.set(r.companyName, r);
  }
  return m;
}

async function spacecatGet(url: string, token: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`SpaceCat ${res.status}: ${url}`);
  return res.json();
}

interface ScOrg {
  id?: string;
  imsOrgId?: string | null;
  name?: string;
}

async function fetchOrganizations(token: string): Promise<ScOrg[]> {
  const data = await spacecatGet(`${SPACECAT_BASE}/organizations`, token);
  const raw = Array.isArray(data) ? data : data.organizations || data.data || [];
  return Array.isArray(raw) ? raw : [];
}

function buildImsToOrgIdMap(orgs: ScOrg[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const o of orgs) {
    const id = o.id;
    const ims = (o.imsOrgId || "").trim();
    if (!id || !ims) continue;
    m.set(ims, id);
    m.set(ims.toLowerCase(), id);
  }
  return m;
}

async function fetchOrgSiteIds(orgId: string, token: string): Promise<string[]> {
  const data = await spacecatGet(`${SPACECAT_BASE}/organizations/${orgId}/sites`, token);
  const sites: { id?: string; siteId?: string }[] = Array.isArray(data)
    ? data
    : data.sites || data.data || [];
  return sites.map((s) => s.id || s.siteId).filter(Boolean) as string[];
}

interface RawOpp {
  id?: string;
  status?: string;
  updatedAt?: string;
  type?: string;
  title?: string;
}

async function fetchSiteOpportunities(siteId: string, token: string): Promise<RawOpp[]> {
  try {
    const data = await spacecatGet(`${SPACECAT_BASE}/sites/${siteId}/opportunities`, token);
    return Array.isArray(data) ? data : data.opportunities || data.data || [];
  } catch {
    return [];
  }
}

async function fetchOpportunitiesForSites(
  siteIds: string[],
  token: string
): Promise<(RawOpp & { siteId: string })[]> {
  const all: (RawOpp & { siteId: string })[] = [];
  for (let i = 0; i < siteIds.length; i += BATCH_SIZE) {
    const batch = siteIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (siteId) => {
        const opps = await fetchSiteOpportunities(siteId, token);
        return opps.map((o) => ({ ...o, siteId }));
      })
    );
    for (const opps of results) all.push(...opps);
  }
  return all;
}

function updatedInRange(updatedAt: string | undefined, from: string, to: string): boolean {
  if (!updatedAt) return false;
  const d = updatedAt.slice(0, 10);
  return d >= from && d <= to;
}

export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  if (!token) {
    return NextResponse.json({ error: "Authorization: Bearer <IMS token> required" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  let from = searchParams.get("from") || "";
  let to = searchParams.get("to") || "";
  if (!from || !to) {
    const w = utcWeekRangeContaining(new Date());
    from = w.from;
    to = w.to;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json(
      { error: "from and to must be YYYY-MM-DD when provided" },
      { status: 400 }
    );
  }

  try {
    const allRows = await loadAllCustomers();
    const latest = latestByCompanyName(allRows);
    const paidLatest = [...latest.values()].filter(isPaidCustomer);

    let orgs: ScOrg[];
    try {
      orgs = await fetchOrganizations(token);
    } catch (e) {
      console.error("[paid-resolved-week] organizations fetch failed:", e);
      return NextResponse.json({ error: "Failed to list SpaceCat organizations" }, { status: 502 });
    }

    const imsToOrg = buildImsToOrgIdMap(orgs);

    /** spaceCatOrgId -> company names (paid, latest) sharing that IMS org */
    const orgToCompanies = new Map<string, string[]>();
    const noIms: string[] = [];
    const noOrgMatch: string[] = [];

    for (const c of paidLatest) {
      const ims = (c.imsOrgId || "").trim();
      if (!ims) {
        noIms.push(c.companyName);
        continue;
      }
      const orgId = imsToOrg.get(ims) ?? imsToOrg.get(ims.toLowerCase());
      if (!orgId) {
        noOrgMatch.push(c.companyName);
        continue;
      }
      const arr = orgToCompanies.get(orgId) ?? [];
      if (!arr.includes(c.companyName)) arr.push(c.companyName);
      orgToCompanies.set(orgId, arr);
    }

    const customersWithResolved: {
      companyName: string;
      imsOrgId: string;
      licenseType: string;
      spaceCatOrgId: string;
      resolvedCount: number;
      resolved: { opportunityId: string; siteId?: string; type: string; title: string; updatedAt: string }[];
    }[] = [];

    for (const [orgId, companyNames] of orgToCompanies) {
      let siteIds: string[];
      try {
        siteIds = await fetchOrgSiteIds(orgId, token);
      } catch {
        continue;
      }
      if (!siteIds.length) continue;

      const opps = await fetchOpportunitiesForSites(siteIds, token);
      const resolved = opps.filter(
        (o) => o.status === "RESOLVED" && updatedInRange(o.updatedAt, from, to)
      );

      if (resolved.length === 0) continue;

      const resolvedPayload = resolved.map((o) => ({
        opportunityId: String(o.id ?? ""),
        siteId: o.siteId,
        type: o.type || "",
        title: o.title || "",
        updatedAt: o.updatedAt || "",
      }));

      for (const companyName of companyNames) {
        const c = paidLatest.find((x) => x.companyName === companyName);
        if (!c) continue;
        customersWithResolved.push({
          companyName,
          imsOrgId: c.imsOrgId || "",
          licenseType: c.licenseType || "",
          spaceCatOrgId: orgId,
          resolvedCount: resolved.length,
          resolved: resolvedPayload,
        });
      }
    }

    customersWithResolved.sort((a, b) => a.companyName.localeCompare(b.companyName));

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      range: { from, to, timezone: "UTC date portion of opportunity updatedAt" },
      definition:
        "Latest snapshot per company where licenseType contains 'paid' (case-insensitive), " +
        "excluding hidden rows; SpaceCat opportunity status RESOLVED with updatedAt date in [from, to].",
      counts: {
        paidCustomersLatestSnapshot: paidLatest.length,
        paidWithImsOrgId: paidLatest.filter((c) => (c.imsOrgId || "").trim()).length,
        paidMatchedToSpaceCatOrg: orgToCompanies.size,
        paidCustomersListedWithoutImsOrgId: noIms.length,
        paidCustomersWithNoSpaceCatOrgMatch: noOrgMatch.length,
        paidCustomersWithResolvedOppsThisWeek: customersWithResolved.length,
      },
      skipped: {
        latestSnapshotMissingImsOrgId: noIms,
        noSpaceCatOrganizationForImsOrgId: noOrgMatch,
      },
      customers: customersWithResolved,
    });
  } catch (err) {
    console.error("[paid-resolved-week]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Report failed" },
      { status: 500 }
    );
  }
}
