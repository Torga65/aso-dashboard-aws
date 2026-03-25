"use client";
/**
 * SuggestionLifecycleView
 *
 * Shows ASO suggestion lifecycle data from the SpaceCat API.
 * Requires IMS authentication — prompts to sign in if not authenticated.
 *
 * UX flow:
 *  1. User is signed in → page fetches their SpaceCat sites
 *  2. User picks a site from the dropdown
 *  3. Page fetches opportunities + suggestions → shows lifecycle breakdown
 */

import { useEffect, useState, useCallback } from "react";
import { isAuthenticated, getAccessToken, signIn } from "@/lib/ims";
import {
  fetchSites,
  fetchLifecycleData,
  type SpaceCatSite,
  type EnrichedOpportunity,
} from "@/lib/spacecat-api";
import styles from "./SuggestionLifecycleView.module.css";

// ─── Status labels & colours ──────────────────────────────────────────────────

const STATUS_COLOURS: Record<string, string> = {
  NEW: "#6b7280",
  APPROVED: "#2563eb",
  IN_PROGRESS: "#7c3aed",
  PENDING_VALIDATION: "#d97706",
  FIXED: "#16a34a",
  SKIPPED: "#9ca3af",
  REJECTED: "#dc2626",
  ERROR: "#ea580c",
  OUTDATED: "#a16207",
};

const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  APPROVED: "Approved",
  IN_PROGRESS: "In Progress",
  PENDING_VALIDATION: "Pending Validation",
  FIXED: "Fixed",
  SKIPPED: "Skipped",
  REJECTED: "Rejected",
  ERROR: "Error",
  OUTDATED: "Outdated",
};

/** Map from status enum value → SuggestionCounts key */
const STATUS_COUNT_KEY: Record<string, keyof import("@/lib/spacecat-api").SuggestionCounts> = {
  NEW: "newCount",
  APPROVED: "approvedCount",
  IN_PROGRESS: "inProgressCount",
  PENDING_VALIDATION: "pendingValidationCount",
  FIXED: "fixedCount",
  SKIPPED: "skippedCount",
  REJECTED: "rejectedCount",
  ERROR: "errorCount",
  OUTDATED: "outdatedCount",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ status, count }: { status: string; count: number }) {
  if (count === 0) return null;
  return (
    <span
      className={styles.statusPill}
      style={{ background: STATUS_COLOURS[status] ?? "#6b7280" }}
    >
      {STATUS_LABELS[status] ?? status}: {count}
    </span>
  );
}

function OpportunityRow({ opp }: { opp: EnrichedOpportunity }) {
  const { counts } = opp;
  const pct = counts.totalCount > 0
    ? Math.round((counts.fixedCount / counts.totalCount) * 100)
    : 0;

  return (
    <div className={styles.oppRow}>
      <div className={styles.oppHeader}>
        <span className={styles.oppType}>{opp.type}</span>
        <span className={styles.oppStatus}>{opp.status}</span>
        <span className={styles.oppTotal}>{counts.totalCount} suggestions</span>
      </div>

      {/* Progress bar */}
      <div className={styles.progressTrack}>
        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.progressLabel}>{pct}% fixed</span>

      {/* Status pills */}
      <div className={styles.pills}>
        {Object.keys(STATUS_LABELS).map((s) => (
          <StatusPill key={s} status={s} count={counts[STATUS_COUNT_KEY[s]] as number} />
        ))}
      </div>
    </div>
  );
}

function SummaryCards({
  opportunities,
  totalSuggestions,
}: {
  opportunities: EnrichedOpportunity[];
  totalSuggestions: number;
}) {
  const totalFixed = opportunities.reduce((s, o) => s + o.counts.fixedCount, 0);
  const totalPending = opportunities.reduce((s, o) => s + o.counts.pendingCount, 0);
  const pct = totalSuggestions > 0 ? Math.round((totalFixed / totalSuggestions) * 100) : 0;

  return (
    <div className={styles.summaryCards}>
      <div className={styles.card}>
        <div className={styles.cardValue}>{opportunities.length}</div>
        <div className={styles.cardLabel}>Opportunities</div>
      </div>
      <div className={styles.card}>
        <div className={styles.cardValue}>{totalSuggestions}</div>
        <div className={styles.cardLabel}>Total Suggestions</div>
      </div>
      <div className={styles.card} style={{ color: "#16a34a" }}>
        <div className={styles.cardValue}>{totalFixed}</div>
        <div className={styles.cardLabel}>Fixed ({pct}%)</div>
      </div>
      <div className={styles.card} style={{ color: "#d97706" }}>
        <div className={styles.cardValue}>{totalPending}</div>
        <div className={styles.cardLabel}>Pending</div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SuggestionLifecycleView() {
  const [authed, setAuthed] = useState(false);
  const [sites, setSites] = useState<SpaceCatSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [siteSearch, setSiteSearch] = useState("");
  const [opportunities, setOpportunities] = useState<EnrichedOpportunity[]>([]);
  const [totalSuggestions, setTotalSuggestions] = useState(0);
  const [loadingSites, setLoadingSites] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep auth state in sync
  useEffect(() => {
    const sync = () => setAuthed(isAuthenticated());
    sync();
    window.addEventListener("ims-auth-change", sync);
    return () => window.removeEventListener("ims-auth-change", sync);
  }, []);

  // Fetch sites when authenticated
  useEffect(() => {
    if (!authed) return;
    const token = getAccessToken();
    if (!token) return;

    setLoadingSites(true);
    fetchSites(token)
      .then((list) => {
        const sorted = [...list].sort((a, b) => a.baseURL.localeCompare(b.baseURL));
        setSites(sorted);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingSites(false));
  }, [authed]);

  // Fetch lifecycle data when a site is selected
  const loadSiteData = useCallback(
    (siteId: string) => {
      const token = getAccessToken();
      if (!token || !siteId) return;

      setLoadingData(true);
      setError(null);
      setOpportunities([]);

      fetchLifecycleData(siteId, token)
        .then(({ opportunities: opps, totalSuggestions: total }) => {
          setOpportunities(opps);
          setTotalSuggestions(total);
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => setLoadingData(false));
    },
    []
  );

  function handleSiteChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    setSelectedSiteId(id);
    if (id) loadSiteData(id);
  }

  const filteredSites = siteSearch
    ? sites.filter((s) =>
        s.baseURL.toLowerCase().includes(siteSearch.toLowerCase())
      )
    : sites;

  // ── Unauthenticated ─────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className={styles.authGate}>
        <div className={styles.authGateInner}>
          <h2>Sign in required</h2>
          <p>
            The Suggestion Lifecycle page queries the SpaceCat API, which requires
            an Adobe IMS access token.
          </p>
          <button className={styles.signInBtn} onClick={signIn}>
            Sign in with Adobe
          </button>
        </div>
      </div>
    );
  }

  // ── Authenticated ───────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <div className={styles.pageInner}>
        <h1 className={styles.heading}>Suggestion Lifecycle</h1>

        {/* Site selector */}
        <div className={styles.siteSelector}>
          <label className={styles.label} htmlFor="site-search">
            Filter sites
          </label>
          <input
            id="site-search"
            className={styles.input}
            type="text"
            placeholder="Type to filter…"
            value={siteSearch}
            onChange={(e) => setSiteSearch(e.target.value)}
          />

          <label className={styles.label} htmlFor="site-select">
            Select site
          </label>
          {loadingSites ? (
            <p>Loading sites…</p>
          ) : (
            <select
              id="site-select"
              className={styles.select}
              value={selectedSiteId}
              onChange={handleSiteChange}
            >
              <option value="">— choose a site —</option>
              {filteredSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.baseURL}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Error */}
        {error && <p className={styles.error}>{error}</p>}

        {/* Loading spinner */}
        {loadingData && (
          <p className={styles.loading}>Fetching lifecycle data…</p>
        )}

        {/* Results */}
        {!loadingData && selectedSiteId && opportunities.length === 0 && !error && (
          <p className={styles.empty}>No opportunities with suggestions found for this site.</p>
        )}

        {opportunities.length > 0 && (
          <>
            <SummaryCards
              opportunities={opportunities}
              totalSuggestions={totalSuggestions}
            />

            <h2 className={styles.subheading}>Opportunities</h2>
            <div className={styles.oppList}>
              {opportunities.map((opp) => (
                <OpportunityRow key={opp.id} opp={opp} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
