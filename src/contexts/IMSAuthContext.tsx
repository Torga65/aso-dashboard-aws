"use client";
/**
 * IMSAuthContext — Adobe IMS authentication context
 *
 * Uses @identity/imslib (same package as llmo-spacecat-dashboard) to handle
 * the full OAuth 2.0 implicit flow. Provides:
 *   - IMS sign-in / sign-out
 *   - Reactive accessToken (IMS token OR manually-entered developer token)
 *   - User profile
 *   - Developer override: paste any IMS token without going through the browser SSO flow
 *
 * All child components call useIMSAuth() to read auth state.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";

// ─── Config ──────────────────────────────────────────────────────────────────

export const IMS_CLIENT_ID = "ASO-dashboard";
const IMS_SCOPES = "openid,AdobeID";

/** localStorage key for developer-entered manual token */
export const MANUAL_TOKEN_KEY = "aso_manual_ims_token";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IMSProfile {
  userId?: string;
  email?: string;
  name?: string;
  displayName?: string;
  first_name?: string;
  last_name?: string;
  account_type?: string;
}

interface IMSAuthContextValue {
  /** True when the user has a valid IMS or manual token */
  isAuthenticated: boolean;
  /** Current access token string (IMS or manual) */
  accessToken: string;
  /** User profile from IMS (null for manual-token auth) */
  profile: IMSProfile | null;
  /** Whether the imslib SDK has finished initializing */
  isReady: boolean;
  /** Start Adobe IMS sign-in redirect */
  signIn: () => void;
  /** Sign out and clear tokens */
  signOut: () => void;
  /** Set a manual developer token (stored in localStorage) */
  setManualToken: (token: string) => void;
  /** Clear the manual developer token */
  clearManualToken: () => void;
  /** True if currently using a manually-entered token rather than IMS */
  isManualToken: boolean;
  /** Any auth error message */
  error: string | null;
}

const IMSAuthContext = createContext<IMSAuthContextValue | undefined>(undefined);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function IMSAuthProvider({ children }: { children: React.ReactNode }) {
  const [adobeIMS, setAdobeIMS] = useState<unknown>(null);
  const [isReady, setIsReady] = useState(false);
  const [imsToken, setImsToken] = useState<string>("");
  const [profile, setProfile] = useState<IMSProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualToken, setManualTokenState] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(MANUAL_TOKEN_KEY) ?? "";
  });

  // Keep a ref so sign-out can access the imslib instance synchronously
  const imsRef = useRef<unknown>(null);

  // Initialize imslib (browser only)
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const { AdobeIMS } = await import("@identity/imslib");

        if (cancelled) return;

        const instance = new (AdobeIMS as new (cfg: unknown) => unknown)({
          client_id: IMS_CLIENT_ID,
          scope: IMS_SCOPES,
          locale: "en-US",
          environment: "prod",
          redirect_uri: window.location.origin + window.location.pathname,
          autoValidateToken: true,

          onAccessToken: (token: { token: string } | string) => {
            const tokenStr =
              typeof token === "object" ? token.token : token;
            setImsToken(tokenStr ?? "");
            // Eagerly fetch profile in case onProfile hasn't fired yet
            try {
              const p = (instance as { getProfile: () => IMSProfile }).getProfile();
              if (p) setProfile(p);
            } catch { /* ignore */ }
          },

          onReauthAccessToken: (token: { token: string } | string) => {
            const tokenStr =
              typeof token === "object" ? token.token : token;
            setImsToken(tokenStr ?? "");
          },

          onAccessTokenHasExpired: () => {
            setImsToken("");
          },

          onProfile: (p: IMSProfile) => {
            setProfile(p);
          },

          onReady: () => {
            // onProfile may not fire for already-authenticated users —
            // pull the profile directly from imslib on ready.
            try {
              const p = (instance as { getProfile: () => IMSProfile }).getProfile();
              if (p) setProfile(p);
            } catch { /* ignore */ }
            setIsReady(true);
          },

          onError: (type: string, err: unknown) => {
            console.error("[IMS] Error:", type, err);
            setError(`IMS error: ${type}`);
          },
        });

        imsRef.current = instance;
        setAdobeIMS(instance);
        (instance as { initialize: () => void }).initialize();
      } catch (err) {
        console.error("[IMS] Failed to initialize imslib", err);
        // Still mark as ready so the app doesn't hang
        setIsReady(true);
        setError("IMS library failed to load");
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // Sync manual token from localStorage on storage events (other tabs)
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === MANUAL_TOKEN_KEY) {
        setManualTokenState(e.newValue ?? "");
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const signIn = useCallback(() => {
    if (adobeIMS) {
      (adobeIMS as { signIn: () => void }).signIn();
    }
  }, [adobeIMS]);

  const signOut = useCallback(() => {
    // Clear manual token
    localStorage.removeItem(MANUAL_TOKEN_KEY);
    setManualTokenState("");
    setImsToken("");
    setProfile(null);

    // Clear imslib storage
    try {
      const patterns = ["adobeid", "ims", "access_token", "profile"];
      [sessionStorage, localStorage].forEach((store) => {
        for (let i = store.length - 1; i >= 0; i--) {
          const key = store.key(i);
          if (key && patterns.some((p) => key.toLowerCase().includes(p))) {
            store.removeItem(key);
          }
        }
      });
    } catch { /* silent */ }

    if (adobeIMS) {
      try {
        (adobeIMS as { signOut: () => void }).signOut();
      } catch {
        window.location.reload();
      }
    }
  }, [adobeIMS]);

  const setManualToken = useCallback((token: string) => {
    const trimmed = token.trim();
    localStorage.setItem(MANUAL_TOKEN_KEY, trimmed);
    setManualTokenState(trimmed);
  }, []);

  const clearManualToken = useCallback(() => {
    localStorage.removeItem(MANUAL_TOKEN_KEY);
    setManualTokenState("");
  }, []);

  // Prefer IMS token; fall back to manual token
  const accessToken = useMemo(
    () => imsToken || manualToken,
    [imsToken, manualToken]
  );

  const isManualToken = !!manualToken && !imsToken;
  const isAuthenticated = !!accessToken;

  const value: IMSAuthContextValue = {
    isAuthenticated,
    accessToken,
    profile,
    isReady,
    signIn,
    signOut,
    setManualToken,
    clearManualToken,
    isManualToken,
    error,
  };

  return (
    <IMSAuthContext.Provider value={value}>
      {children}
    </IMSAuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useIMSAuth(): IMSAuthContextValue {
  const ctx = useContext(IMSAuthContext);
  if (!ctx) {
    throw new Error("useIMSAuth must be used within IMSAuthProvider");
  }
  return ctx;
}
