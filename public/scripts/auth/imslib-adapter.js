/**
 * imslib-adapter.js
 *
 * Drop-in replacement for ims-auth.js that delegates to window.adobeIMS
 * (Adobe IMS library loaded from CDN via <script> before this module).
 *
 * Exports the same functions as ims-auth.js so call sites need only change
 * the import path — no other code changes required.
 *
 * Timing: imslib fires onReady / onProfile synchronously-or-soon after it
 * loads, which may be before ES modules execute. The HTML sets up a small
 * queue (window.__imsAdapterQueue) that captures those early events; this
 * module drains the queue on load and registers its handlers for any
 * subsequent events.
 */

/* ------------------------------------------------------------------ */
/*  Internal state                                                     */
/* ------------------------------------------------------------------ */

let _imsReady = false;
let _profile = null;
let _accessToken = null;

const _readyCallbacks = [];
const _authStateListeners = [];

function _extractToken(t) {
  if (!t) return null;
  return (typeof t === 'object' ? t.token : t) || null;
}

/* ------------------------------------------------------------------ */
/*  Hooks called by window.adobeid callbacks (set in the HTML)        */
/* ------------------------------------------------------------------ */

function _onReady(profile) {
  _imsReady = true;
  _profile = profile || window.adobeIMS?.getProfile?.() || null;
  _accessToken = _extractToken(window.adobeIMS?.getAccessToken?.());

  const cbs = _readyCallbacks.splice(0);
  cbs.forEach((cb) => { try { cb(_profile); } catch (e) { /* silent */ } });
}

function _onProfile(profile) {
  _profile = profile;
  _accessToken = _extractToken(window.adobeIMS?.getAccessToken?.());
  _authStateListeners.forEach((cb) => { try { cb(_profile); } catch (e) { /* silent */ } });
}

function _onExpired() {
  _accessToken = null;
  _authStateListeners.forEach((cb) => { try { cb(null); } catch (e) { /* silent */ } });
}

// Register hooks so the HTML callbacks can reach us
window.__imsAdapterOnReady = _onReady;
window.__imsAdapterOnProfile = _onProfile;
window.__imsAdapterOnExpired = _onExpired;

// Drain events that fired before this module loaded
const queue = window.__imsAdapterQueue;
if (Array.isArray(queue)) {
  queue.forEach(([type, data]) => {
    if (type === 'ready') _onReady(data);
    else if (type === 'profile') _onProfile(data);
    else if (type === 'expired') _onExpired();
  });
  window.__imsAdapterQueue = null; // stop queuing
}

/* ------------------------------------------------------------------ */
/*  Public API (same surface as ims-auth.js)                          */
/* ------------------------------------------------------------------ */

/**
 * Wait for imslib to finish initialising.  Resolves immediately if already
 * ready (e.g. returning user whose token was found in localStorage).
 */
export async function initIMS() {
  if (_imsReady) return;
  return new Promise((resolve) => {
    _readyCallbacks.push(() => resolve());
  });
}

/** Redirect to IMS sign-in. */
export function signIn() {
  window.adobeIMS?.signIn?.();
}

/**
 * Sign out and clear local state.
 * @param {boolean} [imsLogout=false] – if true, also redirect to IMS logout endpoint
 */
export function signOut(imsLogout = false) {
  _accessToken = null;
  _profile = null;
  _authStateListeners.forEach((cb) => { try { cb(null); } catch (e) { /* silent */ } });
  // adobeIMS.signOut() always redirects to IMS logout page
  if (imsLogout) {
    window.adobeIMS?.signOut?.();
  } else {
    // Local-only sign-out without IMS redirect — clear imslib storage manually
    try {
      const patterns = ['adobeid', 'imslib'];
      [localStorage, sessionStorage].forEach((store) => {
        for (let i = store.length - 1; i >= 0; i -= 1) {
          const key = store.key(i);
          if (key && patterns.some((p) => key.toLowerCase().includes(p))) {
            store.removeItem(key);
          }
        }
      });
    } catch { /* silent */ }
  }
}

/** Synchronous — returns true when a valid session exists. */
export function isAuthenticated() {
  return !!(window.adobeIMS?.isSignedInUser?.());
}

/**
 * Synchronous — returns the cached access token string, or null.
 * The cache is updated by onReady / onProfile.
 */
export function getAccessToken() {
  // Re-read on every call in case imslib refreshed the token silently
  const fresh = _extractToken(window.adobeIMS?.getAccessToken?.());
  if (fresh) _accessToken = fresh;
  return _accessToken;
}

/** Returns the current profile object, or null. */
export function getProfile() {
  return _profile || window.adobeIMS?.getProfile?.() || null;
}

/**
 * Register a callback invoked once auth is ready (or immediately if already
 * ready).  Receives the profile object (may be null).
 * @param {Function} cb
 */
export function onAuthReady(cb) {
  if (_imsReady) {
    try { cb(_profile); } catch (e) { /* silent */ }
  } else {
    _readyCallbacks.push(cb);
  }
}

/**
 * Register a callback invoked when auth state changes (token refresh,
 * sign-out, etc.).  Receives the profile object (may be null).
 * @param {Function} cb
 */
export function onAuthStateChange(cb) {
  _authStateListeners.push(cb);
}
