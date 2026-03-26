"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useIMSAuth } from "@/contexts/IMSAuthContext";
import styles from "./AuthButton.module.css";

// ─── Token parsing ────────────────────────────────────────────────────────────

interface TokenInfo {
  expiresAt: Date | null;
  status: "valid" | "expiring" | "expired";
  timeRemaining: string;
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

// ─── Component ────────────────────────────────────────────────────────────────

export function AuthButton() {
  const {
    isAuthenticated,
    accessToken,
    profile,
    isManualToken,
    signIn,
    signOut,
    setManualToken,
    clearManualToken,
  } = useIMSAuth();

  const [open, setOpen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [devInput, setDevInput] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close dropdown / dev panel on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setDevOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const handleSignOut = useCallback(() => {
    setOpen(false);
    signOut();
  }, [signOut]);

  const handleSaveDevToken = useCallback(() => {
    const trimmed = devInput.trim();
    if (trimmed) {
      setManualToken(trimmed);
      setDevInput("");
      setDevOpen(false);
    }
  }, [devInput, setManualToken]);

  const handleClearDevToken = useCallback(() => {
    clearManualToken();
    setOpen(false);
  }, [clearManualToken]);

  // ── Authenticated state ──────────────────────────────────────────────────

  if (isAuthenticated) {
    const initials = isManualToken
      ? "DEV"
      : profile
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

    const displayName = isManualToken
      ? "Developer token"
      : profile?.displayName ||
        `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() ||
        profile?.email?.split("@")[0] ||
        "User";

    const tokenInfo = accessToken ? parseToken(accessToken) : null;

    return (
      <div className={styles.wrapper} ref={wrapperRef}>
        <button
          className={styles.avatarBtn}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Account menu"
          title={isManualToken ? "Developer token active" : (profile?.email ?? undefined)}
        >
          <span
            className={styles.avatar}
            style={isManualToken ? { background: "#6366f1" } : undefined}
          >
            {initials}
          </span>
        </button>

        {open && (
          <div className={styles.dropdown}>
            <div className={styles.dropdownName}>{displayName}</div>
            {!isManualToken && profile?.email && (
              <div className={styles.dropdownEmail}>{profile.email}</div>
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
            {isManualToken ? (
              <button className={styles.signOutBtn} onClick={handleClearDevToken}>
                Clear token
              </button>
            ) : (
              <button className={styles.signOutBtn} onClick={handleSignOut}>
                Sign out
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Unauthenticated state ────────────────────────────────────────────────

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <div className={styles.signInStack}>
        <button className={styles.signIn} onClick={signIn}>
          Sign in with Adobe
        </button>
        <button
          className={styles.devToggle}
          onClick={() => setDevOpen((v) => !v)}
          aria-expanded={devOpen}
        >
          Developer token {devOpen ? "▴" : "▾"}
        </button>
        {devOpen && (
          <div className={styles.devPanel}>
            <textarea
              className={styles.devInput}
              placeholder="Paste SpaceCat or IMS token"
              value={devInput}
              onChange={(e) => setDevInput(e.target.value)}
              rows={3}
              spellCheck={false}
            />
            <button
              className={styles.devSave}
              onClick={handleSaveDevToken}
              disabled={!devInput.trim()}
            >
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
