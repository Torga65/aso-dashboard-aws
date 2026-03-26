/**
 * imslib-adapter.js
 *
 * Receives the IMS access token from the parent React app via postMessage.
 * The parent (StaticPageFrame) holds the real imslib instance and posts the
 * token into the iframe whenever it changes — avoiding the X-Frame-Options:DENY
 * issue that blocks auth-stg1.services.adobe.com inside an iframe.
 *
 * Exports the same public API as the original ims-auth.js so call sites need
 * only change the import path.
 */

/* ------------------------------------------------------------------ */
/*  Internal state                                                     */
/* ------------------------------------------------------------------ */

let _token = null;
let _ready = false;

const _readyCallbacks = [];
const _authStateListeners = [];

/* ------------------------------------------------------------------ */
/*  postMessage listener — receives token from parent frame           */
/* ------------------------------------------------------------------ */

window.addEventListener('message', (event) => {
  // Only accept messages from the same origin
  if (event.origin !== window.location.origin) return;

  const { type, token } = event.data || {};

  if (type === 'ims-token') {
    _token = token || null;

    if (!_ready) {
      _ready = true;
      const cbs = _readyCallbacks.splice(0);
      cbs.forEach((cb) => { try { cb(null); } catch (e) { /* silent */ } });
    }

    _authStateListeners.forEach((cb) => { try { cb(null); } catch (e) { /* silent */ } });
  }

  if (type === 'ims-signout') {
    _token = null;
    _authStateListeners.forEach((cb) => { try { cb(null); } catch (e) { /* silent */ } });
  }
});

/* ------------------------------------------------------------------ */
/*  Public API (same surface as ims-auth.js)                          */
/* ------------------------------------------------------------------ */

/**
 * Resolves when the parent has posted the token (or immediately if already received).
 * Times out after 5 s and resolves anyway so the page doesn't hang if loaded standalone.
 */
export async function initIMS() {
  if (_ready) return;
  return new Promise((resolve) => {
    _readyCallbacks.push(resolve);
    // Fallback: resolve after 5 s so the page doesn't hang forever
    setTimeout(() => {
      if (!_ready) {
        _ready = true;
        resolve();
      }
    }, 5000);
  });
}

/** Sign in — delegate to the parent window (can't redirect inside an iframe). */
export function signIn() {
  window.parent?.postMessage({ type: 'ims-signin-required' }, window.location.origin);
}

/** Sign out — notify parent and clear local token. */
export function signOut() {
  _token = null;
  _authStateListeners.forEach((cb) => { try { cb(null); } catch (e) { /* silent */ } });
  window.parent?.postMessage({ type: 'ims-signout-required' }, window.location.origin);
}

/** True when a valid token has been received from the parent. */
export function isAuthenticated() {
  return !!_token;
}

/** Returns the cached access token string, or null. */
export function getAccessToken() {
  return _token;
}

/** Profile is not passed through the token bridge — returns null. */
export function getProfile() {
  return null;
}

/**
 * Register a callback invoked once auth token is received (or immediately if already ready).
 * @param {Function} cb
 */
export function onAuthReady(cb) {
  if (_ready) {
    try { cb(null); } catch (e) { /* silent */ }
  } else {
    _readyCallbacks.push(cb);
  }
}

/**
 * Register a callback invoked when auth state changes.
 * @param {Function} cb
 */
export function onAuthStateChange(cb) {
  _authStateListeners.push(cb);
}
