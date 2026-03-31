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
/*  JWT profile extraction                                             */
/* ------------------------------------------------------------------ */

/**
 * Parse an IMS JWT and return a minimal profile object.
 * Returns null if the token is not a valid JWT.
 * @param {string} token
 * @returns {{ email: string|null, name: string|null, displayName: string|null, userId: string|null }|null}
 */
function parseJwtProfile(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return {
      userId: payload.user_id || payload.sub || null,
      email: payload.email || null,
      name: payload.name || null,
      displayName: payload.displayName || payload.name || null,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Internal state                                                     */
/* ------------------------------------------------------------------ */

let _imsToken = null;    // raw IMS token from parent
let _spacecatToken = null; // exchanged SpaceCat JWT (used for API calls)
let _profile = null;
let _ready = false;

const _readyCallbacks = [];
const _authStateListeners = [];

/* ------------------------------------------------------------------ */
/*  SpaceCat token exchange                                            */
/* ------------------------------------------------------------------ */

async function _exchangeToken(imsToken) {
  try {
    const { exchangeImsToken } = await import('../services/spacecat-api.js');
    const scToken = await exchangeImsToken(imsToken);
    if (scToken) {
      _spacecatToken = scToken;
      // Re-parse profile from SpaceCat JWT (has richer claims)
      _profile = parseJwtProfile(scToken) || parseJwtProfile(imsToken);
    }
  } catch (e) {
    console.warn('[imslib-adapter] Token exchange failed, falling back to IMS token', e);
    _spacecatToken = imsToken;
  }
}

/* ------------------------------------------------------------------ */
/*  postMessage listener — receives token from parent frame           */
/* ------------------------------------------------------------------ */

window.addEventListener('message', (event) => {
  // Only accept messages from the same origin
  if (event.origin !== window.location.origin) return;

  const { type, token } = event.data || {};

  if (type === 'ims-token') {
    _imsToken = token || null;
    _profile = _imsToken ? parseJwtProfile(_imsToken) : null;

    if (_imsToken) {
      // Exchange IMS token for SpaceCat JWT, then notify listeners
      _exchangeToken(_imsToken).then(() => {
        if (!_ready) {
          _ready = true;
          const cbs = _readyCallbacks.splice(0);
          cbs.forEach((cb) => { try { cb(_profile); } catch (e) { /* silent */ } });
        }
        _authStateListeners.forEach((cb) => { try { cb(_profile); } catch (e) { /* silent */ } });
      });
    } else {
      // Signed out
      _spacecatToken = null;
      if (!_ready) {
        _ready = true;
        const cbs = _readyCallbacks.splice(0);
        cbs.forEach((cb) => { try { cb(null); } catch (e) { /* silent */ } });
      }
      _authStateListeners.forEach((cb) => { try { cb(null); } catch (e) { /* silent */ } });
    }
  }

  if (type === 'ims-signout') {
    _imsToken = null;
    _spacecatToken = null;
    _profile = null;
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

/** Sign out — notify parent and clear local tokens. */
export function signOut() {
  _imsToken = null;
  _spacecatToken = null;
  _profile = null;
  _authStateListeners.forEach((cb) => { try { cb(null); } catch (e) { /* silent */ } });
  window.parent?.postMessage({ type: 'ims-signout-required' }, window.location.origin);
}

/** True when a valid SpaceCat token is available. */
export function isAuthenticated() {
  return !!(_spacecatToken || _imsToken);
}

/** Returns the SpaceCat JWT for API calls, falling back to the raw IMS token. */
export function getAccessToken() {
  return _spacecatToken || _imsToken;
}

/** Returns a profile parsed from the JWT, or null if not authenticated. */
export function getProfile() {
  return _profile;
}

/**
 * Register a callback invoked once auth token is received (or immediately if already ready).
 * Receives the profile object (may be null if unauthenticated).
 * @param {Function} cb
 */
export function onAuthReady(cb) {
  if (_ready) {
    try { cb(_profile); } catch (e) { /* silent */ }
  } else {
    _readyCallbacks.push(cb);
  }
}

/**
 * Register a callback invoked when auth state changes.
 * Receives the profile object (null on sign-out).
 * @param {Function} cb
 */
export function onAuthStateChange(cb) {
  _authStateListeners.push(cb);
}
