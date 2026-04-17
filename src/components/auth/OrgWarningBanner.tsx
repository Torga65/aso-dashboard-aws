"use client";

/**
 * OrgWarningBanner
 *
 * Shows a dismissible warning when the signed-in user appears to be using
 * the wrong Adobe IMS org. The two checks are:
 *
 *   1. Email domain — must end with @adobe.com.
 *   2. ownerOrg JWT claim — when EXPECTED_OWNER_ORG is set, the org the
 *      user selected at sign-in must match it exactly.
 *
 * Set the env var NEXT_PUBLIC_EXPECTED_IMS_ORG to the required IMS Org ID
 * (e.g. "ABCDEF1234567890@AdobeOrg") to enable the ownerOrg check. If the
 * var is not set only the email-domain check runs.
 *
 * The banner is sticky at the top of the page, above the header. It stays
 * visible until the user signs out or dismisses it. Dismissal is stored in
 * sessionStorage so it resets on the next sign-in.
 */

import { useState, useEffect, useMemo } from "react";
import { useIMSAuth } from "@/contexts/IMSAuthContext";
import styles from "./OrgWarningBanner.module.css";

// ─── Config ──────────────────────────────────────────────────────────────────

/** Expected IMS Org ID (ownerOrg claim). Optional — set via env var. */
const EXPECTED_OWNER_ORG = process.env.NEXT_PUBLIC_EXPECTED_IMS_ORG ?? "";

/** sessionStorage key — if present, user has dismissed the banner this session. */
const DISMISS_KEY = "aso_org_warning_dismissed";

// ─── JWT helpers ─────────────────────────────────────────────────────────────

interface JwtPayload {
  email?: string;
  ownerOrg?: string;
  user_id?: string;
  [key: string]: unknown;
}

function parseJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

interface OrgCheckResult {
  /** true = something looks wrong */
  hasWarning: boolean;
  /** human-readable reason(s) */
  reasons: string[];
  /** the ownerOrg from the token, for display */
  ownerOrg: string;
  /** the email from profile / token */
  email: string;
}

function useOrgCheck(): OrgCheckResult {
  const { isAuthenticated, accessToken, profile } = useIMSAuth();

  return useMemo(() => {
    const empty = { hasWarning: false, reasons: [], ownerOrg: "", email: "" };
    if (!isAuthenticated || !accessToken) return empty;

    const payload = parseJwtPayload(accessToken);
    const email = profile?.email ?? payload?.email ?? "";
    const ownerOrg = payload?.ownerOrg ?? "";
    const reasons: string[] = [];

    // Check 1 — email domain
    if (email && !email.toLowerCase().endsWith("@adobe.com")) {
      reasons.push(
        `Your account (${email}) is not an @adobe.com address. Sign in with your internal Adobe account.`
      );
    }

    // Check 2 — ownerOrg (only when env var is configured)
    if (EXPECTED_OWNER_ORG && ownerOrg && ownerOrg !== EXPECTED_OWNER_ORG) {
      reasons.push(
        `You are signed into org "${ownerOrg}" but this dashboard requires "${EXPECTED_OWNER_ORG}". ` +
          `Sign out and select the correct org at the Adobe login screen.`
      );
    }

    return { hasWarning: reasons.length > 0, reasons, ownerOrg, email };
  }, [isAuthenticated, accessToken, profile]);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function OrgWarningBanner() {
  const { isAuthenticated, signOut } = useIMSAuth();
  const { hasWarning, reasons, ownerOrg, email } = useOrgCheck();
  const [dismissed, setDismissed] = useState(false);

  // Read dismiss state from sessionStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      setDismissed(!!sessionStorage.getItem(DISMISS_KEY));
    } catch {
      /* ignore */
    }
  }, []);

  // Reset dismiss when authentication changes (new sign-in)
  useEffect(() => {
    if (!isAuthenticated) {
      try { sessionStorage.removeItem(DISMISS_KEY); } catch { /* ignore */ }
      setDismissed(false);
    }
  }, [isAuthenticated]);

  if (!isAuthenticated || !hasWarning || dismissed) return null;

  function handleDismiss() {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setDismissed(true);
  }

  function handleSignOut() {
    try { sessionStorage.removeItem(DISMISS_KEY); } catch { /* ignore */ }
    signOut();
  }

  return (
    <div className={styles.banner} role="alert" aria-live="polite">
      <div className={styles.inner}>
        <span className={styles.icon} aria-hidden>⚠️</span>

        <div className={styles.body}>
          <strong className={styles.title}>Wrong Adobe org detected</strong>
          <ul className={styles.reasons}>
            {reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          {ownerOrg && (
            <p className={styles.detail}>
              Active org: <code>{ownerOrg}</code>
              {email && <> &nbsp;·&nbsp; Account: <code>{email}</code></>}
            </p>
          )}
          <p className={styles.hint}>
            Sign out below, then sign back in and select the{" "}
            <strong>Adobe Sites internal org</strong> from the org picker.
          </p>
        </div>

        <div className={styles.actions}>
          <button className={styles.signOutBtn} onClick={handleSignOut}>
            Sign out &amp; try again
          </button>
          <button
            className={styles.dismissBtn}
            onClick={handleDismiss}
            aria-label="Dismiss warning"
            title="Dismiss — warning resets on next sign-in"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
