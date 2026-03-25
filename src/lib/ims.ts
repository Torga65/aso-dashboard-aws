"use client";
/**
 * ims.ts — Adobe IMS Auth (PKCE / Authorization Code flow)
 *
 * Client-side only. All state is stored in localStorage so it persists
 * across page navigations. The PKCE code_verifier is kept in sessionStorage
 * (tab-scoped, single-use).
 *
 * Usage:
 *   import { signIn, signOut, getAccessToken, getProfile, isAuthenticated, useIMS } from "@/lib/ims";
 */

// ─── Config ──────────────────────────────────────────────────────────────────

export const IMS_CLIENT_ID = "307b29831bd0423e9f2c720545df2251";
export const IMS_SCOPES =
  "openid,AdobeID,read_organizations,account_cluster.read,additional_info.roles,additional_info.projectedProductContext";

const STORAGE_KEY = "aso_ims_auth";
const PKCE_VERIFIER_KEY = "aso_pkce_verifier";

function imsBaseURL(): string {
  if (typeof window === "undefined") return "https://ims-na1.adobelogin.com";
  const env = new URLSearchParams(window.location.search).get("ims_env");
  return env === "stg1" || env === "stage"
    ? "https://ims-na1-stg1.adobelogin.com"
    : "https://ims-na1.adobelogin.com";
}

function redirectURI(): string {
  return `${window.location.origin}/auth/callback`;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IMSProfile {
  userId: string;
  email: string;
  name: string;
  displayName?: string;
  first_name?: string;
  last_name?: string;
  account_type?: string;
}

export interface AuthState {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number; // Unix ms
  profile: IMSProfile | null;
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

export function loadAuthState(): AuthState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthState) : null;
  } catch {
    return null;
  }
}

export function storeAuthState(state: AuthState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearAuthState(): void {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
}

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function base64URLEncode(bytes: Uint8Array): string {
  let str = "";
  bytes.forEach((b) => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return base64URLEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64URLEncode(new Uint8Array(digest));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Whether the user has a valid (non-expired) access token. */
export function isAuthenticated(): boolean {
  const state = loadAuthState();
  if (!state?.accessToken) return false;
  return state.expiresAt > Date.now();
}

/** Returns the current access token or null if not authenticated. */
export function getAccessToken(): string | null {
  const state = loadAuthState();
  if (!state?.accessToken) return null;
  if (state.expiresAt <= Date.now()) return null;
  return state.accessToken;
}

/** Returns the current user profile or null. */
export function getProfile(): IMSProfile | null {
  return loadAuthState()?.profile ?? null;
}

/**
 * Start the PKCE sign-in flow.
 * Generates verifier/challenge and redirects to IMS.
 */
export async function signIn(): Promise<void> {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    client_id: IMS_CLIENT_ID,
    redirect_uri: redirectURI(),
    scope: IMS_SCOPES,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    puser: "adobe.com", // Adobe employees only
  });

  window.location.href = `${imsBaseURL()}/ims/authorize/v3?${params.toString()}`;
}

/** Sign out and clear stored tokens. */
export function signOut(): void {
  clearAuthState();
  // Notify any listeners
  window.dispatchEvent(new Event("ims-auth-change"));
}

/**
 * Exchange an authorization code for tokens.
 * Called from the callback page — sends to our API proxy to avoid CORS.
 */
export async function exchangeCode(code: string): Promise<AuthState> {
  const codeVerifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (!codeVerifier) {
    throw new Error("PKCE code_verifier not found — was signIn() called from this tab?");
  }

  const res = await fetch("/api/auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, codeVerifier, redirectURI: redirectURI() }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const tokens = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  sessionStorage.removeItem(PKCE_VERIFIER_KEY);

  // Fetch profile
  let profile: IMSProfile | null = null;
  try {
    const profileRes = await fetch(
      `${imsBaseURL()}/ims/profile/v1?client_id=${IMS_CLIENT_ID}`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    if (profileRes.ok) profile = await profileRes.json();
  } catch { /* non-fatal */ }

  const state: AuthState = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    profile,
  };

  storeAuthState(state);
  window.dispatchEvent(new Event("ims-auth-change"));
  return state;
}
