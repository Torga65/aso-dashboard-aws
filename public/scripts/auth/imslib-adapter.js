/**
 * imslib-adapter.js
 *
 * Re-exports the PKCE-based IMS auth module (ims-auth.js) under the same
 * public API surface that suggestion-lifecycle and customer-history pages
 * expect. The postMessage bridge to the React parent is no longer used —
 * the static pages authenticate independently via Authorization Code + PKCE
 * using client 307b29831bd0423e9f2c720545df2251, which has the
 * read_organizations scope required by SpaceCat.
 */

export {
  initIMS,
  signIn,
  signOut,
  isAuthenticated,
  getAccessToken,
  getProfile,
  onAuthReady,
  onAuthStateChange,
} from './ims-auth.js';
