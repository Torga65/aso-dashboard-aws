"use client";
/**
 * DeveloperView — /developer
 *
 * A tools page for developers:
 *   - Manually enter an IMS access token (for Cursor browser or when Okta is unavailable)
 *   - See current auth state, token expiry, and parsed JWT claims
 *   - Clear the token
 */

import { useState, useCallback } from "react";
import { useIMSAuth, IMS_CLIENT_ID } from "@/contexts/IMSAuthContext";
import styles from "./DeveloperView.module.css";

// ─── JWT parsing ──────────────────────────────────────────────────────────────

interface TokenInfo {
  issuedAt: Date | null;
  expiresAt: Date | null;
  userId: string | null;
  email: string | null;
  clientId: string | null;
  scope: string | null;
  status: "valid" | "expiring" | "expired";
  timeRemaining: string;
}

function parseToken(token: string): TokenInfo | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));

    let issuedAt: Date | null = null;
    let expiresAt: Date | null = null;

    // Standard JWT
    if (payload.exp) expiresAt = new Date(payload.exp * 1000);
    if (payload.iat) issuedAt = new Date(payload.iat * 1000);

    // Adobe IMS format
    if (payload.created_at && payload.expires_in) {
      issuedAt = new Date(parseInt(payload.created_at));
      expiresAt = new Date(parseInt(payload.created_at) + parseInt(payload.expires_in));
    }

    const now = Date.now();
    const remaining = expiresAt ? expiresAt.getTime() - now : 0;

    let status: TokenInfo["status"] = "valid";
    if (remaining <= 0) status = "expired";
    else if (remaining < 60 * 60 * 1000) status = "expiring"; // < 1 hour

    const fmt = (ms: number) => {
      if (ms <= 0) return "Expired";
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      if (h > 0) return `${h}h ${m}m remaining`;
      return `${m}m remaining`;
    };

    return {
      issuedAt,
      expiresAt,
      userId: payload.user_id || payload.sub || null,
      email: payload.email || null,
      clientId: payload.client_id || null,
      scope: payload.scope || null,
      status,
      timeRemaining: fmt(remaining),
    };
  } catch {
    return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DeveloperView() {
  const {
    isAuthenticated,
    accessToken,
    profile,
    isManualToken,
    setManualToken,
    clearManualToken,
    signIn,
    signOut,
  } = useIMSAuth();

  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState("");
  const [showToken, setShowToken] = useState(false);

  const tokenInfo = accessToken ? parseToken(accessToken) : null;

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!draft.trim()) {
        setDraftError("Please paste an IMS access token.");
        return;
      }
      setManualToken(draft.trim());
      setDraft("");
      setDraftError("");
    },
    [draft, setManualToken]
  );

  const statusColour = {
    valid: "#16a34a",
    expiring: "#d97706",
    expired: "#dc2626",
  };

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.badge}>DEV TOOLS</div>
        <h1 className={styles.heading}>Developer</h1>
        <p className={styles.sub}>
          Use this area to manually provide an IMS access token — useful when the
          Adobe Okta SSO flow is unavailable (e.g. Cursor browser).
        </p>

        {/* ── Current auth state ─────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>Current Auth State</h2>
          <div className={styles.stateGrid}>
            <div className={styles.stateRow}>
              <span className={styles.stateLabel}>Status</span>
              <span
                className={styles.stateValue}
                style={{ color: isAuthenticated ? "#16a34a" : "#dc2626", fontWeight: 700 }}
              >
                {isAuthenticated ? "Authenticated" : "Not authenticated"}
              </span>
            </div>
            {isAuthenticated && (
              <div className={styles.stateRow}>
                <span className={styles.stateLabel}>Method</span>
                <span className={styles.stateValue}>
                  {isManualToken ? "Manual token (developer)" : "Adobe IMS SSO"}
                </span>
              </div>
            )}
            {profile && (
              <>
                <div className={styles.stateRow}>
                  <span className={styles.stateLabel}>User</span>
                  <span className={styles.stateValue}>
                    {profile.displayName || `${profile.first_name} ${profile.last_name}`.trim() || "—"}
                  </span>
                </div>
                <div className={styles.stateRow}>
                  <span className={styles.stateLabel}>Email</span>
                  <span className={styles.stateValue}>{profile.email || "—"}</span>
                </div>
              </>
            )}
            {tokenInfo && (
              <>
                <div className={styles.stateRow}>
                  <span className={styles.stateLabel}>Token expiry</span>
                  <span
                    className={styles.stateValue}
                    style={{ color: statusColour[tokenInfo.status] }}
                  >
                    {tokenInfo.timeRemaining}
                    {tokenInfo.expiresAt && (
                      <span className={styles.stateSmall}>
                        {" "}({tokenInfo.expiresAt.toLocaleString()})
                      </span>
                    )}
                  </span>
                </div>
                {tokenInfo.userId && (
                  <div className={styles.stateRow}>
                    <span className={styles.stateLabel}>User ID</span>
                    <span className={styles.stateValue}>{tokenInfo.userId}</span>
                  </div>
                )}
                {tokenInfo.clientId && (
                  <div className={styles.stateRow}>
                    <span className={styles.stateLabel}>Client ID</span>
                    <span className={styles.stateValue}>{tokenInfo.clientId}</span>
                  </div>
                )}
              </>
            )}
            {accessToken && (
              <div className={styles.stateRow}>
                <span className={styles.stateLabel}>Token</span>
                <span className={styles.stateValue}>
                  <button
                    className={styles.textBtn}
                    onClick={() => setShowToken((v) => !v)}
                  >
                    {showToken ? "Hide" : "Show"}
                  </button>
                  {showToken && (
                    <code className={styles.tokenPreview}>{accessToken}</code>
                  )}
                </span>
              </div>
            )}
          </div>

          {isAuthenticated && (
            <button className={styles.dangerBtn} onClick={signOut}>
              Sign out &amp; clear all tokens
            </button>
          )}
        </section>

        {/* ── IMS SSO sign-in ─────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>Adobe IMS Sign-In</h2>
          <p className={styles.sectionDesc}>
            Sign in via the normal Adobe Okta SSO flow. Uses IMS client{" "}
            <code>{IMS_CLIENT_ID}</code>.
          </p>
          <button className={styles.primaryBtn} onClick={signIn}>
            Sign in with Adobe
          </button>
        </section>

        {/* ── Manual token entry ──────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>Manual Token Entry</h2>
          <p className={styles.sectionDesc}>
            Paste a valid IMS Bearer token. The token is stored in{" "}
            <code>localStorage</code> and used in place of the SSO token.
          </p>
          <form onSubmit={handleSubmit} className={styles.tokenForm}>
            <label className={styles.label} htmlFor="manual-token">
              IMS Access Token
            </label>
            <textarea
              id="manual-token"
              className={styles.textarea}
              rows={4}
              placeholder="eyJhbGciOiJSUzI1NiJ9…"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDraftError("");
              }}
            />
            {draftError && <p className={styles.fieldError}>{draftError}</p>}
            <div className={styles.formActions}>
              <button type="submit" className={styles.primaryBtn}>
                Use this token
              </button>
              {isManualToken && (
                <button
                  type="button"
                  className={styles.dangerBtn}
                  onClick={clearManualToken}
                >
                  Clear manual token
                </button>
              )}
            </div>
          </form>

          <div className={styles.hint}>
            <strong>How to get a token:</strong> Sign in to{" "}
            <a
              href="https://spacecat.experiencecloud.live"
              target="_blank"
              rel="noopener noreferrer"
            >
              SpaceCat
            </a>{" "}
            or another Adobe property, then open DevTools → Application →
            Local/Session Storage and look for a key containing{" "}
            <code>adobeid_ims_access_token</code>.
          </div>
        </section>
      </div>
    </div>
  );
}
