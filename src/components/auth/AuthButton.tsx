"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useIMSAuth } from "@/contexts/IMSAuthContext";
import styles from "./AuthButton.module.css";

// ─── Token parsing (same logic as DeveloperView) ──────────────────────────────

interface TokenInfo {
  expiresAt: Date | null;
  status: "valid" | "expiring" | "expired";
  timeRemaining: string;
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

function parseToken(token: string): TokenInfo | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));

    let expiresAt: Date | null = null;
    if (payload.exp) expiresAt = new Date(payload.exp * 1000);
    if (payload.created_at && payload.expires_in) {
      expiresAt = new Date(parseInt(payload.created_at) + parseInt(payload.expires_in));
    }

    const remaining = expiresAt ? expiresAt.getTime() - Date.now() : 0;
    const status: TokenInfo["status"] =
      remaining <= 0 ? "expired" : remaining < 3_600_000 ? "expiring" : "valid";

    const fmt = (ms: number) => {
      if (ms <= 0) return "Expired";
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      return h > 0 ? `${h}h ${m}m remaining` : `${m}m remaining`;
    };

    return { expiresAt, status, timeRemaining: fmt(remaining) };
  } catch {
    return null;
  }
}

const STATUS_COLOR = { valid: "#16a34a", expiring: "#d97706", expired: "#dc2626" };

// ─── Avatar fetch (Behance API, same as llmo-spacecat-dashboard) ──────────────

async function fetchUserAvatar(userId: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://cc-api-behance.adobe.io/v2/users/${userId}?api_key=susi_auth_service`
    );
    if (!response.ok) return null;
    const data = await response.json();
    const images = data.user?.images;
    if (images) {
      return images["276"] || images["230"] || images["138"] || images["115"] || images["100"] || images["50"] || null;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface AuthButtonProps {
  /** When false, suppresses the automatic IMS redirect on page load. Default: true. */
  autoSignIn?: boolean;
}

export function AuthButton({ autoSignIn = true }: AuthButtonProps) {
  const { isAuthenticated, accessToken, profile, isReady, signIn, signOut } = useIMSAuth();
  const [open, setOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Fetch Behance avatar when userId is available
  useEffect(() => {
    if (!profile?.userId) { setAvatarUrl(null); return; }
    fetchUserAvatar(profile.userId).then(setAvatarUrl);
  }, [profile?.userId]);

  // Auto sign-in when imslib is ready and user is not signed in (disabled on developer page)
  useEffect(() => {
    if (autoSignIn && isReady && !isAuthenticated) {
      signIn();
    }
  }, [autoSignIn, isReady, isAuthenticated, signIn]);

  // Close dropdown on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const handleSignOut = useCallback(() => {
    setOpen(false);
    signOut();
  }, [signOut]);

  if (isAuthenticated) {
    const initials = profile
      ? (
          [profile.first_name, profile.last_name]
            .filter(Boolean)
            .map((s) => s![0])
            .join("")
            .toUpperCase() ||
          profile.email?.[0]?.toUpperCase() ||
          "?"
        )
      : "?";

    const displayName =
      profile?.displayName ||
      `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() ||
      profile?.email?.split("@")[0] ||
      "User";

    const tokenInfo = accessToken ? parseToken(accessToken) : null;
    const jwtPayload = accessToken ? parseJwtPayload(accessToken) : null;
    const ownerOrg = jwtPayload?.ownerOrg as string | undefined;
    const wrongOrg = profile?.email
      ? !profile.email.toLowerCase().endsWith("@adobe.com")
      : false;

    return (
      <div className={styles.wrapper} ref={wrapperRef}>
        <button
          className={`${styles.avatarBtn} ${wrongOrg ? styles.avatarBtnWarn : ""}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Account menu"
          title={wrongOrg ? "⚠ Wrong org — click for details" : (profile?.email ?? undefined)}
        >
          {avatarUrl
            ? <img src={avatarUrl} alt={displayName} className={styles.avatar} />
            : <span className={`${styles.avatar} ${wrongOrg ? styles.avatarWarn : ""}`}>{initials}</span>
          }
          {wrongOrg && <span className={styles.warnDot} aria-hidden>⚠</span>}
        </button>

        {open && (
          <div className={styles.dropdown}>
            <div className={styles.dropdownName}>{displayName}</div>
            {profile?.email && (
              <div className={styles.dropdownEmail}>{profile.email}</div>
            )}
            {ownerOrg && (
              <div className={styles.dropdownOrg} title="Active IMS org">
                Org: <span className={styles.dropdownOrgId}>{ownerOrg}</span>
              </div>
            )}
            {tokenInfo && (
              <div
                className={styles.dropdownExpiry}
                style={{ color: STATUS_COLOR[tokenInfo.status] }}
              >
                {tokenInfo.timeRemaining}
                {tokenInfo.expiresAt && (
                  <span className={styles.dropdownExpiryDate}>
                    {tokenInfo.expiresAt.toLocaleString()}
                  </span>
                )}
              </div>
            )}
            <button className={styles.signOutBtn} onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <button className={styles.signIn} onClick={signIn}>
      Sign in with Adobe
    </button>
  );
}
