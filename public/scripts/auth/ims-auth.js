/**
 * IMS Authentication Module — Authorization Code + PKCE
 *
 * Self-contained OAuth 2.0 client for Adobe IMS.
 * No external SDK dependency — uses the Web Crypto API for PKCE
 * and direct HTTP calls to IMS endpoints.
 *
 * Flow:
 *   1. signIn() → generates PKCE verifier/challenge → redirects to IMS /authorize
 *   2. IMS redirects to /ims/callback?code=... → callback.html exchanges code for tokens
 *   3. Tokens stored in localStorage → page loads → initIMS() picks them up
 *
 * Usage:
 *   import { initIMS, signIn, getAccessToken, onAuthReady } from './ims-auth.js';
 *   await initIMS();
 *   onAuthReady((profile) => { ... });
 */

import {
  IMS_CLIENT_ID,
  IMS_SCOPES,
  IMS_ADOBE_ONLY,
  getIMSEnvironment,
  getIMSBaseURL,
  getRedirectURI,
  STORAGE_KEY,
  PKCE_VERIFIER_KEY,
} from './ims-config.js';

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

let _ready = false;
const _readyCallbacks = [];
const _authStateListeners = [];
let _refreshTimer = null;

/* ------------------------------------------------------------------ */
/*  PKCE Helpers (Web Crypto API)                                      */
/* ------------------------------------------------------------------ */

/**
 * Generate a cryptographically random code verifier (43–128 chars, URL-safe).
 * @returns {string}
 */
export function generateCodeVerifier() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return base64URLEncode(array);
}

/**
 * Derive a SHA-256 code challenge from the verifier.
 * @param {string} verifier
 * @returns {Promise<string>} base64url-encoded SHA-256 hash
 */
export async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64URLEncode(new Uint8Array(digest));
}

/**
 * Base64-URL encode a Uint8Array (no padding, URL-safe alphabet).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function base64URLEncode(bytes) {
  let str = '';
  bytes.forEach((b) => { str += String.fromCharCode(b); });
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/* ------------------------------------------------------------------ */
/*  Token Storage                                                      */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} AuthState
 * @property {string} accessToken
 * @property {string|null} refreshToken
 * @property {number} expiresAt - Unix ms
 * @property {Object|null} profile - { email, name, userId, ... }
 * @property {string|null} imsOrgId
 */

/**
 * Store auth state in localStorage so it is available across all tabs.
 * The PKCE verifier remains in sessionStorage (it is tab-scoped and single-use).
 * @param {AuthState} state
 */
export function storeAuthState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('[IMS] Failed to store auth state', e);
  }
}

/**
 * Load auth state from localStorage.
 * @returns {AuthState|null}
 */
export function loadAuthState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Clear all auth state.
 */
export function clearAuthState() {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  // Also clear any legacy imslib keys
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && (key.includes('adobeid') || key.includes('ims'))) {
        sessionStorage.removeItem(key);
      }
    }
  } catch { /* silent */ }
}

/* ------------------------------------------------------------------ */
/*  IMS HTTP Calls                                                     */
/* ------------------------------------------------------------------ */

/**
 * Exchange an authorization code for tokens using PKCE.
 * Called from the callback page.
 *
 * @param {string} code - Authorization code from IMS redirect
 * @returns {Promise<{access_token: string, refresh_token?: string, expires_in: number}>}
 */
export async function exchangeCodeForTokens(code) {
  const codeVerifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (!codeVerifier) {
    throw new Error('PKCE code_verifier not found in session — was signIn() called from this browser tab?');
  }

  const env = getIMSEnvironment();
  const baseURL = getIMSBaseURL(env);
  const tokenURL = `${baseURL}/ims/token/v3`;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: IMS_CLIENT_ID,
    code,
    code_verifier: codeVerifier,
    redirect_uri: getRedirectURI(),
  });

  const response = await fetch(tokenURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[IMS] Token exchange failed:', response.status, errorText);
    throw new Error(`Token exchange failed (HTTP ${response.status}): ${errorText}`);
  }

  const data = await response.json();

  // Clean up the verifier — it's single-use
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);

  return data;
}

/**
 * Refresh the access token using a refresh token.
 * @returns {Promise<boolean>} true if refresh succeeded
 */
export async function refreshAccessToken() {
  const state = loadAuthState();
  if (!state?.refreshToken) {
    console.warn('[IMS] No refresh token available');
    return false;
  }

  const env = getIMSEnvironment();
  const baseURL = getIMSBaseURL(env);
  const tokenURL = `${baseURL}/ims/token/v3`;

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: IMS_CLIENT_ID,
      refresh_token: state.refreshToken,
    });

    const response = await fetch(tokenURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      console.error('[IMS] Token refresh failed:', response.status);
      return false;
    }

    const data = await response.json();
    const expiresAt = Date.now() + (data.expires_in * 1000);

    storeAuthState({
      ...state,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || state.refreshToken,
      expiresAt,
    });

    console.log('[IMS] Token refreshed successfully');
    notifyAuthStateChange();
    return true;
  } catch (err) {
    console.error('[IMS] Token refresh error:', err);
    return false;
  }
}

/**
 * Fetch the user profile from IMS.
 * @param {string} accessToken
 * @returns {Promise<Object|null>}
 */
export async function fetchProfile(accessToken) {
  const env = getIMSEnvironment();
  const baseURL = getIMSBaseURL(env);
  const profileURL = `${baseURL}/ims/profile/v1?client_id=${IMS_CLIENT_ID}`;

  try {
    const response = await fetch(profileURL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      console.warn('[IMS] Profile fetch failed:', response.status);
      return null;
    }

    return await response.json();
  } catch (err) {
    console.warn('[IMS] Profile fetch error:', err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Notification / Listener System                                     */
/* ------------------------------------------------------------------ */

function notifyReady() {
  _ready = true;
  const state = loadAuthState();
  const profile = state?.profile || null;
  const cbs = [..._readyCallbacks];
  _readyCallbacks.length = 0;
  cbs.forEach((cb) => {
    try { cb(profile); } catch (e) { console.error('[IMS] onAuthReady callback error', e); }
  });
}

function notifyAuthStateChange() {
  const state = loadAuthState();
  const profile = state?.profile || null;
  _authStateListeners.forEach((cb) => {
    try { cb(profile); } catch (e) { console.error('[IMS] authStateChange listener error', e); }
  });
}

/**
 * Register a callback called whenever auth state changes (e.g. token refresh).
 * @param {Function} cb - Receives the profile object (may be null)
 */
export function onAuthStateChange(cb) {
  _authStateListeners.push(cb);
}

/**
 * Register a callback invoked once the auth module is ready (or immediately if already ready).
 * @param {Function} cb - Receives the profile object (may be null)
 */
export function onAuthReady(cb) {
  if (_ready) {
    const state = loadAuthState();
    try { cb(state?.profile || null); } catch { /* silent */ }
  } else {
    _readyCallbacks.push(cb);
  }
}

/* ------------------------------------------------------------------ */
/*  Auto-Refresh Timer                                                 */
/* ------------------------------------------------------------------ */

function startAutoRefresh() {
  if (_refreshTimer) return;
  // Check every 2 minutes
  _refreshTimer = setInterval(async () => {
    const state = loadAuthState();
    if (!state?.accessToken || !state?.refreshToken) return;

    const minutesLeft = (state.expiresAt - Date.now()) / 60000;
    if (minutesLeft > 0 && minutesLeft < 10) {
      console.log(`[IMS] Token expires in ${minutesLeft.toFixed(1)}m — refreshing`);
      await refreshAccessToken();
    }
  }, 2 * 60 * 1000);
}

function stopAutoRefresh() {
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Initialize the auth module.
 * Checks for a stored valid token (e.g. user returning from callback).
 * If the token is expired but a refresh token exists, attempts a silent refresh.
 * Resolves when auth state is determined.
 */
export async function initIMS() {
  console.log('[IMS] Initializing auth module');

  const state = loadAuthState();

  if (state?.accessToken) {
    const now = Date.now();
    if (state.expiresAt > now) {
      // Token is valid
      console.log('[IMS] Valid token found — user:', state.profile?.email || '(no profile)');
      startAutoRefresh();
      notifyReady();
      return;
    }

    // Token expired — try refresh
    if (state.refreshToken) {
      console.log('[IMS] Token expired — attempting refresh');
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        startAutoRefresh();
        notifyReady();
        return;
      }
    }

    // Token expired and can't refresh — clear
    console.log('[IMS] Token expired and cannot refresh — clearing');
    clearAuthState();
  } else {
    console.log('[IMS] No stored token found');
  }

  notifyReady();
}

/**
 * Start the IMS sign-in flow.
 * Generates PKCE verifier/challenge and redirects to IMS authorize endpoint.
 */
export async function signIn() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);

  // Store verifier for the callback page to use
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);

  const env = getIMSEnvironment();
  const baseURL = getIMSBaseURL(env);
  const redirectURI = getRedirectURI();

  const params = new URLSearchParams({
    client_id: IMS_CLIENT_ID,
    redirect_uri: redirectURI,
    scope: IMS_SCOPES,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  if (IMS_ADOBE_ONLY) {
    params.set('puser', 'adobe.com');
  }

  const authorizeURL = `${baseURL}/ims/authorize/v3?${params.toString()}`;

  // Navigate the top window so IMS auth doesn't load inside an iframe
  // (IMS blocks iframe embedding via X-Frame-Options).
  (window.top || window).location.href = authorizeURL;
}

/**
 * Sign out — clear tokens and optionally redirect to IMS logout.
 * @param {boolean} [imsLogout=false] - If true, redirect to IMS logout endpoint
 */
export function signOut(imsLogout = false) {
  stopAutoRefresh();
  clearAuthState();
  notifyAuthStateChange();

  if (imsLogout) {
    const env = getIMSEnvironment();
    const baseURL = getIMSBaseURL(env);
    const logoutURL = `${baseURL}/ims/logout/v1?client_id=${IMS_CLIENT_ID}&redirect_uri=${encodeURIComponent(`${window.location.origin}/suggestion-lifecycle.html`)}`;
    window.location.href = logoutURL;
  }
}

/**
 * @returns {boolean} Whether the user has a valid (non-expired) access token.
 */
export function isAuthenticated() {
  const state = loadAuthState();
  if (!state?.accessToken) return false;
  return state.expiresAt > Date.now();
}

/**
 * @returns {string|null} Current access token, or null if not authenticated.
 */
export function getAccessToken() {
  const state = loadAuthState();
  if (!state?.accessToken) return null;
  if (state.expiresAt <= Date.now()) return null; // expired
  return state.accessToken;
}

/**
 * @returns {Object|null} User profile ({ email, name, userId, ... })
 */
export function getProfile() {
  const state = loadAuthState();
  return state?.profile || null;
}
